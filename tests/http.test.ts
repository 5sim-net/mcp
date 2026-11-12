import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { startHttpServer } from '../src/http.js'

let server: Server
let base: string

beforeAll(async () => {
    server = startHttpServer(0, '127.0.0.1')
    await new Promise((r) => server.once('listening', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((r) => server.close(() => r())))

const rpc = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
        body: JSON.stringify(body),
    })

describe('HTTP transport', () => {
    it('health endpoint', async () => {
        const res = await fetch(`${base}/health`)
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ status: 'ok' })
    })

    it('initialize and list tools statelessly', async () => {
        const init = await rpc({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
        })
        expect(init.status).toBe(200)
        expect((await init.json()).result.serverInfo.name).toBe('5sim')

        const list = await rpc(
            { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
            { Authorization: 'Bearer abc', 'Mcp-Protocol-Version': '2025-06-18' },
        )
        expect(list.status).toBe(200)
        const tools = (await list.json()).result.tools as { name: string }[]
        expect(tools.map((t) => t.name)).toContain('buy_activation_number')
    })

    it('rejects GET on /mcp and unknown paths', async () => {
        expect((await fetch(`${base}/mcp`)).status).toBe(405)
        expect((await fetch(`${base}/nope`)).status).toBe(404)
    })

    it('rejects invalid JSON', async () => {
        const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })
        expect(res.status).toBe(400)
    })
})
