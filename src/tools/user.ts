import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { READ_ONLY, WRITE, pagination, safe, slug, type ToolContext } from './shared.js'

type Page = { limit?: number; offset?: number; order?: string; reverse?: boolean }

export const registerUserTools = (server: McpServer, { client, config }: ToolContext) => {
    server.registerTool(
        'get_profile',
        {
            title: 'Get profile and balance',
            description:
                'Get the 5sim account profile: id, email, balance, frozen balance, rating, default country/operator.',
            inputSchema: {},
            annotations: { title: 'Get profile and balance', ...READ_ONLY },
        },
        safe(async () => client.get('/v1/user/profile')),
    )

    server.registerTool(
        'get_order_history',
        {
            title: 'Get order history',
            description: 'List past activation orders with pagination.',
            inputSchema: { ...pagination },
            annotations: { title: 'Get order history', ...READ_ONLY },
        },
        safe(async (page: Page) =>
            client.get('/v1/user/orders', {
                query: { category: 'activation', limit: page.limit ?? 15, offset: page.offset, order: page.order ?? 'id', reverse: page.reverse ?? true },
            }),
        ),
    )

    server.registerTool(
        'get_payments_history',
        {
            title: 'Get payments history',
            description: 'List balance top-ups and charges with pagination.',
            inputSchema: { ...pagination },
            annotations: { title: 'Get payments history', ...READ_ONLY },
        },
        safe(async (page: Page) =>
            client.get('/v1/user/payments', {
                query: { limit: page.limit ?? 15, offset: page.offset, order: page.order ?? 'id', reverse: page.reverse ?? true },
            }),
        ),
    )

    server.registerTool(
        'get_max_prices',
        {
            title: 'List max price limits',
            description: 'List the per-product maximum purchase price limits set on the account.',
            inputSchema: {},
            annotations: { title: 'List max price limits', ...READ_ONLY },
        },
        safe(async () => client.get('/v1/user/max-prices')),
    )

    if (config.readOnly) return

    server.registerTool(
        'set_max_price',
        {
            title: 'Set max price limit',
            description:
                'Create or update the maximum purchase price for a product (applies to purchases with operator "any").',
            inputSchema: {
                product: slug('Product id, e.g. "telegram"'),
                price: z.number().positive().describe('Maximum price'),
            },
            annotations: { title: 'Set max price limit', ...WRITE },
        },
        safe(async ({ product, price }: { product: string; price: number }) =>
            client.post('/v1/user/max-prices', { body: { product_name: product, price } }),
        ),
    )

    server.registerTool(
        'delete_max_price',
        {
            title: 'Delete max price limit',
            description: 'Remove the maximum purchase price limit for a product.',
            inputSchema: { product: slug('Product id') },
            annotations: { title: 'Delete max price limit', ...WRITE },
        },
        safe(async ({ product }: { product: string }) =>
            client.delete('/v1/user/max-prices', { body: { product_name: product } }),
        ),
    )
}
