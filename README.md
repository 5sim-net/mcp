<div align="center">

<img src="icon.png" alt="5sim logo" width="96" height="96">

# 5sim MCP Server: virtual phone numbers and SMS verification for AI agents

**The official [Model Context Protocol](https://modelcontextprotocol.io) server for [5sim.net](https://5sim.net). Your AI agent can buy a virtual number for SMS verification, receive the SMS and manage orders. Numbers from $0.008, 150+ countries, 1,200+ services.**

[![npm version](https://img.shields.io/npm/v/@5sim-net/mcp?color=cb3837&logo=npm)](https://www.npmjs.com/package/@5sim-net/mcp)
[![CI](https://github.com/5sim-net/mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/5sim-net/mcp/actions/workflows/ci.yml)
[![MCP](https://img.shields.io/badge/MCP-compatible-6E56CF)](https://modelcontextprotocol.io)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Quick start](#quick-start) · [Tools](#tools) · [Configuration](#configuration) · [Examples](#example-prompts) · [Security](#security) · [FAQ](#faq) · [5sim API docs](https://5sim.net/docs)

</div>

---

## What is the 5sim MCP server?

[5sim.net](https://5sim.net) is a global SMS activation platform that has been running since 2015. You can buy a virtual number for SMS verification from $0.008 and receive SMS online with temporary numbers from 150+ countries for 1,200+ services, including Telegram, WhatsApp, Google, Discord and TikTok.

This MCP server connects any MCP client to the [5sim API](https://5sim.net/docs). That includes Claude Desktop, Claude Code, Cursor, Windsurf, Cline, VS Code (GitHub Copilot) and Zed. Once it is connected, you can ask *"get me a Telegram number in England and show me the SMS"*, and the agent will:

1. **find the best offer**: it compares price, stock and delivery rate across operators;
2. **ask you to confirm** the price;
3. **buy the number** and **wait for the SMS**;
4. **show you the message**;
5. **finish the order**, or **cancel it for a refund** if no SMS arrives.

It covers the 5sim user API:

- activation numbers and re-buying a number;
- order status, received SMS, and order and payment history;
- prices, countries, operators and services;
- per-service price limits.

## Features

- 🔢 **Virtual numbers on demand**: activation numbers for SMS verification in 150+ countries.
- 📩 **SMS in the chat**: `wait_for_sms` polls the order until the message arrives.
- 💸 **Best price search**: `find_cheapest_offer` ranks in-stock offers by price and delivery rate.
- 🛡️ **Safe by design**:
  - a server-side price cap (`FIVESIM_MAX_PRICE`) the agent can't exceed;
  - a read-only mode;
  - purchases are never retried automatically;
  - MCP annotations on every tool, so clients ask you before anything is paid for.
- 🌍 **Local or remote**: `npx` over stdio, Docker, or stateless Streamable HTTP.
- 🧩 **Resources and prompts**: a country list, order statuses and a ready-made `receive-verification-sms` workflow.
- 🪶 **Lightweight**: TypeScript, two dependencies (`@modelcontextprotocol/sdk`, `zod`), MIT license.

## Quick start

1. **Get an API key**: sign up at [5sim.net](https://5sim.net), top up your balance and copy the key from [Settings → API](https://5sim.net/settings/security).
2. **Add the server** to your MCP client using one of the configs below.
3. **Ask** your agent: *"What's my 5sim balance?"*

> The `npx` setup needs Node.js 20+. Prices, countries and services also work without an API key.

### Claude Desktop

Add this to `claude_desktop_config.json`. The file is in `~/Library/Application Support/Claude/` on macOS and in `%APPDATA%\Claude\` on Windows.

```json
{
  "mcpServers": {
    "5sim": {
      "command": "npx",
      "args": ["-y", "@5sim-net/mcp"],
      "env": {
        "FIVESIM_API_KEY": "your-5sim-api-key",
        "FIVESIM_MAX_PRICE": "1"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add 5sim -e FIVESIM_API_KEY=your-5sim-api-key -e FIVESIM_MAX_PRICE=1 -- npx -y @5sim-net/mcp
```

### Cursor

Add the JSON config above to `~/.cursor/mcp.json`, or to `.cursor/mcp.json` in your project.

### Windsurf

Add the JSON config above to `~/.codeium/windsurf/mcp_config.json`.

### Cline

Open **MCP Servers → Configure MCP Servers** and paste the JSON config above. Cline can also install the server for you from [llms-install.md](llms-install.md).

### VS Code (GitHub Copilot)

`.vscode/mcp.json`:

```json
{
  "inputs": [
    { "id": "fivesim-key", "type": "promptString", "description": "5sim API key", "password": true }
  ],
  "servers": {
    "5sim": {
      "command": "npx",
      "args": ["-y", "@5sim-net/mcp"],
      "env": { "FIVESIM_API_KEY": "${input:fivesim-key}" }
    }
  }
}
```

### Docker

```bash
docker build -t 5sim-mcp https://github.com/5sim-net/mcp.git
```

```bash
docker run -i --rm -e FIVESIM_API_KEY=your-5sim-api-key 5sim-mcp
```

### Remote server (Streamable HTTP)

```bash
MCP_TRANSPORT=http PORT=3000 npx -y @5sim-net/mcp
```

Connect your client to the `/mcp` path and send your key in the `Authorization` header:

```json
{
  "mcpServers": {
    "5sim": {
      "url": "https://your-host/mcp",
      "headers": { "Authorization": "Bearer your-5sim-api-key" }
    }
  }
}
```

The HTTP server keeps no state. Your API key is used for the current request only and is never stored or logged. `GET /health` is available for monitoring.

## Example prompts

- *"Get me a Telegram number in England under $1 and show me the SMS."*
- *"Which country has the cheapest WhatsApp numbers with a delivery rate above 50%?"*
- *"Buy a Google number, and if no SMS arrives in 2 minutes, cancel it."*
- *"What's my 5sim balance? Show my last 10 orders."*
- *"Set a max price of 0.5 for Discord numbers."*

You can also use the built-in prompt **`receive-verification-sms`** (`service`, `country`).

## Tools

### Account and history

| Tool | Description |
|---|---|
| `get_profile` | Balance, frozen balance, rating, default country and operator |
| `get_order_history` | Activation orders, paginated |
| `get_payments_history` | Top-ups and charges |
| `get_max_prices` | Per-service price limits |
| `set_max_price` / `delete_max_price` ✏️ | Manage price limits |

### Prices and catalog (no API key needed)

| Tool | Description |
|---|---|
| `find_cheapest_offer` | Best in-stock offers for a service, sorted by price and delivery rate |
| `get_prices` | Prices per operator for a country and/or service |
| `get_products` | Services available for a country and operator, with stock |
| `get_countries` | Country ids, names, ISO identifiers and phone prefixes |
| `get_notifications` | 5sim service announcements |

### Numbers and SMS

| Tool | Description |
|---|---|
| `buy_activation_number` 💸 | Buy a number for a service verification |
| `reuse_number` 💸 | Buy the same number again |
| `check_order` | Order status, phone number and received SMS |
| `wait_for_sms` | Wait for the SMS to arrive (up to 120 s per call) |
| `finish_order` ✏️ | Mark the order as done |
| `cancel_order` ✏️ | Cancel the order and get a refund if no SMS was received |
| `ban_order` ✏️ | Report that the number was already used, and get a refund |

💸 spends balance · ✏️ changes state. Every tool has the MCP annotations `title`, `readOnlyHint` and `destructiveHint`.

**Resources:** `5sim://countries` (country list) and `5sim://order-statuses`.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `FIVESIM_API_KEY` | – | Your 5sim API key. Without it, only prices, countries and services work |
| `FIVESIM_MAX_PRICE` | – | **Hard cap per purchase**, enforced by the server whatever the agent asks for |
| `FIVESIM_READ_ONLY` | `false` | Turns off every tool that spends balance or changes state |
| `FIVESIM_BASE_URL` | `https://5sim.net` | API base URL (mirror: `https://5sim.com`) |
| `FIVESIM_REF` | – | Referral key for software developers |
| `MCP_TRANSPORT` | `stdio` | Set to `http` to serve Streamable HTTP |
| `PORT` / `HOST` / `MCP_PATH` | `3000` / `0.0.0.0` / `/mcp` | HTTP settings |

## Security

- **Purchases spend real balance.**
  - Set `FIVESIM_MAX_PRICE` and keep only a small balance on the account the agent uses.
  - Use `FIVESIM_READ_ONLY=true` when the agent only needs to look things up.
- The server **never retries purchases**, so a rate-limit error can't cause a double purchase. Read requests are retried with backoff.
- Country, operator and service ids are checked against a strict pattern, so the agent can't change the API path.
- 5sim allows up to 100 requests per second per IP and per key. Hitting that limit 5 times within 10 minutes means a 10-minute ban.
- If a key leaks, rotate it at [5sim.net/settings/security](https://5sim.net/settings/security).
- To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Privacy

The server talks only to the 5sim API (`5sim.net`), using your own key. It sends no telemetry and stores nothing. In HTTP mode it keeps no state and logs neither API keys nor request bodies. Please follow the [5sim rules](https://5sim.net/rules) when using the service.

## FAQ

<details>
<summary><b>What is an MCP server?</b></summary>

The [Model Context Protocol](https://modelcontextprotocol.io) is an open standard for connecting AI assistants to tools and data. An MCP server gives an assistant a set of tools it can call. This one provides tools for buying virtual numbers on 5sim and reading the SMS they receive.
</details>

<details>
<summary><b>How much does a number cost?</b></summary>

Numbers start at $0.008. The price depends on the service, country and operator. Ask the agent *"find the cheapest number for &lt;service&gt;"*, or see [5sim.net/prices](https://5sim.net/prices). If no SMS arrives, cancel the order and the money goes back to your balance.
</details>

<details>
<summary><b>Can the AI spend my balance without asking?</b></summary>

The buying tools are marked as destructive, so MCP clients ask you to confirm before running them. The server's instructions also tell the agent to confirm the price with you first. For hard limits, set `FIVESIM_MAX_PRICE` or `FIVESIM_READ_ONLY=true`.
</details>

<details>
<summary><b>Which countries and services are supported?</b></summary>

150+ countries and 1,200+ services. Use `get_countries`, `get_products` and `find_cheapest_offer` to explore them.
</details>

<details>
<summary><b>Does it work without Node.js?</b></summary>

Yes. Use Docker, or run the server in HTTP mode on any host and connect to it by URL.
</details>

## Development

```bash
git clone https://github.com/5sim-net/mcp.git && cd mcp
npm install
npm test            # unit tests, 5sim API mocked
npm run build
npm run inspect     # MCP Inspector over stdio
npm run start:http  # Streamable HTTP on http://localhost:3000/mcp
```

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Links

- 🌐 Website: [5sim.net](https://5sim.net)
- 📖 API docs: [5sim.net/docs](https://5sim.net/docs)
- 💬 Support: [5sim.net/support](https://5sim.net/support) · support@5sim.net
- 🐛 Issues: [github.com/5sim-net/mcp/issues](https://github.com/5sim-net/mcp/issues)

## License

[MIT](LICENSE) © 5sim

<sub>5sim MCP server · Model Context Protocol · SMS verification API · virtual phone number · receive SMS online · temporary phone number · SMS activation · AI agent tools</sub>
