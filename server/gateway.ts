import OpenAI from "openai";

export function gateway() {
  return new OpenAI({
    apiKey: process.env.ASTRO_GATEWAY_API_KEY,
    baseURL: `${process.env.ASTRO_GATEWAY_URL?.replace(/\/$/, "")}/v1`,
  });
}

export function hasGateway() {
  return Boolean(process.env.ASTRO_GATEWAY_API_KEY && process.env.ASTRO_GATEWAY_URL);
}
