import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { FiveSimClient } from '../client.js'
import { READ_ONLY, enc, safe, slug, type ToolContext } from './shared.js'

type PriceEntry = { cost: number; count: number; rate?: number } & Record<string, number | undefined>
type PricesDto = Record<string, Record<string, Record<string, PriceEntry>>>

export interface Offer {
    country: string
    product: string
    operator: string
    cost: number
    count: number
    /** Delivery rate %, omitted by 5sim when < 20% or too few orders */
    rate?: number
}

/**
 * /v1/guest/prices is nested as country → product → operator when `country`
 * is given, and product → country → operator when only `product` is given.
 */
export const flattenPrices = (data: PricesDto, byCountry: boolean): Offer[] => {
    const offers: Offer[] = []
    for (const [outer, inner] of Object.entries(data ?? {})) {
        for (const [middle, operators] of Object.entries(inner ?? {})) {
            for (const [operator, entry] of Object.entries(operators ?? {})) {
                if (!entry || typeof entry !== 'object') continue
                offers.push({
                    country: byCountry ? outer : middle,
                    product: byCountry ? middle : outer,
                    operator,
                    cost: entry.cost,
                    count: entry.count,
                    rate: entry.rate,
                })
            }
        }
    }
    return offers
}

export const fetchOffers = async (
    client: FiveSimClient,
    { country, product }: { country?: string; product?: string },
): Promise<Offer[]> => {
    const data = await client.get<PricesDto>('/v1/guest/prices', {
        auth: false,
        query: { country, product },
    })
    return flattenPrices(data, !!country)
}

export interface CountryInfo {
    id: string
    name: string
    iso: string[]
    prefix: string[]
}

export const fetchCountries = async (client: FiveSimClient): Promise<CountryInfo[]> => {
    const data = await client.get<Record<string, Record<string, unknown>>>(
        '/v1/guest/countries',
        { auth: false },
    )
    return Object.entries(data ?? {}).map(([id, c]) => ({
        id,
        name: String(c.text_en ?? id),
        iso: Object.keys((c.iso as object) ?? {}),
        prefix: Object.keys((c.prefix as object) ?? {}),
    }))
}

export const registerGuestTools = (server: McpServer, { client }: ToolContext) => {
    server.registerTool(
        'get_countries',
        {
            title: 'List countries',
            description:
                'List all countries supported by 5sim with their API id (use it as "country" in other tools), English name, ISO identifier and phone prefix. Optional search filters by id/name/iso/prefix.',
            inputSchema: {
                search: z.string().max(64).optional().describe('Case-insensitive filter, e.g. "united", "gb", "+44"'),
            },
            annotations: { title: 'List countries', ...READ_ONLY },
        },
        safe(async ({ search }: { search?: string }) => {
            const countries = await fetchCountries(client)
            if (!search) return countries
            const q = search.toLowerCase()
            return countries.filter(
                (c) =>
                    c.id.includes(q) ||
                    c.name.toLowerCase().includes(q) ||
                    c.iso.includes(q) ||
                    c.prefix.some((p) => p.includes(q)),
            )
        }),
    )

    server.registerTool(
        'get_products',
        {
            title: 'List products for country/operator',
            description:
                'List products (services such as telegram, whatsapp, google) available for a country and operator, with available quantity and starting price. Use "any" for any country/operator.',
            inputSchema: {
                country: slug('Country id, or "any"').default('any'),
                operator: slug('Operator id, or "any"').default('any'),
                search: z.string().max(64).optional().describe('Filter product ids by substring'),
                includeUnavailable: z.boolean().optional().describe('Include products with zero quantity'),
            },
            annotations: { title: 'List products', ...READ_ONLY },
        },
        safe(async (args: {
            country: string
            operator: string
            search?: string
            includeUnavailable?: boolean
        }) => {
            const data = await client.get<Record<string, { Category: string; Qty: number; Price: number }>>(
                `/v1/guest/products/${enc(args.country)}/${enc(args.operator)}`,
                { auth: false },
            )
            return Object.entries(data ?? {})
                .map(([product, p]) => ({ product, category: p.Category, qty: p.Qty, price: p.Price }))
                .filter((p) => args.includeUnavailable || p.qty > 0)
                .filter((p) => p.category === 'activation')
                .filter((p) => !args.search || p.product.includes(args.search.toLowerCase()))
        }),
    )

    server.registerTool(
        'get_prices',
        {
            title: 'Get prices',
            description:
                'Get activation prices by country and/or product, per operator: cost (USD-equivalent balance units), available count, and delivery rate %. At least one of country/product is required (the full price list is too large).',
            inputSchema: {
                country: slug('Country id').optional(),
                product: slug('Product id, e.g. "telegram"').optional(),
                operator: slug('Operator id filter').optional(),
                includeUnavailable: z.boolean().optional().describe('Include operators with zero numbers'),
            },
            annotations: { title: 'Get prices', ...READ_ONLY },
        },
        safe(async (args: { country?: string; product?: string; operator?: string; includeUnavailable?: boolean }) => {
            if (!args.country && !args.product) {
                throw new Error('Pass country, product, or both.')
            }
            const offers = await fetchOffers(client, args)
            return offers
                .filter((o) => args.includeUnavailable || o.count > 0)
                .filter((o) => !args.operator || o.operator === args.operator)
        }),
    )

    server.registerTool(
        'find_cheapest_offer',
        {
            title: 'Find cheapest offer',
            description:
                'Find the best offers to buy an activation number for a product: only offers with numbers in stock, sorted by price (then delivery rate). Use before buy_activation_number.',
            inputSchema: {
                product: slug('Product id, e.g. "telegram"'),
                country: slug('Restrict to a country id').optional(),
                minRate: z.number().min(0).max(100).optional().describe('Minimum delivery rate %; offers without a rate are excluded when set'),
                maxPrice: z.number().positive().optional().describe('Maximum price'),
                limit: z.number().int().min(1).max(50).default(10),
            },
            annotations: { title: 'Find cheapest offer', ...READ_ONLY },
        },
        safe(async (args: { product: string; country?: string; minRate?: number; maxPrice?: number; limit: number }) => {
            const offers = (await fetchOffers(client, args))
                .filter((o) => o.count > 0 && o.product === args.product)
                .filter((o) => args.minRate === undefined || (o.rate ?? -1) >= args.minRate)
                .filter((o) => args.maxPrice === undefined || o.cost <= args.maxPrice)
                .sort((a, b) => a.cost - b.cost || (b.rate ?? 0) - (a.rate ?? 0))
            if (!offers.length) return 'No offers in stock match these filters.'
            return offers.slice(0, args.limit)
        }),
    )

    server.registerTool(
        'get_notifications',
        {
            title: 'Get notifications',
            description: 'Get the current 5sim service notification (announcements, maintenance).',
            inputSchema: {
                lang: z.enum(['en', 'ru']).default('en'),
            },
            annotations: { title: 'Get notifications', ...READ_ONLY },
        },
        safe(async ({ lang }: { lang: string }) =>
            client.get(`/v1/guest/flash/${enc(lang)}`, { auth: client.hasApiKey }),
        ),
    )
}
