import { randomUUID } from "node:crypto";
import type { Client } from "@elastic/elasticsearch";
import { Hono } from "hono";
import { getAppUrl } from "./config.js";
import { PRODUCTS_INDEX, getDocument, searchDocuments } from "./elastic.js";
import {
  channel3ImageUrl,
  createChannel3Client,
  firstInStockUsdOffer,
  mapChannel3Product,
  missingChannel3Credentials,
} from "./channel3.js";

export interface Product extends Record<string, any> {
  id: string;
  title: string;
  description: string;
  brand: string;
  price: number;
  image_url: string;
  inventory: number;
  category: string;
  key_features: string[];
  channel3_id?: string;
  source_url?: string;
  variant_id: string;
  parent_id: string;
  url: string;
}

export async function listProducts(client: Client) {
  return searchDocuments<Product>(client, PRODUCTS_INDEX);
}

export async function getProduct(client: Client, id: string) {
  return getDocument<Product>(client, PRODUCTS_INDEX, id);
}

export function createProductRoutes(client: Client) {
  const app = new Hono();

  app.get("/api/products", async (c) => c.json(await listProducts(client)));
  app.post("/api/products/import", async (c) => {
    const input = await readObject(c);
    if (!input) return c.json({ message: "A JSON import body is required." }, 400);
    const hasUrl = typeof input.url === "string" && Boolean(input.url.trim());
    const hasChannel3Id = typeof input.channel3Id === "string" && Boolean(input.channel3Id.trim());
    if (hasUrl === hasChannel3Id) {
      return c.json({ message: "Provide exactly one of url or channel3Id." }, 400);
    }
    const inventory = input.inventory ?? 10;
    if (!Number.isInteger(inventory) || inventory < 0) {
      return c.json({ message: "inventory must be a non-negative integer." }, 400);
    }
    const missing = missingChannel3Credentials();
    if (missing.length) {
      return c.json({
        message: `Channel3 product import is unavailable. Missing environment variables: ${missing.join(", ")}.`,
      }, 503);
    }
    try {
      const channel3 = createChannel3Client();
      const product = hasUrl
        ? (await channel3.products.lookup({ url: input.url.trim() })).product
        : await channel3.products.retrieve(input.channel3Id.trim());
      const mapped = mapChannel3Product(product, {
        inventory,
        ...(hasUrl ? { sourceUrl: input.url.trim() } : {}),
      });
      if (!mapped.ok) return c.json({ message: mapped.error }, 422);
      const id = randomUUID();
      const validated = validateProduct(mapped.value, id);
      if (!validated.ok) return c.json({ message: validated.error }, 422);
      const document = {
        ...validated.value,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await client.index({
        index: PRODUCTS_INDEX,
        id,
        document,
        refresh: "wait_for",
        op_type: "create",
      });
      return c.json(document, 201);
    } catch (error) {
      const channelError = error as { message?: string; statusCode?: number };
      const status = Number(channelError.statusCode);
      const responseStatus = status === 404 ? 404 : status === 422 ? 422 : 502;
      return c.json(
        { message: channelError.message || "Channel3 product import failed." },
        responseStatus,
      );
    }
  });

  app.get("/api/products/search", async (c) => {
    const query = c.req.query("q")?.trim();
    if (!query) return c.json({ message: "A non-empty q parameter is required." }, 400);
    const missing = missingChannel3Credentials();
    if (missing.length) {
      return c.json({
        message: `Channel3 product search is unavailable. Missing environment variables: ${missing.join(", ")}.`,
      }, 503);
    }
    try {
      const channel3 = createChannel3Client();
      const response = await channel3.products.search({ query });
      const results = response.data.flatMap((product) => {
        const offer = firstInStockUsdOffer(product);
        if (!offer) return [];
        return [{
          channel3Id: product.id,
          title: product.title,
          brand: product.brands?.[0]?.name ?? "",
          price: offer.price.price,
          imageUrl: channel3ImageUrl(product),
          url: offer.url,
        }];
      }).slice(0, 8);
      return c.json(results);
    } catch (error) {
      const channelError = error as { message?: string; statusCode?: number };
      const status = Number(channelError.statusCode);
      const responseStatus = status === 404 ? 404 : status === 422 ? 422 : 502;
      return c.json(
        { message: channelError.message || "Channel3 product search failed." },
        responseStatus,
      );
    }
  });

  app.post("/api/products", async (c) => {
    const input = await readObject(c);
    if (!input) return c.json({ message: "A JSON product body is required." }, 400);
    const product = validateProduct(input, String(input.id ?? randomUUID()));
    if (!product.ok) return c.json({ message: product.error }, 400);
    if (await getProduct(client, product.value.id)) {
      return c.json({ message: "A product with this id already exists." }, 409);
    }
    const document = {
      ...product.value,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await client.index({
      index: PRODUCTS_INDEX,
      id: document.id,
      document,
      refresh: "wait_for",
      op_type: "create",
    });
    return c.json(document, 201);
  });

  app.get("/api/products/:id", async (c) => {
    const product = await getProduct(client, c.req.param("id"));
    return product ? c.json(product) : c.json({ message: "Product not found." }, 404);
  });

  app.put("/api/products/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await getProduct(client, id);
    if (!existing) return c.json({ message: "Product not found." }, 404);
    const input = await readObject(c);
    if (!input) return c.json({ message: "A JSON product body is required." }, 400);
    const product = validateProduct(input, id);
    if (!product.ok) return c.json({ message: product.error }, 400);
    const document = {
      ...product.value,
      ...(existing.fixed_variant ? { fixed_variant: existing.fixed_variant } : {}),
      created_at: existing.created_at,
      updated_at: new Date().toISOString(),
    };
    await client.index({
      index: PRODUCTS_INDEX,
      id,
      document,
      refresh: "wait_for",
    });
    return c.json(document);
  });

  app.delete("/api/products/:id", async (c) => {
    const id = c.req.param("id");
    if (!(await getProduct(client, id))) {
      return c.json({ message: "Product not found." }, 404);
    }
    await client.delete({ index: PRODUCTS_INDEX, id, refresh: "wait_for" });
    return c.body(null, 204);
  });

  app.get("/feed.csv", async (c) => {
    const products = await listProducts(client);
    const columns = [
      "id", "title", "link", "image_link", "description", "price",
      "availability", "item_group_id", "brand", "mpn", "gtin", "sale_price",
      "google_product_category", "product_type", "seller_name", "seller_url",
      "seller_privacy_policy", "seller_tos", "return_policy",
      "target_countries", "store_country", "is_eligible_search",
      "is_eligible_checkout",
    ];
    const rows = products.map((product) => {
      const values: Record<string, unknown> = {
        ...product,
        id: product.variant_id,
        title: product.title,
        link: product.url,
        image_link: product.image_url,
        description: product.description,
        price: `${Number(product.price).toFixed(2)} USD`,
        availability: product.inventory > 0 ? "in_stock" : "out_of_stock",
        item_group_id: product.parent_id,
      };
      values.target_countries = Array.isArray(product.target_countries)
        ? product.target_countries.join(",")
        : product.target_countries;
      return columns.map((key) => csvField(values[key])).join(",");
    });
    return c.body(
      [columns.join(","), ...rows].join("\r\n"),
      200,
      { "content-type": "text/csv; charset=utf-8" },
    );
  });

  return app;
}

function validateProduct(input: Record<string, any>, id: string) {
  const fields = ["title", "description", "brand", "image_url", "category"];
  const missing = fields.filter((field) => typeof input[field] !== "string" || !input[field].trim());
  if (missing.length) return { ok: false as const, error: `Required product fields: ${missing.join(", ")}.` };
  if (input.description.length < 25) {
    return { ok: false as const, error: "description must contain at least 25 characters." };
  }
  if (!Number.isFinite(Number(input.price)) || Number(input.price) < 0) {
    return { ok: false as const, error: "price must be a non-negative USD amount." };
  }
  if (!Number.isInteger(input.inventory) || input.inventory < 0) {
    return { ok: false as const, error: "inventory must be a non-negative integer." };
  }
  if (!Array.isArray(input.key_features) || !input.key_features.every((item: unknown) => typeof item === "string")) {
    return { ok: false as const, error: "key_features must be an array of strings." };
  }
  return {
    ok: true as const,
    value: {
      ...input,
      id,
      variant_id: id,
      parent_id: id,
      item_group_id: input.item_group_id ?? id,
      url: input.url ?? `${getAppUrl()}/store/${encodeURIComponent(id)}`,
      price: Number(input.price),
      inventory: Number(input.inventory),
      target_countries: Array.isArray(input.target_countries)
        ? input.target_countries
        : ["US"],
      store_country: input.store_country ?? "US",
      is_eligible_search: input.is_eligible_search ?? true,
      is_eligible_checkout: input.is_eligible_checkout ?? true,
    } as unknown as Product,
  };
}

async function readObject(c: { req: { json: () => Promise<unknown> } }) {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, any>
      : null;
  } catch {
    return null;
  }
}

function csvField(value: unknown) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
