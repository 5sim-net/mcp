# Contributing

Thanks for helping improve the 5sim MCP server!

1. Fork the repo and create a branch.
2. Run `npm install`, then `npm test`. The tests mock the 5sim API, so no real money is spent.
3. Keep tools small, and give every tool a `title` plus `readOnlyHint` / `destructiveHint` annotations.
4. Any tool that spends balance must respect `FIVESIM_READ_ONLY` and `FIVESIM_MAX_PRICE`, and must never auto-retry.
5. Run `npm run typecheck && npm test && npm run build` before opening a pull request.

For bugs and feature ideas, open an [issue](https://github.com/5sim-net/mcp/issues/new/choose).
