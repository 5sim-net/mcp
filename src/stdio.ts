#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.js'

const main = async () => {
    if (process.argv.includes('--http') || process.env.MCP_TRANSPORT === 'http') {
        const { startHttpServer } = await import('./http.js')
        startHttpServer()
        return
    }
    const server = createServer({
        apiKey: process.env.FIVESIM_API_KEY,
        baseUrl: process.env.FIVESIM_BASE_URL,
    })
    await server.connect(new StdioServerTransport())
    if (!process.env.FIVESIM_API_KEY) {
        console.error('[5sim-mcp] FIVESIM_API_KEY is not set: only public tools (prices, countries, products) will work.')
    }
}

main().catch((error) => {
    console.error('[5sim-mcp] fatal:', error)
    process.exit(1)
})
