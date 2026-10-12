import type { Client } from "@elastic/elasticsearch";
import { Hono, type Context } from "hono";
import { EXPERIMENTS_INDEX, PRODUCTS_INDEX, getDocument } from "./elastic.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 10_000;

export function createImageRoutes(client: Client) {
  const app = new Hono();

  app.get("/api/img/product/:id", async (c) => {
    const product = await getDocument<Record<string, any>>(client, PRODUCTS_INDEX, c.req.param("id"));
    if (!product?.image_url) return c.json({ message: "Product image not found." }, 404);
    return fetchStoredImage(c, String(product.image_url));
  });

  app.get("/api/img/competitor/:experimentId/:index", async (c) => {
    const experiment = await getDocument<Record<string, any>>(
      client,
      EXPERIMENTS_INDEX,
      c.req.param("experimentId"),
    );
    const index = Number(c.req.param("index"));
    const competitor = Number.isInteger(index) && index >= 0
      ? experiment?.competitors?.[index]
      : undefined;
    const imageUrl = competitor?.image_url ??
      competitor?.images?.find((image: Record<string, unknown>) => image.shot_type === "hero")?.cleaned_url ??
      competitor?.images?.[0]?.cleaned_url ??
      competitor?.images?.[0]?.url;
    if (!imageUrl) return c.json({ message: "Competitor image not found." }, 404);
    return fetchStoredImage(c, String(imageUrl));
  });

  return app;
}

async function fetchStoredImage(
  c: Context,
  value: string,
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return c.json({ message: "Stored image URL is invalid." }, 404);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    return c.json({ message: "Stored image URL is invalid." }, 404);
  }

  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
    if (!response.ok || !response.body) {
      return c.json({ message: "Image upstream could not be reached." }, 502);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      return c.json({ message: "Image upstream returned a non-image response." }, 415);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        return c.json({ message: "Image exceeds the 5 MB limit." }, 502);
      }
      chunks.push(chunk);
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    return c.body(stream, 200, {
      "content-type": contentType,
      "content-length": String(size),
      "cache-control": "public, max-age=86400",
    });
  } catch {
    return c.json({ message: "Image upstream request failed." }, 502);
  }
}
