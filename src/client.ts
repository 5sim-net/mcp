/**
 * Thin, dependency-free HTTP client for the 5sim.net public API.
 * Docs: https://5sim.net/docs
 */

export const DEFAULT_BASE_URL = 'https://5sim.net'

type QueryValue = string | number | boolean | undefined | null
export type Query = Record<string, QueryValue>

export interface FiveSimClientOptions {
    /** 5sim API key (JWT) from https://5sim.net/settings/security */
    apiKey?: string
    /** API base URL. Mirrors: https://5sim.net, https://5sim.com */
    baseUrl?: string
    /** Request timeout, ms */
    timeoutMs?: number
    /** Retries on 429/503 rate limit responses */
    maxRetries?: number
    /** Custom fetch (tests) */
    fetch?: typeof fetch
    /** Custom sleep (tests) */
    sleep?: (ms: number) => Promise<void>
    userAgent?: string
}

export interface RequestOptions {
    query?: Query
    body?: unknown
    /** Whether the endpoint needs the API key. Default: true */
    auth?: boolean
}

/**
 * 5sim returns some business errors as plain text with HTTP 200
 * (e.g. "no free phones"). These are converted to errors.
 */
const TEXT_ERRORS = [
    'no free phones',
    'not enough user balance',
    'not enough rating',
    'select country',
    'select operator',
    'bad country',
    'bad operator',
    'no product',
    'server offline',
    'order not found',
    'order expired',
    'order has sms',
    'hosting order',
    'order no sms',
    'record not found',
    'reuse not possible',
    'reuse false',
    'reuse expired',
]

export class FiveSimError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly body?: unknown,
    ) {
        super(message)
        this.name = 'FiveSimError'
    }
}

const hint = (status: number, message: string): string => {
    if (status === 401)
        return 'Unauthorized: the 5sim API key is missing, invalid or blocked. Get a key at https://5sim.net/settings/security'
    if (status === 429 || status === 503)
        return `Rate limited by 5sim (HTTP ${status}). Limit is 100 req/s; 5 hits within 10 minutes cause a 10-minute ban. Slow down and retry later.`
    if (message === 'no free phones')
        return 'no free phones: no numbers available for this country/operator/product. Try another operator ("any"), another country, or a higher maxPrice.'
    if (message === 'not enough user balance')
        return 'not enough user balance: top up at https://5sim.net/payment'
    return message
}

export class FiveSimClient {
    readonly baseUrl: string
    private readonly apiKey?: string
    private readonly timeoutMs: number
    private readonly maxRetries: number
    private readonly fetchImpl: typeof fetch
    private readonly sleep: (ms: number) => Promise<void>
    private readonly userAgent: string

    constructor(options: FiveSimClientOptions = {}) {
        this.apiKey = options.apiKey?.trim() || undefined
        this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
        this.timeoutMs = options.timeoutMs ?? 30_000
        this.maxRetries = options.maxRetries ?? 2
        this.fetchImpl = options.fetch ?? fetch
        this.sleep =
            options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
        this.userAgent = options.userAgent ?? '5sim-mcp'
    }

    get hasApiKey(): boolean {
        return !!this.apiKey
    }

    get<T = unknown>(path: string, options?: RequestOptions) {
        return this.request<T>('GET', path, options)
    }

    post<T = unknown>(path: string, options?: RequestOptions) {
        return this.request<T>('POST', path, options)
    }

    put<T = unknown>(path: string, options?: RequestOptions) {
        return this.request<T>('PUT', path, options)
    }

    delete<T = unknown>(path: string, options?: RequestOptions) {
        return this.request<T>('DELETE', path, options)
    }

    buildUrl(path: string, query?: Query): string {
        const url = new URL(this.baseUrl + path)
        for (const [key, value] of Object.entries(query ?? {})) {
            if (value === undefined || value === null || value === '') continue
            url.searchParams.set(key, String(value))
        }
        return url.toString()
    }

    async request<T = unknown>(
        method: string,
        path: string,
        { query, body, auth = true }: RequestOptions = {},
    ): Promise<T> {
        if (auth && !this.apiKey) {
            throw new FiveSimError(
                'This tool needs a 5sim API key. Set FIVESIM_API_KEY (stdio) or send "Authorization: Bearer <key>" (HTTP). Get a key at https://5sim.net/settings/security',
                401,
            )
        }

        const headers: Record<string, string> = {
            Accept: 'application/json',
            'User-Agent': this.userAgent,
        }
        if (auth && this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`
        if (body !== undefined) headers['Content-Type'] = 'application/json'

        const url = this.buildUrl(path, query)

        for (let attempt = 0; ; attempt++) {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), this.timeoutMs)
            let response: Response
            try {
                response = await this.fetchImpl(url, {
                    method,
                    headers,
                    body: body === undefined ? undefined : JSON.stringify(body),
                    signal: controller.signal,
                })
            } catch (error) {
                clearTimeout(timer)
                const reason =
                    (error as Error)?.name === 'AbortError'
                        ? `timed out after ${this.timeoutMs} ms`
                        : (error as Error)?.message
                throw new FiveSimError(
                    `Network error calling 5sim ${method} ${path}: ${reason}`,
                    0,
                )
            }
            clearTimeout(timer)

            if (
                (response.status === 429 || response.status === 503) &&
                attempt < this.maxRetries
            ) {
                // Never auto-retry purchases: 503 may also mean "buy limit"
                // and a retry could buy twice.
                if (!path.includes('/buy/') && !path.includes('/reuse/')) {
                    await this.sleep(1000 * 2 ** attempt)
                    continue
                }
            }

            return this.parse<T>(response, method, path)
        }
    }

    private async parse<T>(
        response: Response,
        method: string,
        path: string,
    ): Promise<T> {
        const text = await response.text()
        let data: unknown = text
        if (text) {
            try {
                data = JSON.parse(text)
            } catch {
                data = text.trim()
            }
        } else {
            data = null
        }

        if (!response.ok) {
            const message =
                typeof data === 'string' && data
                    ? data
                    : typeof data === 'object' && data && 'message' in data
                      ? String((data as { message: unknown }).message)
                      : `HTTP ${response.status} ${response.statusText}`
            throw new FiveSimError(
                `5sim ${method} ${path} failed (HTTP ${response.status}): ${hint(response.status, message)}`,
                response.status,
                data,
            )
        }

        if (typeof data === 'string' && TEXT_ERRORS.includes(data.toLowerCase())) {
            throw new FiveSimError(
                `5sim ${method} ${path}: ${hint(response.status, data.toLowerCase())}`,
                response.status,
                data,
            )
        }

        return data as T
    }
}
