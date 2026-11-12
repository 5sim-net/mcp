import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer, VERSION } from './server.js'

/**
 * Stateless Streamable HTTP transport. Every request carries the user's
 * 5sim API key in "Authorization: Bearer <key>" (or "X-5sim-Api-Key");
 * the key is only forwarded to 5sim and never stored or logged.
 */

const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '0.0.0.0'
const MCP_PATH = process.env.MCP_PATH ?? '/mcp'
const MAX_BODY = 1024 * 1024
const ALLOW_ANONYMOUS = process.env.FIVESIM_ALLOW_ANONYMOUS !== 'false'

export const extractApiKey = (req: IncomingMessage): string | undefined => {
    const auth = req.headers.authorization
    if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim() || undefined
    const header = req.headers['x-5sim-api-key']
    if (typeof header === 'string' && header.trim()) return header.trim()
    return undefined
}

const readBody = (req: IncomingMessage): Promise<unknown> =>
    new Promise((resolve, reject) => {
        let size = 0
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > MAX_BODY) {
                reject(new Error('Body too large'))
                req.destroy()
                return
            }
            chunks.push(chunk)
        })
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8')
            if (!raw) return resolve(undefined)
            try {
                resolve(JSON.parse(raw))
            } catch {
                reject(new Error('Invalid JSON'))
            }
        })
        req.on('error', reject)
    })

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
    res.end(JSON.stringify(body))
}

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, X-5sim-Api-Key',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
}

const SERVER_CARD = {
    serverInfo: { name: '5sim', version: VERSION },
    description: 'Buy virtual numbers for SMS verification and receive SMS online via 5sim.net',
    authentication: { required: false, schemes: ['bearer'] },
    documentation: 'https://github.com/5sim-net/mcp',
}

export const handle = async (req: IncomingMessage, res: ServerResponse) => {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (req.method === 'OPTIONS') {
        res.writeHead(204).end()
        return
    }
    if (url.pathname === '/health') return json(res, 200, { status: 'ok', version: VERSION })
    if (url.pathname === '/.well-known/mcp/server-card.json') return json(res, 200, SERVER_CARD)
    if (url.pathname === '/') {
        return json(res, 200, { name: '5sim MCP server', mcp: MCP_PATH, docs: SERVER_CARD.documentation })
    }
    if (url.pathname !== MCP_PATH) return json(res, 404, { error: 'Not found' })

    if (req.method !== 'POST') {
        // Stateless server: no SSE stream / session to resume or delete.
        return json(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }, { Allow: 'POST' })
    }

    const apiKey = extractApiKey(req)
    if (!apiKey && !ALLOW_ANONYMOUS) {
        return json(
            res,
            401,
            { jsonrpc: '2.0', error: { code: -32001, message: 'Send your 5sim API key as "Authorization: Bearer <key>"' }, id: null },
            { 'WWW-Authenticate': 'Bearer realm="5sim"' },
        )
    }

    let body: unknown
    try {
        body = await readBody(req)
    } catch (error) {
        return json(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: (error as Error).message }, id: null })
    }

    const server = createServer({ apiKey, baseUrl: process.env.FIVESIM_BASE_URL })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
        void transport.close()
        void server.close()
    })
    try {
        await server.connect(transport)
        await transport.handleRequest(req, res, body)
    } catch (error) {
        console.error('[5sim-mcp] request failed:', (error as Error).message)
        if (!res.headersSent) {
            json(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null })
        }
    }
}

export const startHttpServer = (port = PORT, host = HOST) => {
    const httpServer = createHttpServer((req, res) => void handle(req, res))
    httpServer.listen(port, host, () => {
        console.error(`[5sim-mcp] HTTP listening on http://${host}:${port}${MCP_PATH}`)
    })
    const shutdown = () => httpServer.close(() => process.exit(0))
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
    return httpServer
}

// Auto-start only when executed directly: `node dist/http.js`
const entry = process.argv[1]?.replace(/\\/g, '/') ?? ''
if (entry.endsWith('/dist/http.js')) startHttpServer()
