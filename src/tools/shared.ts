import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { FiveSimClient, FiveSimError } from '../client.js'

export interface ServerConfig {
    /** Disable every tool that spends balance or changes state */
    readOnly: boolean
    /** Hard cap for a single purchase, enforced by the server */
    maxPrice?: number
}

export interface ToolContext {
    client: FiveSimClient
    config: ServerConfig
}

/** 5sim identifiers: country / operator / product names like "england", "virtual21", "telegram" */
export const slug = (what: string) =>
    z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-zA-Z0-9_.-]+$/, `${what} must be a 5sim id like "any", "england", "telegram"`)
        .describe(what)

export const orderId = z
    .number()
    .int()
    .positive()
    .describe('5sim order ID (the "id" returned by a buy tool)')

export const pagination = {
    limit: z.number().int().min(1).max(100).optional().describe('Page size (default 15)'),
    offset: z.number().int().min(0).optional().describe('Page offset'),
    order: z.string().regex(/^[a-z_]+$/).optional().describe('Field to sort by, e.g. "id"'),
    reverse: z.boolean().optional().describe('Newest first when true'),
}

export const ok = (data: unknown): CallToolResult => ({
    content: [
        {
            type: 'text',
            text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
        },
    ],
})

export const fail = (error: unknown): CallToolResult => ({
    isError: true,
    content: [
        {
            type: 'text',
            text:
                error instanceof FiveSimError || error instanceof Error
                    ? error.message
                    : String(error),
        },
    ],
})

export const safe =
    <A>(fn: (args: A) => Promise<unknown>) =>
    async (args: A): Promise<CallToolResult> => {
        try {
            return ok(await fn(args))
        } catch (error) {
            return fail(error)
        }
    }

export const enc = encodeURIComponent

export type Register = McpServer['registerTool']

export const READ_ONLY = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
} as const

export const WRITE = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
} as const

export const DESTRUCTIVE = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
} as const

export const SPEND_NOTE =
    'SPENDS REAL MONEY from the 5sim balance. Confirm the product, country, operator and price with the user before calling.'
