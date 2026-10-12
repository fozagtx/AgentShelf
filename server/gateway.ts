import OpenAI from "openai";
import { ASTRO_GATEWAY_URL_TO_CONFIGURE } from "./config.js";

export function gateway() {
  return new OpenAI({
    apiKey: process.env.ASTRO_GATEWAY_API_KEY,
    baseURL: `${ASTRO_GATEWAY_URL_TO_CONFIGURE}/v1`,
  });
}

export function hasGateway() {
  return Boolean(process.env.ASTRO_GATEWAY_API_KEY);
}
