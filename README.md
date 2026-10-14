# AgentShelf

A/B test your product listing against real competitor offers. A fleet of AI shoppers (OpenAI or Nebius models driving live Kernel browsers) shops your listing next to Channel3 competitors and checks out through the PayPal sandbox.

## Environment variables

On Render, set every secret **once, on the `agentshelf` web service**. The `agentshelf-workflows` service copies them from the web service through `fromService` in `render.yaml`, so leave it alone. After you add or change a variable, redeploy `agentshelf` (Manual Deploy → Deploy latest commit) so the running service picks it up.

| Variable | Required | Used for |
| --- | --- | --- |
| `OPENAI_API_KEY` | One of these two | OpenAI shopper models; the model list loads live from OpenAI |
| `NEBIUS_API_KEY` | One of these two | Nebius shopper models (`https://api.tokenfactory.nebius.com/v1/`); the model list loads live from Nebius |
| `CHANNEL3_API_KEY` | Yes | Product search/import and competitor offers |
| `KERNEL_API_KEY` | Yes | Cloud browsers the shoppers drive, plus the live view on the dashboard |
| `RENDER_API_KEY` | Yes | Starting shopper runs on the `agentshelf-workflows` service |
| `PAYPAL_CLIENT_ID` | For checkout | PayPal Orders v2 and the PayPal MCP tools panel |
| `PAYPAL_CLIENT_SECRET` | For checkout | Same as above |
| `PAYPAL_SANDBOX_BUYER_EMAIL` | Optional | Sandbox buyer account the shoppers log in with at checkout |
| `PAYPAL_SANDBOX_BUYER_PASSWORD` | Optional | Same as above |
| `VITE_AG_STUDIO_LICENSE_KEY` | Optional | Removes the AG Studio trial watermark; read at build time |

Set automatically, so don't enter them yourself:

- `DATABASE_URL`: comes from the `agentshelf-db` Postgres database.
- `RENDER_EXTERNAL_URL`, `APP_HOST`: the app's public URL (workflows get `APP_HOST` from the web service). `APP_URL` overrides both if you ever need to.
- `PORT`, `NODE_ENV`: set by Render.

### Check what the running app sees

Open `https://<your-app>.onrender.com/api/status`. Each integration shows `true` once its variable reaches the running service, for example `"openai":true`. If the dashboard says "Add OPENAI_API_KEY or NEBIUS_API_KEY", the web service doesn't have either key: check the variable is on `agentshelf` (not the workflow service), the name is exact with no spaces, and that you redeployed after saving it.

## Local development

There is no `.env` loader, so export the variables in your shell before starting.

```bash
npm install
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/agentshelf
export OPENAI_API_KEY=...   # and/or NEBIUS_API_KEY, CHANNEL3_API_KEY, KERNEL_API_KEY, ...
npm run dev        # API on http://127.0.0.1:3000
npm run dev:web    # web app via Vite, proxies /api to :3000
```

To run shopper workflows locally, run `npm run dev:workflows` (Render CLI) and set `RENDER_USE_LOCAL_DEV=true` (plus `RENDER_LOCAL_DEV_URL` if the CLI isn't on its default URL) for the API process.

- `npm test`: vitest suite (needs the local Postgres above)
- `npm run build`: typechecks server and web, then builds the web bundle

See [AGENTS.md](AGENTS.md) for the PayPal AI Toolkit / MCP setup used when editing PayPal code.
