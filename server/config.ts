export const PAYPAL_API_BASE_URL = "https://api-m.sandbox.paypal.com";
export const CHANNEL3_API_BASE_URL = "https://api.trychannel3.com";
export const ELASTIC_ENDPOINT_TO_CONFIGURE = "http://127.0.0.1:9200";
export const DEPLOYED_APP_URL_TO_CONFIGURE = "https://YOUR-DEPLOYED-APP-URL";
export const ASTRO_GATEWAY_URL_TO_CONFIGURE = "https://YOUR-ASTROPODS-GATEWAY-HOST";
export const FIX_MODEL = "gpt-5-6-terra";
export const PRODUCT_FIX_MODEL = FIX_MODEL;
export const PLATFORM_ISSUER = "https://agentshelf.local";
export const PLATFORM_AUDIENCE = "merchant-cart-api";
export const WORKFLOW_SERVICE_NAME = "agentshelf-workflows";
export const DEFAULT_REPS = 3;
export const SHOPPER_TIMEOUT_MS = 180_000;
export const SHOPPER_MAX_ACTIONS = 18;

export const MODEL_FLEET = [
  "claude-sonnet-4-6",
  "gpt-5-6-terra",
  "nova-pro",
  "mistral-large-3",
] as const;

export function getElasticUrl() {
  if (process.env.NODE_ENV !== "production" && process.env.ELASTIC_URL) {
    return process.env.ELASTIC_URL;
  }
  return ELASTIC_ENDPOINT_TO_CONFIGURE;
}

export function getAppUrl() {
  if (process.env.NODE_ENV !== "production" && process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/$/, "");
  }
  if (process.env.NODE_ENV !== "production") return "http://127.0.0.1:3000";
  return DEPLOYED_APP_URL_TO_CONFIGURE.replace(/\/$/, "");
}

export function configuredIntegrations() {
  return {
    elastic: Boolean(getElasticUrl()),
    paypal: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    channel3: Boolean(process.env.CHANNEL3_API_KEY),
    kernel: Boolean(process.env.KERNEL_API_KEY),
    render: Boolean(process.env.RENDER_API_KEY),
  };
}
