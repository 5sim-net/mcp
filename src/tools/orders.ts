import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { FiveSimClient } from '../client.js'
import { fetchOffers } from './guest.js'
import { DESTRUCTIVE, READ_ONLY, SPEND_NOTE, enc, orderId, safe, slug, type ToolContext } from './shared.js'

interface Order {
    id: number
    phone: string
    product: string
    price: number
    status: string
    expires: string
    sms: { code?: string; text?: string; sender?: string; date?: string }[] | null
    [key: string]: unknown
}

const TERMINAL = ['CANCELED', 'TIMEOUT', 'FINISHED', 'BANNED']

/** Effective limit = min(user-requested maxPrice, server hard cap FIVESIM_MAX_PRICE) */
const effectiveLimit = (requested: number | undefined, cap: number | undefined) =>
    requested === undefined ? cap : cap === undefined ? requested : Math.min(requested, cap)

const assertActivationPrice = async (
    client: FiveSimClient,
    args: { country: string; operator: string; product: string },
    limit: number | undefined,
) => {
    if (limit === undefined) return
    // With operator "any" 5sim enforces maxPrice itself (query param).
    if (args.operator === 'any') return
    if (args.country === 'any') {
        throw new Error('A price limit is active: choose a specific country, or use operator "any" so 5sim can enforce maxPrice.')
    }
    const offer = (await fetchOffers(client, { country: args.country, product: args.product })).find(
        (o) => o.operator === args.operator && o.product === args.product,
    )
    if (!offer) throw new Error(`No price found for ${args.product} / ${args.country} / ${args.operator}.`)
    if (offer.cost > limit) {
        throw new Error(`Price ${offer.cost} exceeds the limit ${limit}. Purchase not made.`)
    }
}

export const registerOrderTools = (server: McpServer, { client, config }: ToolContext) => {
    server.registerTool(
        'check_order',
        {
            title: 'Check order',
            description: 'Get an order: phone number, status (PENDING, RECEIVED, CANCELED, TIMEOUT, FINISHED, BANNED), expiry and received SMS.',
            inputSchema: { id: orderId },
            annotations: { title: 'Check order', ...READ_ONLY },
        },
        safe(async ({ id }: { id: number }) => client.get(`/v1/user/check/${id}`)),
    )

    server.registerTool(
        'wait_for_sms',
        {
            title: 'Wait for SMS',
            description:
                'Poll an activation order until an SMS arrives or the order ends. Returns the order with its SMS. Call again if it times out while the order is still active.',
            inputSchema: {
                id: orderId,
                timeoutSec: z.number().int().min(5).max(120).default(60),
                intervalSec: z.number().int().min(3).max(30).default(5),
            },
            annotations: { title: 'Wait for SMS', ...READ_ONLY },
        },
        safe(async ({ id, timeoutSec, intervalSec }: { id: number; timeoutSec: number; intervalSec: number }) => {
            const deadline = Date.now() + timeoutSec * 1000
            for (;;) {
                const order = await client.get<Order>(`/v1/user/check/${id}`)
                if ((order.sms?.length ?? 0) > 0 || TERMINAL.includes(order.status)) return order
                if (Date.now() + intervalSec * 1000 > deadline) {
                    return { timedOut: true, message: `No SMS within ${timeoutSec}s; order is still ${order.status}.`, order }
                }
                await new Promise((r) => setTimeout(r, intervalSec * 1000))
            }
        }),
    )

    if (config.readOnly) return

    server.registerTool(
        'buy_activation_number',
        {
            title: 'Buy activation number',
            description:
                `Buy a virtual number to receive a verification SMS for a product (service). ${SPEND_NOTE} Then call wait_for_sms, and finish_order after the verification is done (or cancel_order if no SMS arrives, which refunds).`,
            inputSchema: {
                product: slug('Product id, e.g. "telegram"'),
                country: slug('Country id, or "any"').default('any'),
                operator: slug('Operator id, or "any"').default('any'),
                maxPrice: z.number().positive().optional().describe('Maximum price to pay'),
                reuse: z.boolean().optional().describe('Buy with the ability to reuse the number, if available'),
                voice: z.boolean().optional().describe('Allow verification by voice call, if available'),
                forwarding: z.boolean().optional().describe('Enable call forwarding'),
                forwardingNumber: z.string().regex(/^\d{11}$/).optional().describe('Forwarding target, 11 digits without +'),
            },
            annotations: { title: 'Buy activation number', ...DESTRUCTIVE },
        },
        safe(async (args: {
            product: string
            country: string
            operator: string
            maxPrice?: number
            reuse?: boolean
            voice?: boolean
            forwarding?: boolean
            forwardingNumber?: string
        }) => {
            const limit = effectiveLimit(args.maxPrice, config.maxPrice)
            await assertActivationPrice(client, args, limit)
            return client.get(
                `/v1/user/buy/activation/${enc(args.country)}/${enc(args.operator)}/${enc(args.product)}`,
                {
                    query: {
                        maxPrice: args.operator === 'any' ? limit : undefined,
                        reuse: args.reuse ? 1 : undefined,
                        voice: args.voice ? 1 : undefined,
                        forwarding: args.forwarding ? 1 : undefined,
                        number: args.forwardingNumber,
                        ref: process.env.FIVESIM_REF,
                    },
                },
            )
        }),
    )

    server.registerTool(
        'reuse_number',
        {
            title: 'Re-buy number',
            description: `Buy the same number again for a product (only if it was bought with reuse). ${SPEND_NOTE}`,
            inputSchema: {
                product: slug('Product id'),
                number: z.string().regex(/^\d{4,15}$/).describe('Phone number, 4-15 digits without +'),
            },
            annotations: { title: 'Re-buy number', ...DESTRUCTIVE },
        },
        safe(async ({ product, number }: { product: string; number: string }) =>
            client.get(`/v1/user/reuse/${enc(product)}/${enc(number)}`),
        ),
    )

    server.registerTool(
        'finish_order',
        {
            title: 'Finish order',
            description: 'Mark an order as finished after the SMS was received and used.',
            inputSchema: { id: orderId },
            annotations: { title: 'Finish order', ...DESTRUCTIVE, idempotentHint: true },
        },
        safe(async ({ id }: { id: number }) => client.get(`/v1/user/finish/${id}`)),
    )

    server.registerTool(
        'cancel_order',
        {
            title: 'Cancel order',
            description: 'Cancel an order that has not received an SMS; the money is returned to the balance.',
            inputSchema: { id: orderId },
            annotations: { title: 'Cancel order', ...DESTRUCTIVE, idempotentHint: true },
        },
        safe(async ({ id }: { id: number }) => client.get(`/v1/user/cancel/${id}`)),
    )

    server.registerTool(
        'ban_order',
        {
            title: 'Ban number',
            description: 'Report the number as already used / banned by the service; the order is closed and refunded.',
            inputSchema: { id: orderId },
            annotations: { title: 'Ban number', ...DESTRUCTIVE, idempotentHint: true },
        },
        safe(async ({ id }: { id: number }) => client.get(`/v1/user/ban/${id}`)),
    )
}
