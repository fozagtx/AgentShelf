import { Client } from "@elastic/elasticsearch";
import {
  ELASTIC_ENDPOINT_TO_CONFIGURE,
  getElasticUrl,
} from "./config.js";

export const PRODUCTS_INDEX = "agentshelf-products";
export const CARTS_INDEX = "agentshelf-carts";
export const EXPERIMENTS_INDEX = "agentshelf-experiments";
export const RUNS_INDEX = "agentshelf-runs";
export const EVENTS_INDEX = "agentshelf-events";
export const KEYS_INDEX = "agentshelf-keys";
export const ANALYTICS_INDEX = RUNS_INDEX;
export const JINA_INFERENCE_ID = "agentshelf-jina";

export function createElasticClient() {
  const endpoint = getElasticUrl() || ELASTIC_ENDPOINT_TO_CONFIGURE;
  return new Client({
    node: endpoint,
    ...(process.env.ELASTIC_API_KEY
      ? { auth: { apiKey: process.env.ELASTIC_API_KEY } }
      : {}),
  });
}

const mappings = {
  [PRODUCTS_INDEX]: {
    id: { type: "keyword" },
    title: { type: "text", fields: { keyword: { type: "keyword" } } },
    description: { type: "text" },
    brand: { type: "keyword" },
    channel3_id: { type: "keyword" },
    source_url: { type: "keyword", index: false },
    price: { type: "double" },
    inventory: { type: "integer" },
    key_features: { type: "keyword" },
    created_at: { type: "date" },
    updated_at: { type: "date" },
    fixed_variant: { type: "object", enabled: false },
  },
  [CARTS_INDEX]: {
    id: { type: "keyword" },
    status: { type: "keyword" },
    product_ids: { type: "keyword" },
    paypal_order_id: { type: "keyword" },
    created_at: { type: "date" },
    updated_at: { type: "date" },
    cart: { type: "object", enabled: false },
  },
  [EXPERIMENTS_INDEX]: {
    id: { type: "keyword" },
    product_id: { type: "keyword" },
    query: { type: "text", fields: { keyword: { type: "keyword" } } },
    status: { type: "keyword" },
    reps: { type: "integer" },
    created_at: { type: "date" },
    completed_at: { type: "date" },
    competitors: { type: "object", enabled: false },
  },
  [RUNS_INDEX]: {
    id: { type: "keyword" },
    experiment_id: { type: "keyword" },
    product_id: { type: "keyword" },
    model: { type: "keyword" },
    variant: { type: "keyword" },
    rep: { type: "integer" },
    status: { type: "keyword" },
    shelf_order: { type: "object", enabled: false },
    chosen_is_merchant: { type: "boolean" },
    chosen_position: { type: "integer" },
    furthest_stage: { type: "keyword" },
    failure_stage: { type: "keyword" },
    failure_reason: { type: "text" },
    paypal_order_id: { type: "keyword" },
    capture_status: { type: "keyword" },
    replay_view_url: { type: "keyword", index: false },
    live_view_url: { type: "keyword", index: false },
    agent_final_text: { type: "text", index: false },
    duration_ms: { type: "long" },
    created_at: { type: "date" },
    completed_at: { type: "date" },
  },
  [EVENTS_INDEX]: {
    id: { type: "keyword" },
    experimentId: { type: "keyword" },
    runId: { type: "keyword" },
    model: { type: "keyword" },
    variant: { type: "keyword" },
    stage: { type: "keyword" },
    ok: { type: "boolean" },
    error: { type: "text" },
    step: { type: "integer" },
    action: { type: "keyword" },
    detail: { type: "text", index: false },
    ts: { type: "date" },
    position: { type: "integer" },
    is_merchant: { type: "boolean" },
  },
  [KEYS_INDEX]: {
    id: { type: "keyword" },
    private_jwk: { type: "object", enabled: false },
    public_jwk: { type: "object", enabled: false },
    created_at: { type: "date" },
  },
} as const;

export async function ensureIndices(client: Client) {
  for (const [index, properties] of Object.entries(mappings)) {
    if (await client.indices.exists({ index })) continue;
    try {
      await client.indices.create({ index, mappings: { properties } });
    } catch (error) {
      if ((error as { meta?: { statusCode?: number } }).meta?.statusCode !== 400) {
        throw error;
      }
    }
  }
  if (!process.env.JINA_API_KEY) return;
  try {
    await client.transport.request({
      method: "GET",
      path: `/_inference/text_embedding/${JINA_INFERENCE_ID}`,
    });
  } catch (error) {
    if ((error as { meta?: { statusCode?: number } }).meta?.statusCode !== 404) {
      throw error;
    }
    await client.transport.request({
      method: "PUT",
      path: `/_inference/text_embedding/${JINA_INFERENCE_ID}`,
      body: {
        service: "jinaai",
        service_settings: {
          api_key: process.env.JINA_API_KEY,
          model_id: "jina-embeddings-v3",
        },
      },
    });
  }
  await client.indices.putMapping({
    index: RUNS_INDEX,
    properties: {
      reasoning: {
        type: "semantic_text",
        inference_id: JINA_INFERENCE_ID,
      },
    },
  });
}

export async function getDocument<T>(
  client: Client,
  index: string,
  id: string,
): Promise<T | null> {
  try {
    const response = await client.get<T>({ index, id });
    return response._source ?? null;
  } catch (error) {
    if ((error as { meta?: { statusCode?: number } }).meta?.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

export async function searchDocuments<T>(
  client: Client,
  index: string,
  query: Record<string, unknown> = { match_all: {} },
  size = 1000,
) {
  const response = await client.search<T>({ index, size, query });
  return response.hits.hits.flatMap((hit) =>
    hit._source ? [hit._source] : [],
  );
}
