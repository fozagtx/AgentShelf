# AgentShelf

AgentShelf lets merchants A/B test product listings against real competitor offers
with a fleet of AI shoppers that check out through PayPal.

## PayPal integration

This repo integrates PayPal in two places:

- `server/paypal.ts` — Orders v2 REST client (create/patch/get/capture).
- `server/paypalMcp.ts` — PayPal MCP server client (read-only tool allowlist).

Install the PayPal AI Toolkit before changing PayPal code:

- Claude: `/plugin install paypal@claude-plugins-official`
- Codex: `codex plugin marketplace add paypal/AI-Toolkit && codex plugin add paypal@paypal-ai-toolkit`
- Cursor: `cursor-agent plugin marketplace add https://github.com/paypal/AI-Toolkit`

Set `PAYPAL_SANDBOX_ACCESS_TOKEN` for the PayPal sandbox MCP server (`.mcp.json`),
then run `/paypal:doctor` to verify the setup.

## Testing and building

- `npm test` — vitest suite (needs local Postgres at `postgres://postgres:postgres@127.0.0.1:5432/agentshelf`)
- `npm run build` — typecheck server + web and build the web bundle
