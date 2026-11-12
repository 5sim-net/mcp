import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer } from '../src/server.js'
import type { ServerConfig } from '../src/tools/shared.js'

type Route = (url: URL, init: RequestInit) => { status?: number; body: unknown }

const mockFetch = (routes: Record<string, Route | unknown>) => {
    const calls: { method: string; url: URL; init: RequestInit }[] = []
    const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
        const url = new URL(String(input))
        const method = init.method ?? 'GET'
        calls.push({ method, url, init })
        const key = `${method} ${url.pathname}`
        const route = routes[key]
        if (route === undefined) return new Response('not mocked: ' + key, { status: 404 })
        const result = typeof route === 'function' ? (route as Route)(url, init) : { body: route }
        const text = typeof result.body === 'string' ? result.body : JSON.stringify(result.body)
        return new Response(text, { status: result.status ?? 200 })
    })
    return { fetch: fn as unknown as typeof fetch, calls }
}

const defaults: ServerConfig = { readOnly: false }

const connect = async (
    routes: Record<string, Route | unknown>,
    config: Partial<ServerConfig> = {},
    apiKey: string | undefined = 'test-key',
) => {
    const { fetch, calls } = mockFetch(routes)
    const server = createServer({ apiKey, fetch, sleep: async () => {} }, { ...defaults, ...config })
    const client = new Client({ name: 'test', version: '0' })
    const [a, b] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(a), client.connect(b)])
    const call = async (name: string, args: Record<string, unknown> = {}) => {
        const res = (await client.callTool({ name, arguments: args })) as {
            isError?: boolean
            content: { type: string; text: string }[]
        }
        const text = res.content[0]?.text ?? ''
        let data: unknown = text
        try {
            data = JSON.parse(text)
        } catch {}
        return { isError: !!res.isError, text, data }
    }
    return { client, call, calls }
}

const PRICES_BY_COUNTRY = {
    england: {
        telegram: {
            virtual1: { cost: 0.5, count: 10, rate: 90 },
            virtual2: { cost: 0.3, count: 0, rate: 99 },
            virtual3: { cost: 0.4, count: 5, rate: 50 },
        },
    },
}

describe('tool registration', () => {
    it('registers the full user tool set with annotations', async () => {
        const { client } = await connect({})
        const { tools } = await client.listTools()
        const names = tools.map((t) => t.name).sort()
        expect(names).toEqual(
            [
                'ban_order', 'buy_activation_number', 'cancel_order', 'check_order',
                'delete_max_price', 'find_cheapest_offer', 'finish_order', 'get_countries', 'get_max_prices',
                'get_notifications', 'get_order_history', 'get_payments_history', 'get_prices', 'get_products',
                'get_profile', 'reuse_number', 'set_max_price', 'wait_for_sms',
            ].sort(),
        )
        for (const tool of tools) {
            expect(tool.annotations?.title, tool.name).toBeTruthy()
            expect(typeof tool.annotations?.readOnlyHint, tool.name).toBe('boolean')
            expect(typeof tool.annotations?.destructiveHint, tool.name).toBe('boolean')
        }
        expect(tools.find((t) => t.name === 'buy_activation_number')?.annotations?.destructiveHint).toBe(true)
        expect(tools.find((t) => t.name === 'get_profile')?.annotations?.readOnlyHint).toBe(true)
    })

    it('read-only mode hides every write tool', async () => {
        const { client } = await connect({}, { readOnly: true })
        const { tools } = await client.listTools()
        for (const t of tools) expect(t.annotations?.readOnlyHint, t.name).toBe(true)
        expect(tools.some((t) => t.name.startsWith('buy_'))).toBe(false)
    })


    it('exposes resources and the prompt', async () => {
        const { client } = await connect({})
        const { resources } = await client.listResources()
        expect(resources.map((r) => r.uri)).toEqual(expect.arrayContaining(['5sim://countries', '5sim://order-statuses']))
        const { prompts } = await client.listPrompts()
        expect(prompts.map((p) => p.name)).toContain('receive-verification-sms')
    })
})

describe('guest tools', () => {
    it('get_prices flattens and drops empty offers; guest calls send no key', async () => {
        const { call, calls } = await connect({ 'GET /v1/guest/prices': PRICES_BY_COUNTRY })
        const res = await call('get_prices', { country: 'england', product: 'telegram' })
        expect(res.isError).toBe(false)
        expect(res.data).toHaveLength(2)
        expect(calls[0].url.searchParams.get('country')).toBe('england')
        expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined()
    })

    it('get_prices requires a filter', async () => {
        const { call } = await connect({})
        expect((await call('get_prices', {})).isError).toBe(true)
    })

    it('find_cheapest_offer handles product-first nesting and sorts by cost', async () => {
        const { call } = await connect({
            'GET /v1/guest/prices': {
                telegram: {
                    usa: { virtual1: { cost: 0.9, count: 3, rate: 80 } },
                    england: { virtual3: { cost: 0.4, count: 5, rate: 50 }, virtual9: { cost: 0.1, count: 0 } },
                },
            },
        })
        const res = await call('find_cheapest_offer', { product: 'telegram' })
        expect(res.data).toEqual([
            { country: 'england', product: 'telegram', operator: 'virtual3', cost: 0.4, count: 5, rate: 50 },
            { country: 'usa', product: 'telegram', operator: 'virtual1', cost: 0.9, count: 3, rate: 80 },
        ])
        const filtered = await call('find_cheapest_offer', { product: 'telegram', minRate: 60 })
        expect((filtered.data as unknown[]).length).toBe(1)
    })

    it('get_countries compacts and searches', async () => {
        const { call } = await connect({
            'GET /v1/guest/countries': {
                england: { iso: { gb: 1 }, prefix: { '+44': 1 }, text_en: 'England' },
                usa: { iso: { us: 1 }, prefix: { '+1': 1 }, text_en: 'USA' },
            },
        })
        const res = await call('get_countries', { search: '+44' })
        expect(res.data).toEqual([{ id: 'england', name: 'England', iso: ['gb'], prefix: ['+44'] }])
    })

    it('get_products filters zero quantity', async () => {
        const { call, calls } = await connect({
            'GET /v1/guest/products/any/any': {
                telegram: { Category: 'activation', Qty: 3, Price: 0.2 },
                dead: { Category: 'activation', Qty: 0, Price: 0.1 },
            },
        })
        const res = await call('get_products', {})
        expect(res.data).toEqual([{ product: 'telegram', category: 'activation', qty: 3, price: 0.2 }])
        expect(calls[0].url.pathname).toBe('/v1/guest/products/any/any')
    })

    it('rejects ids that could alter the URL path', async () => {
        const { call, calls } = await connect({})
        const res = await call('get_products', { country: '../user', operator: 'any' })
        expect(res.isError).toBe(true)
        expect(calls).toHaveLength(0)
    })
})

describe('user and order tools', () => {
    it('get_profile sends the bearer key', async () => {
        const { call, calls } = await connect({ 'GET /v1/user/profile': { id: 1, balance: 10 } })
        const res = await call('get_profile')
        expect(res.data).toEqual({ id: 1, balance: 10 })
        expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer test-key')
    })

    it('auth tools fail clearly without a key and make no request', async () => {
        const { call, calls } = await connect({}, {}, '')
        const res = await call('get_profile')
        expect(res.isError).toBe(true)
        expect(res.text).toMatch(/API key/)
        expect(calls).toHaveLength(0)
    })

    it('maps 401 to a helpful error', async () => {
        const { call } = await connect({ 'GET /v1/user/profile': () => ({ status: 401, body: '' }) })
        const res = await call('get_profile')
        expect(res.isError).toBe(true)
        expect(res.text).toMatch(/Unauthorized/)
    })

    it('retries read requests on 429 then succeeds', async () => {
        let n = 0
        const { call, calls } = await connect({
            'GET /v1/user/profile': () => (n++ === 0 ? { status: 429, body: '' } : { body: { id: 1 } }),
        })
        const res = await call('get_profile')
        expect(res.isError).toBe(false)
        expect(calls).toHaveLength(2)
    })

    it('never retries purchases on 503', async () => {
        const { call, calls } = await connect({
            'GET /v1/user/buy/activation/any/any/telegram': () => ({ status: 503, body: '' }),
        })
        const res = await call('buy_activation_number', { product: 'telegram' })
        expect(res.isError).toBe(true)
        expect(res.text).toMatch(/Rate limited/)
        expect(calls).toHaveLength(1)
    })

    it('turns "no free phones" (HTTP 200 text) into an error', async () => {
        const { call } = await connect({ 'GET /v1/user/buy/activation/any/any/telegram': 'no free phones' })
        const res = await call('buy_activation_number', { product: 'telegram' })
        expect(res.isError).toBe(true)
        expect(res.text).toMatch(/no free phones/)
    })

    it('buy with operator any passes min(maxPrice, server cap)', async () => {
        const { call, calls } = await connect(
            { 'GET /v1/user/buy/activation/england/any/telegram': { id: 7, phone: '+447000' } },
            { maxPrice: 1 },
        )
        const res = await call('buy_activation_number', { product: 'telegram', country: 'england', maxPrice: 5, reuse: true })
        expect(res.data).toEqual({ id: 7, phone: '+447000' })
        expect(calls[0].url.searchParams.get('maxPrice')).toBe('1')
        expect(calls[0].url.searchParams.get('reuse')).toBe('1')
    })

    it('server cap blocks a too-expensive specific operator before buying', async () => {
        const { call, calls } = await connect(
            { 'GET /v1/guest/prices': PRICES_BY_COUNTRY, 'GET /v1/user/buy/activation/england/virtual1/telegram': { id: 1 } },
            { maxPrice: 0.45 },
        )
        const res = await call('buy_activation_number', { product: 'telegram', country: 'england', operator: 'virtual1' })
        expect(res.isError).toBe(true)
        expect(res.text).toMatch(/exceeds the limit/)
        expect(calls.some((c) => c.url.pathname.includes('/buy/'))).toBe(false)

        const ok = await call('buy_activation_number', { product: 'telegram', country: 'england', operator: 'virtual3' })
        expect(ok.data).toBeTruthy()
    })


    it('order lifecycle endpoints', async () => {
        const { call, calls } = await connect({
            'GET /v1/user/check/5': { id: 5, status: 'RECEIVED', sms: [] },
            'GET /v1/user/finish/5': { id: 5, status: 'FINISHED' },
            'GET /v1/user/cancel/5': { id: 5, status: 'CANCELED' },
            'GET /v1/user/ban/5': { id: 5, status: 'BANNED' },
            'GET /v1/user/reuse/telegram/447000000': { id: 6 },
        })
        for (const name of ['check_order', 'finish_order', 'cancel_order', 'ban_order']) {
            expect((await call(name, { id: 5 })).isError, name).toBe(false)
        }
        expect((await call('reuse_number', { product: 'telegram', number: '447000000' })).data).toEqual({ id: 6 })
        expect(calls).toHaveLength(5)
    })

    it('wait_for_sms returns as soon as an SMS arrives', async () => {
        let n = 0
        const { call } = await connect({
            'GET /v1/user/check/5': () => ({
                body: { id: 5, status: 'RECEIVED', sms: n++ === 0 ? [] : [{ code: '12345', text: 'Code 12345' }] },
            }),
        })
        vi.useFakeTimers({ toFake: ['setTimeout'] })
        const pending = call('wait_for_sms', { id: 5, timeoutSec: 30, intervalSec: 3 })
        await vi.advanceTimersByTimeAsync(3100)
        vi.useRealTimers()
        const res = await pending
        expect((res.data as { sms: { code: string }[] }).sms[0].code).toBe('12345')
    })

    it('order history and max prices', async () => {
        const { call, calls } = await connect({
            'GET /v1/user/orders': { Data: [], Total: 0 },
            'GET /v1/user/payments': { Data: [], Total: 0 },
            'GET /v1/user/max-prices': [],
            'POST /v1/user/max-prices': '',
            'DELETE /v1/user/max-prices': '',
        })
        await call('get_order_history', { limit: 5 })
        expect(calls[0].url.searchParams.get('category')).toBe('activation')
        expect(calls[0].url.searchParams.get('limit')).toBe('5')
        await call('get_payments_history')
        await call('get_max_prices')
        expect((await call('set_max_price', { product: 'telegram', price: 1 })).isError).toBe(false)
        expect(JSON.parse(String(calls[3].init.body))).toEqual({ product_name: 'telegram', price: 1 })
        expect((await call('delete_max_price', { product: 'telegram' })).isError).toBe(false)
    })
})

