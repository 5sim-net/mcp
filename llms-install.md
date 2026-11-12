# Installing the 5sim MCP server (instructions for AI agents)

1. Ask the user for their 5sim API key. They can find it at https://5sim.net/settings/security. Never guess it or make one up.
2. Ask whether to set a hard per-purchase price cap, for example `1`. It is recommended.
3. Add this to the MCP settings file. No clone or build is needed:

```json
{
  "mcpServers": {
    "5sim": {
      "command": "npx",
      "args": ["-y", "@5sim-net/mcp"],
      "env": {
        "FIVESIM_API_KEY": "<user's key>",
        "FIVESIM_MAX_PRICE": "<cap, optional>"
      }
    }
  }
}
```

Optional settings:

- `"FIVESIM_READ_ONLY": "true"`: no purchases at all.

4. Check that it works by calling `get_profile`, which returns the balance, and `find_cheapest_offer` with `{"product": "telegram"}`.

Requirements: Node.js 20 or newer.

Without Node.js: build and run the Docker image (`docker build -t 5sim-mcp https://github.com/5sim-net/mcp.git`, then `docker run -i --rm -e FIVESIM_API_KEY=<key> 5sim-mcp`).
