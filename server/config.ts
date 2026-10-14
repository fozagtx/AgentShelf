export const PAYPAL_API_BASE_URL = "https://api-m.sandbox.paypal.com";
export const PAYPAL_MCP_URL = "https://mcp.sandbox.paypal.com/http";
export const PAYPAL_MCP_SSE_URL = "https://mcp.sandbox.paypal.com/sse";
export const CHANNEL3_API_BASE_URL = "https://api.trychannel3.com";
export const PLATFORM_ISSUER = "https://agentshelf.local";
export const PLATFORM_AUDIENCE = "merchant-cart-api";
export const WORKFLOW_SERVICE_NAME = "agentshelf-workflows";
export const DEFAULT_REPS = 3;
export const SHOPPER_TIMEOUT_MS = 180_000;
export const SHOPPER_MAX_ACTIONS = 18;

export function getAppUrl() {
  const host = process.env.APP_HOST;
  const url =
    process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (host ? `https://${host}` : "") ||
    (process.env.NODE_ENV !== "production" ? "http://127.0.0.1:3000" : "");
  if (!url) throw new Error("APP_URL is not set (expected RENDER_EXTERNAL_URL or APP_HOST on Render).");
  return url.replace(/\/$/, "");
}

export function configuredIntegrations() {
  return {
    database: Boolean(process.env.DATABASE_URL),
    paypal: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    channel3: Boolean(process.env.CHANNEL3_API_KEY),
    kernel: Boolean(process.env.KERNEL_API_KEY),
    render: Boolean(process.env.RENDER_API_KEY),
  };
}
