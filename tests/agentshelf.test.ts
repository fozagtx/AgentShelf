import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { generateKeyPair, SignJWT } from "jose";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import {
  ANALYTICS_INDEX,
  CARTS_INDEX,
  EVENTS_INDEX,
  EXPERIMENTS_INDEX,
  PRODUCTS_INDEX,
  RUNS_INDEX,
  ensureIndices,
} from "../server/elastic.js";
import { writeEvent } from "../server/events.js";
import { buildRunSpecs, shuffleShelf } from "../server/shelf.js";
import { loadPlatformKey, mintPlatformToken } from "../server/platform.js";
import { MODEL_FLEET } from "../server/config.js";
import {
  cartInput,
  createSchemaValidator,
  elastic,
  productInput,
  request,
  testPrefix,
} from "./helpers.js";

const validate = createSchemaValidator();
const integration = (enabled: boolean) => (enabled ? it : it.skip);
const uniqueId = () => `${testPrefix}-${randomUUID()}`;

describe("AgentShelf with local Elasticsearch", () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let product: Record<string, unknown> & { id: string };
  let platformToken: string;
  let signingKey: Awaited<ReturnType<typeof loadPlatformKey>>;

  beforeAll(async () => {
    await ensureIndices(elastic);
    app = await createApp({ elastic });
    signingKey = await loadPlatformKey(elastic);
    platformToken = await mintPlatformToken(elastic);
    const response = await request(app, "POST", "/api/products", undefined, productInput());
    expect(response.status).toBe(201);
    product = await response.json();
  });

  it("returns a service-unavailable response when the Astropods key is missing", async () => {
    const key = process.env.ASTRO_GATEWAY_API_KEY;
    delete process.env.ASTRO_GATEWAY_API_KEY;
    try {
      const response = await request(app, "POST", "/api/ai/chat", undefined, {
        messages: [{ role: "user", content: "Summarize the results." }],
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toHaveProperty("error");
    } finally {
      if (key === undefined) delete process.env.ASTRO_GATEWAY_API_KEY;
      else process.env.ASTRO_GATEWAY_API_KEY = key;
    }
  });

  it("rejects chat models outside the configured fleet", async () => {
    const response = await request(app, "POST", "/api/ai/chat", undefined, {
      model: "unconfigured-model",
      messages: [{ role: "user", content: "Summarize the results." }],
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
  });

  afterAll(async () => {
    await Promise.all([
      elastic.deleteByQuery({
        index: PRODUCTS_INDEX,
        query: { prefix: { id: testPrefix } },
      }),
      elastic.deleteByQuery({
        index: CARTS_INDEX,
        query: { prefix: { product_ids: testPrefix } },
      }),
      elastic.deleteByQuery({
        index: EXPERIMENTS_INDEX,
        query: { prefix: { id: testPrefix } },
      }),
      elastic.deleteByQuery({
        index: RUNS_INDEX,
        query: { prefix: { id: testPrefix } },
      }),
      elastic.deleteByQuery({
        index: EVENTS_INDEX,
        query: {
          bool: {
            should: [
              { prefix: { runId: testPrefix } },
              { prefix: { experimentId: testPrefix } },
            ],
            minimum_should_match: 1,
          },
        },
      }),
    ]);
    await elastic.close();
  });

  it("creates, reads, updates, deletes products and emits a PayPal CSV feed", async () => {
    expect(product.variant_id).toBe(product.id);
    expect(product.price).toBe(24.5);

    const lifecycleProduct = productInput({
      id: `${product.id}-lifecycle`,
      title: "Lifecycle product title",
    });
    const created = await request(
      app,
      "POST",
      "/api/products",
      undefined,
      lifecycleProduct,
    );
    expect(created.status).toBe(201);
    const lifecycle = await created.json();
    const list = await request(app, "GET", "/api/products");
    expect(list.status).toBe(200);
    expect((await list.json()).some((item: { id: string }) => item.id === lifecycle.id)).toBe(true);

    const updated = await request(
      app,
      "PUT",
      `/api/products/${lifecycle.id}`,
      undefined,
      { ...lifecycle, title: "Updated lifecycle product" },
    );
    expect(updated.status).toBe(200);
    expect((await updated.json()).title).toBe("Updated lifecycle product");

    const feed = await request(app, "GET", "/feed.csv");
    expect(feed.status).toBe(200);
    expect(feed.headers.get("content-type")).toContain("text/csv");
    const csv = await feed.text();
    expect(csv).toContain("id,title,link,image_link,description,price,availability");
    expect(csv).toContain(`${lifecycle.id},Updated lifecycle product`);
    expect(csv).toContain("24.50 USD");
    expect(csv).toContain("item_group_id");

    const removed = await request(app, "DELETE", `/api/products/${lifecycle.id}`);
    expect(removed.status).toBe(204);
    const missing = await request(app, "GET", `/api/products/${lifecycle.id}`);
    expect(missing.status).toBe(404);
    expect((await missing.json()).message).toBe("Product not found.");
  });

  it("reports the configured gateway integration in the status contract", async () => {
    const response = await request(app, "GET", "/api/status");

    expect(response.status).toBe(200);
    const status = await response.json();
    expect(Object.keys(status).sort()).toEqual([
      "astropods",
      "channel3",
      "elastic",
      "kernel",
      "paypal",
      "render",
    ]);
    expect(Object.values(status).every((value) => typeof value === "boolean")).toBe(true);
  });

  it("keeps the Cart API response schemas and RS256 authentication contract", async () => {
    const created = await request(
      app,
      "POST",
      "/api/paypal/v1/merchant-cart",
      platformToken,
      cartInput(product.id),
    );
    expect(created.status).toBe(201);
    const cart = await created.json();
    expect(validate("PayPalCart")(cart)).toBe(true);

    const fetched = await request(
      app,
      "GET",
      `/api/paypal/v1/merchant-cart/${cart.id}`,
      platformToken,
    );
    expect(fetched.status).toBe(200);
    expect(validate("PayPalCart")(await fetched.json())).toBe(true);

    const replaced = await request(
      app,
      "PUT",
      `/api/paypal/v1/merchant-cart/${cart.id}`,
      platformToken,
      cartInput(product.id, {
        items: [{ variant_id: product.id, quantity: 2 }],
        customer: { email_address: "buyer@example.test" },
      }),
    );
    expect(replaced.status).toBe(200);
    const replacedCart = await replaced.json();
    expect(validate("PayPalCart")(replacedCart)).toBe(true);
    expect(replacedCart.totals.subtotal.value).toBe("49.00");
    expect(replacedCart.totals.tax.value).toBe("0.00");
    expect(replacedCart.totals.total.value).toBe("54.00");

    const shippingSwitch = await request(
      app,
      "PUT",
      `/api/paypal/v1/merchant-cart/${cart.id}`,
      platformToken,
      cartInput(product.id, {
        items: [{ variant_id: product.id, quantity: 2 }],
        available_shipping_options: [
          { id: "standard", name: "Standard", price: { currency_code: "USD", value: "5.00" }, is_selected: false },
          { id: "express", name: "Express", price: { currency_code: "USD", value: "15.00" }, is_selected: true },
        ],
      }),
    );
    const switchedCart = await shippingSwitch.json();
    expect(validate("PayPalCart")(switchedCart)).toBe(true);
    expect(switchedCart.totals.shipping.value).toBe("15.00");
    expect(switchedCart.totals.total.value).toBe("64.00");
    expect(switchedCart.customer).toBeUndefined();

    const unknown = await request(
      app,
      "POST",
      "/api/paypal/v1/merchant-cart",
      platformToken,
      cartInput("unknown-variant"),
    );
    expect(unknown.status).toBe(422);
    expect(validate("BusinessError")(await unknown.json())).toBe(true);

    const unauthorized = await request(
      app,
      "GET",
      `/api/paypal/v1/merchant-cart/${cart.id}`,
    );
    expect(unauthorized.status).toBe(401);
    expect(validate("Error")(await unauthorized.json())).toBe(true);
  });

  it("rejects expired, wrong-audience, and wrong-key platform JWTs", async () => {
    const makeToken = (
      key: typeof signingKey.privateKey,
      audience = "merchant-cart-api",
      expiration: string | number = "5m",
    ) => new SignJWT({ merchant_id: "agentshelf", scope: ["cart"] })
      .setProtectedHeader({ alg: "RS256", kid: signingKey.kid })
      .setIssuer("https://agentshelf.local")
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiration)
      .sign(key);

    const wrongAudience = await makeToken(signingKey.privateKey, "another-api");
    const expired = await makeToken(
      signingKey.privateKey,
      "merchant-cart-api",
      Math.floor(Date.now() / 1000) - 60,
    );
    const wrongKeyPair = await generateKeyPair("RS256", { modulusLength: 2048 });
    const wrongKey = await makeToken(wrongKeyPair.privateKey);

    for (const token of [wrongAudience, expired, wrongKey]) {
      const response = await request(
        app,
        "GET",
        `/api/paypal/v1/merchant-cart/${uniqueId()}`,
        token,
      );
      expect(response.status).toBe(401);
      expect(validate("Error")(await response.json())).toBe(true);
    }
  });

  it("reports unavailable PayPal sandbox credentials instead of faking checkout", async () => {
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    const response = await request(
      app,
      "POST",
      "/api/paypal/v1/merchant-cart/missing/checkout",
      platformToken,
      {},
    );
    expect(response.status).toBe(404);

    const created = await request(
      app,
      "POST",
      "/api/paypal/v1/merchant-cart",
      platformToken,
      cartInput(product.id),
    );
    const cart = await created.json();
    const unavailable = await request(
      app,
      "POST",
      `/api/paypal/v1/merchant-cart/${cart.id}/checkout`,
      platformToken,
      { payment_method: { type: "paypal", token: "sandbox-order-token" } },
    );
    expect(unavailable.status).toBe(503);
    const error = await unavailable.json();
    expect(error.message).toContain("PAYPAL_CLIENT_ID");
    expect(error.message).toContain("PAYPAL_CLIENT_SECRET");
    expect(validate("Error")(error)).toBe(true);
  });

  it("returns named 503 configuration errors for Channel3 and Astropods", async () => {
    const channel3ApiKey = process.env.CHANNEL3_API_KEY;
    const gatewayApiKey = process.env.ASTRO_GATEWAY_API_KEY;
    delete process.env.CHANNEL3_API_KEY;
    delete process.env.ASTRO_GATEWAY_API_KEY;
    try {
      const experiment = await request(app, "POST", "/api/experiments", undefined, {
        productId: product.id,
        query: "insulated water bottle",
        reps: 1,
      });
      expect(experiment.status).toBe(503);
      expect((await experiment.json()).message).toContain("CHANNEL3_API_KEY");

      const fix = await request(
        app,
        "POST",
        `/api/products/${product.id}/fix`,
        undefined,
        {},
      );
      expect(fix.status).toBe(503);
      expect((await fix.json()).message).toContain("ASTRO_GATEWAY_API_KEY");
    } finally {
      if (channel3ApiKey) process.env.CHANNEL3_API_KEY = channel3ApiKey;
      else delete process.env.CHANNEL3_API_KEY;
      if (gatewayApiKey) process.env.ASTRO_GATEWAY_API_KEY = gatewayApiKey;
      else delete process.env.ASTRO_GATEWAY_API_KEY;
    }
  });

  it("records events and uses deterministic per-run shelf order", async () => {
    const experimentId = uniqueId();
    const runId = uniqueId();
    const competitors = Array.from({ length: 5 }, (_, index) => ({
      id: `competitor-${index}`,
      title: `Competitor ${index}`,
      offers: [{
        domain: `retailer-${index}.example`,
        url: `https://retailer-${index}.example/product`,
        price: { amount: 19 + index, currency: "USD" },
        availability: "InStock",
      }],
    }));
    const first = shuffleShelf(product, competitors, runId);
    expect(shuffleShelf(product, competitors, runId)).toEqual(first);
    expect(shuffleShelf(product, competitors, `${runId}-other`)).not.toEqual(first);

    const event = await writeEvent(elastic, {
      experimentId,
      runId,
      stage: "shelf_viewed",
      ok: true,
    });
    const storedEvent = await elastic.get<{ stage: string; runId: string }>({
      index: "agentshelf-events",
      id: event.id,
    });
    expect(storedEvent._source?.stage).toBe("shelf_viewed");
    expect(storedEvent._source?.runId).toBe(runId);

    const run = {
      id: runId,
      experiment_id: experimentId,
      product_id: product.id,
      model: "openai:gpt-5.5",
      variant: "original",
      rep: 1,
      shelf_order: first,
      status: "pending",
    };
    await elastic.index({
      index: RUNS_INDEX,
      id: runId,
      document: run,
      refresh: "wait_for",
    });
    await elastic.index({
      index: EXPERIMENTS_INDEX,
      id: experimentId,
      document: {
        id: experimentId,
        product_id: product.id,
        query: "insulated water bottle",
        status: "running",
        competitors,
      },
      refresh: "wait_for",
    });

    const shelf = await request(app, "GET", `/shelf/${experimentId}?run=${runId}`);
    expect(shelf.status).toBe(200);
    const html = await shelf.text();
    expect(html).toMatch(/class="[^"]*\bshelf-item\b/);
    expect(html).toContain("Competitor");

    const selected = await request(app, "GET", `/out/${runId}/0`);
    expect(selected.status).toBe(200);
    expect(await selected.text()).toContain("Your run is complete.");
    const updatedRun = await elastic.get<{ chosen_is_merchant: boolean; chosen_position: number }>({
      index: RUNS_INDEX,
      id: runId,
    });
    expect(updatedRun._source?.chosen_is_merchant).toBe(false);
    expect(updatedRun._source?.chosen_position).toBeGreaterThan(0);
  });

  it("returns live runs with recent steps ordered by run status, model, and step", async () => {
    const experimentId = uniqueId();
    const runningId = uniqueId();
    const completedIds = [uniqueId(), uniqueId()];
    const runDocs = [
      {
        id: runningId,
        experiment_id: experimentId,
        model: "gpt-5-6-terra",
        variant: "original",
        rep: 1,
        status: "running",
        live_view_url: "https://kernel.example/live?readOnly=true",
        replay_view_url: "https://kernel.example/replay",
        furthest_stage: "shelf_viewed",
      },
      {
        id: completedIds[1],
        experiment_id: experimentId,
        model: "mistral-large-3",
        variant: "fixed",
        rep: 1,
        status: "done",
      },
      {
        id: completedIds[0],
        experiment_id: experimentId,
        model: "claude-sonnet-4-6",
        variant: "original",
        rep: 1,
        status: "done",
      },
    ];
    await elastic.bulk({
      operations: runDocs.flatMap((document) => [
        { index: { _index: RUNS_INDEX, _id: document.id } },
        document,
      ]),
      refresh: "wait_for",
    });
    await elastic.bulk({
      operations: [
        {
          index: { _index: EVENTS_INDEX, _id: uniqueId() },
        },
        {
          id: uniqueId(),
          experimentId,
          runId: runningId,
          stage: "agent_step",
          step: 2,
          action: "type",
          detail: "Email: buyer@example.com",
          ok: true,
          ts: "2026-01-01T00:00:02.000Z",
        },
        {
          index: { _index: EVENTS_INDEX, _id: uniqueId() },
        },
        {
          id: uniqueId(),
          experimentId,
          runId: runningId,
          stage: "agent_step",
          step: 1,
          action: "click",
          detail: "Everyday bottle",
          ok: true,
          ts: "2026-01-01T00:00:01.000Z",
        },
      ],
      refresh: "wait_for",
    });

    const response = await request(app, "GET", `/api/experiments/${experimentId}/live`);
    expect(response.status).toBe(200);
    const live = await response.json();
    expect(live.runs.map((run: { runId: string }) => run.runId)).toEqual([
      runningId,
      completedIds[0],
      completedIds[1],
    ]);
    expect(live.runs[0]).toMatchObject({
      model: "gpt-5-6-terra",
      variant: "original",
      rep: 1,
      status: "running",
      liveViewUrl: "https://kernel.example/live?readOnly=true",
      replayUrl: "https://kernel.example/replay",
      furthestStage: "shelf_viewed",
      steps: [
        {
          step: 1,
          action: "click",
          detail: "Everyday bottle",
          ok: true,
          ts: "2026-01-01T00:00:01.000Z",
        },
        {
          step: 2,
          action: "type",
          detail: "Email: buyer@example.com",
          ok: true,
          ts: "2026-01-01T00:00:02.000Z",
        },
      ],
    });

    const empty = await request(app, "GET", `/api/experiments/${uniqueId()}/live`);
    expect(await empty.json()).toEqual({ runs: [] });
  });

  it("names Channel3 credentials for import and search when absent", async () => {
    const previous = process.env.CHANNEL3_API_KEY;
    delete process.env.CHANNEL3_API_KEY;
    try {
      const imported = await request(app, "POST", "/api/products/import", undefined, {
        url: "https://brand.example/sweater",
      });
      expect(imported.status).toBe(503);
      expect((await imported.json()).message).toContain("CHANNEL3_API_KEY");

      const searched = await request(app, "GET", "/api/products/search?q=sweater");
      expect(searched.status).toBe(503);
      expect((await searched.json()).message).toContain("CHANNEL3_API_KEY");
    } finally {
      if (previous === undefined) delete process.env.CHANNEL3_API_KEY;
      else process.env.CHANNEL3_API_KEY = previous;
    }
  });

  it("rejects a stored image URL when the upstream content is not an image", async () => {
    const upstream = new Hono();
    upstream.get("/not-image", (c) => c.text("not an image", 200, {
      "content-type": "text/html",
    }));
    const server = serve({
      fetch: upstream.fetch,
      port: 0,
      hostname: "127.0.0.1",
    });
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const imageProductId = uniqueId();
    await elastic.index({
      index: PRODUCTS_INDEX,
      id: imageProductId,
      document: {
        id: imageProductId,
        image_url: `http://127.0.0.1:${address.port}/not-image`,
      },
      refresh: "wait_for",
    });
    try {
      const response = await request(app, "GET", `/api/img/product/${imageProductId}`);
      expect(response.status).toBe(415);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      await elastic.delete({ index: PRODUCTS_INDEX, id: imageProductId, refresh: "wait_for" });
    }
  });

  it("builds a model by variant by repetition fan-out with complete run payloads", () => {
    const fixedProduct = {
      ...product,
      fixed_variant: {
        title: "Insulated bottle",
        description: "A clear product description with enough details.",
        key_features: ["Insulation"],
      },
    };
    const experiment = {
      id: uniqueId(),
      query: "insulated bottle",
      reps: 2,
      competitors: Array.from({ length: 5 }, (_, index) => ({
        id: `competitor-${index}`,
        title: `Competitor ${index}`,
      })),
    };
    const specs = buildRunSpecs(experiment, fixedProduct, MODEL_FLEET, 2);
    expect(specs).toHaveLength(16);
    expect(new Set(specs.map((spec) => spec.model))).toEqual(
      new Set(MODEL_FLEET),
    );
    expect(specs.filter((spec) => spec.variant === "original")).toHaveLength(8);
    expect(specs.filter((spec) => spec.variant === "fixed")).toHaveLength(8);
    expect(specs.every((spec) => spec.provider === "Astropods")).toBe(true);
    expect(specs.every((spec) => spec.experimentId === experiment.id)).toBe(true);
    expect(specs.every((spec) => spec.shelfOrder.length === 6)).toBe(true);
    expect(specs.every((spec) => spec.query === experiment.query)).toBe(true);
    expect(specs.every((spec) => spec.productId === product.id)).toBe(true);
  });

  it("computes experiment analytics with Elasticsearch aggregations", async () => {
    const experimentId = uniqueId();
    const runDocs = [
      {
        id: uniqueId(),
        experiment_id: experimentId,
        model: "openai:gpt-5.5",
        variant: "original",
        chosen_is_merchant: true,
        chosen_position: 1,
        furthest_stage: "captured",
        status: "completed",
      },
      {
        id: uniqueId(),
        experiment_id: experimentId,
        model: "openai:gpt-5.5",
        variant: "original",
        chosen_is_merchant: false,
        chosen_position: 1,
        furthest_stage: "offer_selected",
        failure_stage: "offer_selected",
        failure_reason: "Agent chose a competitor",
        replay_view_url: "https://replay.example.test/run",
        status: "failed",
      },
      {
        id: uniqueId(),
        experiment_id: experimentId,
        model: "anthropic:claude-opus-4-7",
        variant: "fixed",
        chosen_is_merchant: true,
        chosen_position: 2,
        furthest_stage: "product_viewed",
        status: "failed",
        failure_stage: "product_viewed",
        failure_reason: "Checkout could not continue",
      },
    ];
    await elastic.bulk({
      operations: runDocs.flatMap((document) => [
        { index: { _index: RUNS_INDEX, _id: document.id } },
        document,
      ]),
      refresh: "wait_for",
    });

    const response = await request(
      app,
      "GET",
      `/api/experiments/${experimentId}/analytics`,
    );
    expect(response.status).toBe(200);
    const analytics = await response.json();
    const share = analytics.shareByModel.find(
      (item: { model: string; variant: string }) =>
        item.model === "openai:gpt-5.5" && item.variant === "original",
    );
    expect(share).toMatchObject({ runs: 2, merchantPicks: 1, share: 0.5 });
    expect(analytics.positionBias.find((item: { position: number }) => item.position === 1))
      .toMatchObject({ runs: 2, picks: 1, share: 0.5 });
    expect(analytics.failures).toHaveLength(2);
    expect(analytics.funnel.some(
      (item: { model: string; stage: string; count: number }) =>
        item.model === "openai:gpt-5.5" && item.stage === "shelf_viewed" && item.count === 2,
    )).toBe(true);
  });

  integration(Boolean(process.env.CHANNEL3_API_KEY))(
    "searches live Channel3 catalog results",
    async () => {
      const { searchCompetitors } = await import("../server/channel3.js");
      const results = await searchCompetitors("insulated water bottle");
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((item) =>
        item.offers.some((offer: { availability: string; price: { currency: string } }) =>
          offer.availability === "InStock" && offer.price.currency === "USD",
        ),
      )).toBe(true);
    },
  );

  integration(Boolean(process.env.ASTRO_GATEWAY_API_KEY))(
    "requests structured live product copy fixes",
    async () => {
      const { generateProductFix } = await import("../server/fixes.js");
      const fixed = await generateProductFix(product, []);
      expect(fixed.fixed.title).toBeTruthy();
      expect(fixed.fixed.description).toBeTruthy();
      expect(Array.isArray(fixed.fixed.key_features)).toBe(true);
    },
  );
});
