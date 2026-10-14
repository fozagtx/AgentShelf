import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { Hono } from "hono";
import type { Db } from "./db.js";
import {
  configuredIntegrations,
  DEFAULT_REPS,
  MODEL_FLEET,
  PRODUCT_FIX_MODEL,
} from "./config.js";
import {
  countDocs,
  createDb,
  ensureSchema,
  CARTS_TABLE,
  EVENTS_TABLE,
  EXPERIMENTS_TABLE,
  findDocs,
  getDoc,
  patchDoc,
  PRODUCTS_TABLE,
  putDoc,
  RUNS_TABLE,
} from "./db.js";
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
import { missingPayPalCredentials } from "./paypal.js";
import {
  callPayPalMcp,
  isAllowedPayPalMcpTool,
} from "./paypalMcp.js";

export interface AppOptions {
  db?: Db;
}

export async function createApp(options: AppOptions = {}) {
  const db = options.db ?? createDb();
  await ensureSchema(db);
  const platformKey = await loadPlatformKey(db);
  const app = new Hono();
  app.get("/.well-known/jwks.json", (c) =>
    c.json({ keys: [platformKey.publicJwk] }),
  );

  app.get("/api/status", (c) => {
    const configured = configuredIntegrations();
    return c.json({
      paypal: configured.paypal,
      paypalMcp: configured.paypal,
      channel3: configured.channel3,
      kernel: configured.kernel,
      render: configured.render,
      database: configured.database,
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

  app.post("/api/paypal-mcp/call", async (c) => {
    const input = await readJson(c);
    if (
      !input ||
      typeof input.name !== "string" ||
      (input.args !== undefined &&
        (!input.args || typeof input.args !== "object" || Array.isArray(input.args)))
    ) {
      return c.json({ error: "A tool name and object arguments are required." }, 400);
    }
    if (!isAllowedPayPalMcpTool(input.name)) {
      return c.json({ error: `PayPal MCP tool is not allowed: ${input.name}` }, 400);
    }
    if (missingPayPalCredentials().length) {
      return c.json({ error: "PayPal sandbox credentials missing" }, 503);
    }
    try {
      return c.json(await callPayPalMcp(
        input.name,
        (input.args ?? {}) as Record<string, unknown>,
      ));
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : "PayPal MCP request failed.",
      }, 502);
    }
  });

  app.route("/", createProductRoutes(db));
  app.route("/", createImageRoutes(db));
  app.route("/api/paypal/v1", createMerchantRoutes(db, platformKey));
  app.route("/", createPageRoutes(db));

  app.post("/api/products/:id/fix", async (c) => {
    const missing = missingGatewayCredentials();
    if (missing.length) {
      return c.json({
        message: `Product copy fixes are unavailable. Missing environment variables: ${missing.join(", ")}.`,
      }, 503);
    }
    const product = await getProduct(db, c.req.param("id"));
    if (!product) return c.json({ message: "Product not found." }, 404);
    const experiments = await findDocs<Record<string, any>>(db, EXPERIMENTS_TABLE, {
      where: { product_id: product.id },
    });
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
      await putDoc(db, PRODUCTS_TABLE, product.id, updated);
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
    const product = await getProduct(db, input.productId);
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
      competitors = await searchCompetitors(input.query.trim(), {
        price: product.price,
        channel3_id: product.channel3_id,
        url: product.url,
      });
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
    await putDoc(db, EXPERIMENTS_TABLE, id, experiment);
    try {
      await startExperimentWorkflow(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start the Render workflow.";
      await patchDoc(db, EXPERIMENTS_TABLE, id, {
        status: "failed",
        failure_reason: message,
      });
      return c.json({ message }, 502);
    }
    return c.json({ id }, 201);
  });

  app.get("/api/experiments", async (c) => {
    const experiments = await findDocs<Record<string, any>>(db, EXPERIMENTS_TABLE);
    return c.json(await Promise.all(experiments.map((experiment) => withRunCounts(db, experiment))));
  });

  app.get("/api/experiments/:id", async (c) => {
    const experiment = await getDoc<Record<string, any>>(
      db,
      EXPERIMENTS_TABLE,
      c.req.param("id"),
    );
    if (!experiment) return c.json({ message: "Experiment not found." }, 404);
    return c.json(await withRunCounts(db, experiment));
  });

  app.put("/api/experiments/:id/report", async (c) => {
    const body = await readJson(c);
    if (
      !body ||
      !("state" in body) ||
      (body.state !== null &&
        (!body.state || typeof body.state !== "object" || Array.isArray(body.state)))
    ) {
      return c.json({ message: "Report state must be an object or null." }, 400);
    }
    const experimentId = c.req.param("id");
    const experiment = await getDoc<Record<string, any>>(
      db,
      EXPERIMENTS_TABLE,
      experimentId,
    );
    if (!experiment) return c.json({ message: "Experiment not found." }, 404);
    await patchDoc(db, EXPERIMENTS_TABLE, experimentId, { report_state: body.state });
    return c.json({ report_state: body.state });
  });

  app.get("/api/experiments/:id/live", async (c) => {
    const experimentId = c.req.param("id");
    const runDocs = await findDocs<Record<string, any>>(db, RUNS_TABLE, {
      where: { experiment_id: experimentId },
      limit: 1000,
    });
    if (!runDocs.length) return c.json({ runs: [] });

    const runIds = runDocs.map((run) => String(run.id ?? ""));
    const eventDocs = await findDocs<Record<string, any>>(db, EVENTS_TABLE, {
      where: { stage: "agent_step" },
      anyOf: ["runId", runIds],
    });
    const stepsByRun = new Map<string, Record<string, any>[]>();
    for (const event of eventDocs) {
      const runId = String(event.runId ?? "");
      const steps = stepsByRun.get(runId) ?? [];
      steps.push(event);
      stepsByRun.set(runId, steps);
    }

    const runs = runDocs.map((run) => {
      const runId = String(run.id ?? "");
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
    c.json(await getExperimentAnalytics(db, c.req.param("id"))),
  );

  app.get("/api/experiments/:id/runs", async (c) => {
    const runs = await findDocs<Record<string, any>>(db, RUNS_TABLE, {
      where: { experiment_id: c.req.param("id") },
      orderBy: "created_at",
      limit: 1000,
    });
    return c.json(runs.map((run) => ({
      ...run,
      paypal_verified: run.paypal_verified ?? null,
    })));
  });

  app.get("/api/experiments/:id/paypal", async (c) => {
    const experimentId = c.req.param("id");
    const experiment = await getDoc<Record<string, any>>(
      db,
      EXPERIMENTS_TABLE,
      experimentId,
    );
    if (!experiment) return c.json({ error: "Experiment not found." }, 404);
    const runs = await findDocs<Record<string, any>>(db, RUNS_TABLE, {
      where: { experiment_id: experimentId },
      orderBy: "created_at",
      limit: 1000,
    });
    return c.json(storedPayPalVerification(runs));
  });

  app.post("/api/experiments/:id/paypal/verify", async (c) => {
    const experimentId = c.req.param("id");
    const experiment = await getDoc<Record<string, any>>(
      db,
      EXPERIMENTS_TABLE,
      experimentId,
    );
    if (!experiment) return c.json({ error: "Experiment not found." }, 404);
    if (missingPayPalCredentials().length) {
      return c.json({ error: "PayPal sandbox credentials missing" }, 503);
    }
    const runs = await findDocs<Record<string, any>>(db, RUNS_TABLE, {
      where: { experiment_id: experimentId },
      orderBy: "created_at",
      limit: 1000,
    });
    const capturedRuns = runs.filter((run) => {
      const captureStatus = String(run.capture_status ?? "").toUpperCase();
      return Boolean(run.paypal_order_id) &&
        (run.furthest_stage === "captured" ||
          captureStatus === "COMPLETED" ||
          captureStatus === "CAPTURED");
    });
    let verified = 0;
    const mismatches: { runId: string; model: string; orderId: string; paypalStatus: string }[] = [];
    for (const run of capturedRuns) {
      const runId = String(run.id ?? "");
      const orderId = String(run.paypal_order_id);
      let response: unknown;
      try {
        response = await callPayPalMcp("get_order", { id: orderId });
      } catch (error) {
        if (!isNotFoundError(error)) {
          return c.json({
            error: error instanceof Error ? error.message : "PayPal order verification failed.",
          }, 502);
        }
        response = { isError: true, content: [{ type: "text", text: String(error) }] };
      }
      const decoded = decodePayPalMcpResult(response);
      const paypalStatus = isNotFoundResult(response, decoded)
        ? "NOT_FOUND"
        : String(decoded.order.status ?? decoded.order.status_code ?? "UNKNOWN");
      if (Boolean((response as Record<string, any> | null)?.isError) &&
        paypalStatus !== "NOT_FOUND") {
        return c.json({
          error: decoded.text || "PayPal order verification failed.",
        }, 502);
      }
      let verification: "verified" | "mismatch" | "not_found";
      if (paypalStatus === "NOT_FOUND") {
        verification = "not_found";
      } else {
        const expectedAmount = run.paypal_captured_amount ??
          await getCapturedCartAmount(db, run.cart_id);
        verification = paypalStatus === "COMPLETED" &&
          amountsMatch(capturedAmount(decoded.order), expectedAmount)
          ? "verified"
          : "mismatch";
      }
      const checkedAt = new Date().toISOString();
      await db.query(
        `update ${RUNS_TABLE} set doc = doc || $2::jsonb, paypal_verified = $3, paypal_status = $4, paypal_checked_at = $5 where id = $1`,
        [
          runId,
          JSON.stringify({
            paypal_verified: verification,
            paypal_status: paypalStatus,
            paypal_checked_at: checkedAt,
          }),
          verification,
          paypalStatus,
          checkedAt,
        ],
      );
      if (verification === "verified") {
        verified += 1;
      } else {
        mismatches.push({
          runId,
          model: String(run.model ?? ""),
          orderId,
          paypalStatus,
        });
      }
    }
    return c.json({ checked: capturedRuns.length, verified, mismatches });
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

async function withRunCounts(db: Db, experiment: Record<string, any>) {
  const [total, done, product] = await Promise.all([
    countDocs(db, RUNS_TABLE, { where: { experiment_id: experiment.id } }),
    countDocs(db, RUNS_TABLE, {
      where: { experiment_id: experiment.id },
      anyOf: ["status", ["complete", "completed", "done", "failed"]],
    }),
    getDoc<Record<string, any>>(db, PRODUCTS_TABLE, String(experiment.product_id ?? "")),
  ]);
  return {
    ...experiment,
    merchant_product: product ? {
      id: product.id,
      title: product.title,
      brand: product.brand ?? null,
      price: Number(product.price ?? 0),
      url: String(product.url ?? ""),
    } : null,
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
      total,
      done,
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

function storedPayPalVerification(runs: Record<string, any>[]) {
  const checkedRuns = runs.filter((run) =>
    ["verified", "mismatch", "not_found"].includes(String(run.paypal_verified ?? "")),
  );
  return {
    checked: checkedRuns.length,
    verified: checkedRuns.filter((run) => run.paypal_verified === "verified").length,
    mismatches: checkedRuns
      .filter((run) => run.paypal_verified !== "verified")
      .map((run) => ({
        runId: String(run.id ?? ""),
        model: String(run.model ?? ""),
        orderId: String(run.paypal_order_id ?? ""),
        paypalStatus: String(
          run.paypal_status ??
            (run.paypal_verified === "not_found" ? "NOT_FOUND" : "UNKNOWN"),
        ),
      })),
  };
}

async function getCapturedCartAmount(db: Db, cartId: unknown) {
  if (typeof cartId !== "string" || !cartId) return null;
  const saved = await getDoc<Record<string, any>>(db, CARTS_TABLE, cartId);
  return saved?.cart?.totals?.total ?? saved?.totals?.total ?? null;
}

function capturedAmount(order: Record<string, any>) {
  const captures = Array.isArray(order.purchase_units)
    ? order.purchase_units.flatMap((unit: Record<string, any>) =>
        Array.isArray(unit.payments?.captures) ? unit.payments.captures : [],
      )
    : [];
  if (!captures.length) return null;
  const currency = captures[0]?.amount?.currency_code;
  if (!currency || captures.some((capture: Record<string, any>) =>
    capture.amount?.currency_code !== currency,
  )) {
    return null;
  }
  const cents = captures.reduce((sum: number, capture: Record<string, any>) =>
    sum + moneyToCents(capture.amount?.value),
  0);
  return { currency_code: currency, value: (cents / 100).toFixed(2) };
}

function amountsMatch(
  captured: Record<string, any> | null,
  expected: Record<string, any> | null,
) {
  return Boolean(
    captured &&
    expected &&
    captured.currency_code === expected.currency_code &&
    moneyToCents(captured.value) === moneyToCents(expected.value),
  );
}

function moneyToCents(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN;
}

function decodePayPalMcpResult(value: unknown): {
  order: Record<string, any>;
  text: string;
} {
  if (!value || typeof value !== "object") return { order: {}, text: String(value ?? "") };
  const result = value as Record<string, any>;
  if (result.structuredContent && typeof result.structuredContent === "object") {
    const structured = result.structuredContent as Record<string, any>;
    return {
      order: (structured.order && typeof structured.order === "object"
        ? structured.order
        : structured) as Record<string, any>,
      text: JSON.stringify(structured),
    };
  }
  const text = Array.isArray(result.content)
    ? result.content
        .filter((item: Record<string, any>) => item.type === "text")
        .map((item: Record<string, any>) => String(item.text ?? ""))
        .join("\n")
    : "";
  try {
    const parsed = JSON.parse(text) as Record<string, any>;
    const order = parsed.order && typeof parsed.order === "object"
      ? parsed.order
      : parsed;
    return { order, text };
  } catch {
    return { order: {}, text };
  }
}

function isNotFoundResult(
  value: unknown,
  decoded: { order: Record<string, any>; text: string },
) {
  const result = value as Record<string, any> | null;
  if (result?.status === 404) return true;
  if (!result?.isError) return false;
  const text = `${decoded.text} ${JSON.stringify(result ?? {})}`;
  return /\b404\b|RESOURCE_NOT_FOUND|ORDER_NOT_FOUND|does not exist|not found/i.test(text);
}

function isNotFoundError(error: unknown) {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /\b404\b|RESOURCE_NOT_FOUND|ORDER_NOT_FOUND|does not exist|not found/i.test(text);
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
