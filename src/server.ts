import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { FiveSimClient, type FiveSimClientOptions } from './client.js'
import { fetchCountries, registerGuestTools } from './tools/guest.js'
import { registerUserTools } from './tools/user.js'
import { registerOrderTools } from './tools/orders.js'
import type { ServerConfig } from './tools/shared.js'

export const VERSION = '1.0.1'

const bool = (v: string | undefined) => v === '1' || v?.toLowerCase() === 'true'

export const configFromEnv = (env: NodeJS.ProcessEnv = process.env): ServerConfig => {
    const maxPrice = env.FIVESIM_MAX_PRICE ? Number(env.FIVESIM_MAX_PRICE) : undefined
    if (maxPrice !== undefined && !(maxPrice > 0)) {
        throw new Error('FIVESIM_MAX_PRICE must be a positive number')
    }
    return {
        readOnly: bool(env.FIVESIM_READ_ONLY),
        maxPrice,
    }
}

const ORDER_STATUSES = `PENDING - preparation
RECEIVED - number issued, waiting for SMS
CANCELED - cancelled (refunded)
TIMEOUT - expired without SMS (refunded)
FINISHED - completed
BANNED - number already used by the service (refunded)`

export const createServer = (
    clientOptions: FiveSimClientOptions,
    config: ServerConfig = configFromEnv(),
): McpServer => {
    const client = new FiveSimClient({ userAgent: `5sim-mcp/${VERSION}`, ...clientOptions })
    const server = new McpServer(
        { name: '5sim', title: '5sim virtual numbers', version: VERSION, websiteUrl: 'https://5sim.net' },
        {
            instructions:
                '5sim.net provides virtual phone numbers for SMS verification. Typical flow: find_cheapest_offer → confirm the price with the user → buy_activation_number → wait_for_sms → finish_order (or cancel_order for a refund if no SMS arrives). Ids are lowercase 5sim names: countries like "england", "usa", operators like "virtual21" or "any", products like "telegram". Buying spends the user balance: always confirm first.',
        },
    )
    const ctx = { client, config }

    registerGuestTools(server, ctx)
    registerUserTools(server, ctx)
    registerOrderTools(server, ctx)

    server.registerResource(
        'countries',
        '5sim://countries',
        { title: '5sim countries', description: 'Country ids, names, ISO identifiers and phone prefixes', mimeType: 'application/json' },
        async (uri) => ({
            contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await fetchCountries(client)) }],
        }),
    )

    server.registerResource(
        'order-statuses',
        '5sim://order-statuses',
        { title: '5sim order statuses', mimeType: 'text/plain' },
        async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/plain', text: ORDER_STATUSES }] }),
    )

    server.registerPrompt(
        'receive-verification-sms',
        {
            title: 'Receive a verification SMS',
            description: 'Buy a number for a service and wait for the verification SMS',
            argsSchema: {
                service: z.string().describe('Service to verify, e.g. telegram'),
                country: z.string().optional().describe('Preferred country'),
            },
        },
        ({ service, country }) => ({
            messages: [
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `I need to receive a verification SMS for ${service}${country ? ` with a number from ${country}` : ''} via 5sim.
1. Use get_profile to check my balance.
2. Use find_cheapest_offer (product "${service}"${country ? `, country "${country}"` : ''}) and show me the top options with price and delivery rate.
3. Wait for my confirmation, then buy_activation_number with the chosen offer.
4. Give me the phone number, then wait_for_sms and show me the message.
5. When I confirm the verification worked, finish_order; if no SMS arrives, cancel_order to get a refund.`,
                    },
                },
            ],
        }),
    )

    return server
}
