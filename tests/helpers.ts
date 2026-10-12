import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { Ajv } from "ajv";
import * as formats from "ajv-formats";
import type { Hono } from "hono";

export const testPrefix = `test-${randomUUID()}`;
export const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL ??
    "postgres://postgres:postgres@127.0.0.1:5432/agentshelf",
});

export function createSchemaValidator() {
  const schema = JSON.parse(
    readFileSync(new URL("../server/schema.json", import.meta.url), "utf8"),
  );
  const ajv = new Ajv({ allErrors: true, strict: false });
  const addFormats = formats.default as unknown as (validator: Ajv) => void;
  addFormats(ajv);
  ajv.addSchema({
    $id: "https://agentshelf.test/schema.json",
    components: normalizeNullable(structuredClone(schema.components)),
  });
  return (name: string) =>
    ajv.compile({
      $ref: `https://agentshelf.test/schema.json#/components/schemas/${name}`,
    });
}

function normalizeNullable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeNullable);
  if (!value || typeof value !== "object") return value;
  const object = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, normalizeNullable(entry)]),
  ) as Record<string, unknown>;
  if (object.nullable === true) {
    delete object.nullable;
    return { anyOf: [object, { type: "null" }] };
  }
  return object;
}

export function productInput(overrides: Record<string, unknown> = {}) {
  const id = `${testPrefix}-product`;
  return {
    id,
    title: "Everyday insulated stainless steel water bottle",
    description:
      "A durable insulated stainless steel water bottle for everyday hydration.",
    brand: "AgentShelf test product",
    price: 24.5,
    image_url: "https://images.example.test/bottle.png",
    inventory: 12,
    category: "Home & Kitchen",
    key_features: ["Double-wall insulation", "Leak-resistant lid"],
    url: `https://agentshelf.example.test/store/${id}`,
    variant_id: id,
    parent_id: id,
    mpn: "AS-BOTTLE-01",
    gtin: "00000000000001",
    google_product_category: "Home & Garden > Kitchen & Dining",
    product_type: "Home & Kitchen > Drinkware",
    seller_name: "AgentShelf",
    seller_url: "https://agentshelf.example.test",
    seller_privacy_policy: "https://agentshelf.example.test/privacy",
    seller_tos: "https://agentshelf.example.test/terms",
    return_policy: "https://agentshelf.example.test/returns",
    target_countries: ["US"],
    store_country: "US",
    is_eligible_search: true,
    is_eligible_checkout: true,
    ...overrides,
  };
}

export function cartInput(
  variantId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    items: [{ variant_id: variantId, quantity: 1 }],
    shipping_address: {
      address_line_1: "123 Test Street",
      admin_area_2: "Portland",
      admin_area_1: "OR",
      postal_code: "97201",
      country_code: "US",
    },
    payment_method: { type: "PaYpAl" },
    ...overrides,
  };
}

export async function request(
  app: Hono,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
) {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return app.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
