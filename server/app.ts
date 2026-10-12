import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { Client } from "@elastic/elasticsearch";
import { Hono } from "hono";
import {
  configuredIntegrations,
  DEFAULT_REPS,
  MODEL_FLEET,
  PRODUCT_FIX_MODEL,
} from "./config.js";
import {
  EVENTS_INDEX,
  EXPERIMENTS_INDEX,
  PRODUCTS_INDEX,
  RUNS_INDEX,
  createElasticClient,
  ensureIndices,
  getDocument,
  searchDocuments,
} from "./elastic.js";
import { generateProductFix, missingGatewayCredentials } from "./fixes.js";
import { loadPlatformKey } from "./platform.js";
import { createMerchantRoutes } from "./merchant.js";
import { createPageRoutes } from "./pages.js";
import { createProductRoutes, getProduct } from "./products.js";
import { getExperimentAnalytics } from "./analytics.js";
import { searchCompetitors, missingChannel3Credentials } from "./channel3.js";
import { startExperimentWorkflow } from "./workflows.js";
import { gateway, hasGateway } from "./gateway.js";
import { createImageRoutes } from "./images.js";

export interface AppOptions {
  elastic?: Client;
}

export async function createApp(options: AppOptions = {}) {
  const elastic = options.elastic ?? createElasticClient();
  await ensureIndices(elastic);
  const platformKey = await loadPlatformKey(elastic);
  const app = new Hono();
  app.get("/.well-known/jwks.json", (c) =>
    c.json({ keys: [platformKey.publicJwk] }),
  );

  app.get("/api/status", (c) => {
    const configured = configuredIntegrations();
    return c.json({
      paypal: configured.paypal,
      channel3: configured.channel3,
      kernel: configured.kernel,
      render: configured.render,
      elastic: configured.elastic,
      astropods: hasGateway(),
    });
  });

  app.post("/api/ai/chat", async (c) => {
    const input = await readJson(c);
    if (!input || !Array.isArray(input.messages) || input.messages.length === 0) {
      return c.json({ error: "A non-empty messages array is required." }, 400);
    }
    const model = typeof input.model === "string" ? input.model : PRODUCT_FIX_MODEL;
    if (!MODEL_FLEET.includes(model as (typeof MODEL_FLEET)[number])) {
      return c.json({ error: "The requested model is not in the configured fleet." }, 400);
    }
    if (!hasGateway()) {
      return c.json({ error: "ASTRO_GATEWAY_API_KEY is not set" }, 503);
    }
    const requestedTokens = Number(input.max_tokens);
    const maxTokens = Number.isFinite(requestedTokens)
      ? Math.max(1, Math.min(2000, Math.floor(requestedTokens)))
      : 2000;
    try {
      const response = await gateway().chat.completions.create({
        model,
        messages: input.messages as any,
        max_tokens: maxTokens,
        ...(Array.isArray(input.tools) ? { tools: input.tools as any } : {}),
        ...(input.tool_choice !== undefined
          ? { tool_choice: input.tool_choice as any }
          : {}),
        ...(input.response_format !== undefined
          ? { response_format: input.response_format as any }
          : {}),
      });
      return c.json(response);
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : "Astropods chat request failed.",
      }, 502);
    }
  });

  app.route("/", createProductRoutes(elastic));
  app.route("/", createImageRoutes(elastic));
  app.route("/api/paypal/v1", createMerchantRoutes(elastic, platformKey));
  app.route("/", createPageRoutes(elastic));

  app.post("/api/products/:id/fix", async (c) => {
    const missing = missingGatewayCredentials();
    if (missing.length) {
      return c.json({
        message: `Product copy fixes are unavailable. Missing environment variables: ${missing.join(", ")}.`,
      }, 503);
    }
    const product = await getProduct(elastic, c.req.param("id"));
    if (!product) return c.json({ message: "Product not found." }, 404);
    const experiments = await searchDocuments<Record<string, any>>(
      elastic,
      EXPERIMENTS_INDEX,
      { term: { product_id: product.id } },
    );
    const latest = experiments.sort((a, b) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
    )[0];
    try {
      const generated = await generateProductFix(product, latest?.competitors ?? []);
      const fixedVariant = {
        title: generated.fixed.title,
        description: generated.fixed.description,
        key_features: generated.fixed.key_features,
        rationale: generated.rationale,
      };
      const updated = {
        ...product,
        fixed_variant: fixedVariant,
        updated_at: new Date().toISOString(),
      };
      await elastic.index({
        index: PRODUCTS_INDEX,
        id: product.id,
        document: updated,
        refresh: "wait_for",
      });
      return c.json(updated);
    } catch (error) {
      return c.json({
        message: error instanceof Error ? error.message : "Product copy fix failed.",
      }, 502);
    }
  });

  app.post("/api/experiments", async (c) => {
    const input = await readJson(c);
    if (!input) return c.json({ message: "A JSON experiment body is required." }, 400);
    if (typeof input.productId !== "string" || typeof input.query !== "string" || !input.query.trim()) {
      return c.json({ message: "productId and query are required." }, 400);
    }
    const product = await getProduct(elastic, input.productId);
    if (!product) return c.json({ message: "Product not found." }, 404);
    const missing = [
      ...missingChannel3Credentials(),
      ...(!process.env.RENDER_API_KEY ? ["RENDER_API_KEY"] : []),
      ...(!process.env.KERNEL_API_KEY ? ["KERNEL_API_KEY"] : []),
      ...(!process.env.ASTRO_GATEWAY_API_KEY ? ["ASTRO_GATEWAY_API_KEY"] : []),
    ];
    if (missing.length) {
      return c.json({
        message: `Experiment creation is unavailable. Missing environment variables: ${[...new Set(missing)].join(", ")}.`,
      }, 503);
    }
    const reps = Number.isInteger(input.reps) && input.reps > 0
      ? Math.min(Number(input.reps), 20)
      : DEFAULT_REPS;
    const id = randomUUID();
    let competitors;
    try {
      competitors = await searchCompetitors(input.query.trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Channel3 product search failed.";
      return c.json({ message }, message.includes("Missing environment variables") ? 503 : 502);
    }
    const experiment = {
      id,
      product_id: product.id,
      query: input.query.trim(),
      reps,
      status: "running",
      created_at: new Date().toISOString(),
      competitors: competitors.map((competitor) => {
        const offer = competitor.offers[0];
        const image = competitor.images?.find((candidate) => candidate.shot_type === "hero")
          ?? competitor.images?.[0];
        return {
          ...competitor,
          brand: competitor.brand ?? null,
          image_url: String(image?.cleaned_url ?? image?.url ?? ""),
          price: offer.price.amount,
          domain: offer.domain,
          url: offer.url,
        };
      }),
    };
    await elastic.index({
      index: EXPERIMENTS_INDEX,
      id,
      document: experiment,
      refresh: "wait_for",
    });
    try {
      await startExperimentWorkflow(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start the Render workflow.";
      await elastic.update({
        index: EXPERIMENTS_INDEX,
        id,
        doc: { status: "failed", failure_reason: message },
        refresh: "wait_for",
      });
      return c.json({ message }, 502);
    }
    return c.json({ id }, 201);
  });

  app.get("/api/experiments", async (c) => {
    const experiments = await searchDocuments<Record<string, any>>(elastic, EXPERIMENTS_INDEX);
    return c.json(await Promise.all(experiments.map((experiment) => withRunCounts(elastic, experiment))));
  });

  app.get("/api/experiments/:id", async (c) => {
    const experiment = await getDocument<Record<string, any>>(
      elastic,
      EXPERIMENTS_INDEX,
      c.req.param("id"),
    );
    if (!experiment) return c.json({ message: "Experiment not found." }, 404);
    return c.json(await withRunCounts(elastic, experiment));
  });

  app.get("/api/experiments/:id/live", async (c) => {
    const experimentId = c.req.param("id");
    const runResponse = await elastic.search<Record<string, any>>({
      index: RUNS_INDEX,
      size: 1000,
      query: { term: { experiment_id: experimentId } },
    });
    const runHits = runResponse.hits.hits;
    if (!runHits.length) return c.json({ runs: [] });

    const runIds = runHits.map((hit) => String(hit._source?.id ?? hit._id));
    const eventResponse = await elastic.search<Record<string, any>>({
      index: EVENTS_INDEX,
      size: 10_000,
      query: {
        bool: {
          filter: [
            { terms: { runId: runIds } },
            { term: { stage: "agent_step" } },
          ],
        },
      },
      sort: [{ step: "desc" }, { ts: "desc" }],
    });
    const stepsByRun = new Map<string, Record<string, any>[]>();
    for (const hit of eventResponse.hits.hits) {
      const event = hit._source;
      if (!event) continue;
      const runId = String(event.runId ?? "");
      const steps = stepsByRun.get(runId) ?? [];
      steps.push(event);
      stepsByRun.set(runId, steps);
    }

    const runs = runHits.map((hit) => {
      const run = hit._source ?? {};
      const runId = String(run.id ?? hit._id);
      const steps = (stepsByRun.get(runId) ?? [])
        .sort((left, right) =>
          Number(right.step ?? 0) - Number(left.step ?? 0) ||
          String(right.ts ?? "").localeCompare(String(left.ts ?? "")),
        )
        .slice(0, 12)
        .sort((left, right) =>
          Number(left.step ?? 0) - Number(right.step ?? 0) ||
          String(left.ts ?? "").localeCompare(String(right.ts ?? "")),
        )
        .map((event) => ({
          step: Number(event.step ?? 0),
          action: String(event.action ?? ""),
          detail: String(event.detail ?? ""),
          ok: Boolean(event.ok),
          ts: String(event.ts ?? ""),
        }));
      return {
        runId,
        model: String(run.model ?? ""),
        variant: String(run.variant ?? ""),
        rep: Number(run.rep ?? 0),
        status: liveRunStatus(String(run.status ?? "")),
        ...(run.live_view_url ? { liveViewUrl: String(run.live_view_url) } : {}),
        ...(run.replay_view_url ? { replayUrl: String(run.replay_view_url) } : {}),
        ...(run.furthest_stage ? { furthestStage: String(run.furthest_stage) } : {}),
        steps,
      };
    }).sort((left, right) =>
      Number(right.status === "running") - Number(left.status === "running") ||
      left.model.localeCompare(right.model) ||
      left.runId.localeCompare(right.runId),
    );
    return c.json({ runs });
  });

  app.get("/api/experiments/:id/analytics", async (c) =>
    c.json(await getExperimentAnalytics(elastic, c.req.param("id"))),
  );

  app.get("/api/experiments/:id/runs", async (c) => {
    const result = await elastic.search<Record<string, any>>({
      index: RUNS_INDEX,
      size: 1000,
      query: { term: { experiment_id: c.req.param("id") } },
      sort: [{ created_at: "asc" }],
    });
    return c.json(result.hits.hits.flatMap((hit) => hit._source ? [hit._source] : []));
  });

  app.get("/pages.css", async (c) => {
    try {
      return c.body(await readFile(resolve("server/pages.css"), "utf8"), 200, {
        "content-type": "text/css; charset=utf-8",
      });
    } catch {
      return c.body("", 200, { "content-type": "text/css; charset=utf-8" });
    }
  });

  app.get("/*", async (c) => {
    const webRoot = resolve("web/dist");
    const requested = c.req.path === "/" ? "index.html" : decodeURIComponent(c.req.path.slice(1));
    const path = resolve(webRoot, requested);
    if (path !== webRoot && !path.startsWith(`${webRoot}/`)) {
      return c.text("Not found", 404);
    }
    try {
      const content = await readFile(path);
      const contentType = mimeType(extname(path));
      return c.body(content, 200, { "content-type": contentType });
    } catch {
      try {
        const content = await readFile(resolve(webRoot, "index.html"));
        return c.body(content, 200, { "content-type": "text/html; charset=utf-8" });
      } catch {
        return c.text("Not found", 404);
      }
    }
  });
  return app;
}

async function withRunCounts(client: Client, experiment: Record<string, any>) {
  const [total, done] = await Promise.all([
    client.count({
      index: RUNS_INDEX,
      query: { term: { experiment_id: experiment.id } },
    }),
    client.count({
      index: RUNS_INDEX,
      query: {
        bool: {
          filter: [
            { term: { experiment_id: experiment.id } },
            { terms: { status: ["complete", "completed", "done", "failed"] } },
          ],
        },
      },
    }),
  ]);
  return {
    ...experiment,
    competitors: (experiment.competitors ?? []).map((competitor: Record<string, any>) => ({
      id: competitor.id,
      title: competitor.title,
      brand: competitor.brand ?? null,
      image_url: competitor.image_url ?? "",
      price: Number(competitor.price ?? competitor.offers?.[0]?.price?.amount ?? 0),
      domain: competitor.domain ?? competitor.offers?.[0]?.domain ?? "",
      url: competitor.url ?? competitor.offers?.[0]?.url ?? "",
    })),
    run_counts: {
      total: total.count,
      done: done.count,
    },
  };
}

function liveRunStatus(status: string): "queued" | "running" | "done" | "failed" {
  if (status === "running") return "running";
  if (status === "done" || status === "complete" || status === "completed") return "done";
  if (status === "failed") return "failed";
  return "queued";
}

async function readJson(c: { req: { json: () => Promise<unknown> } }) {
  try {
    const value = await c.req.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, any>
      : null;
  } catch {
    return null;
  }
}

function mimeType(extension: string) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".json": "application/json",
  } as Record<string, string>)[extension] ?? "application/octet-stream";
}
