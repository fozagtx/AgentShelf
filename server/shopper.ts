import Kernel from "@onkernel/sdk";
import { chromium, type Browser as PlaywrightBrowser, type Page } from "playwright-core";
import { randomUUID } from "node:crypto";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { Db } from "./db.js";
import {
  getAppUrl,
  SHOPPER_MAX_ACTIONS,
  SHOPPER_TIMEOUT_MS,
} from "./config.js";
import {
  EVENTS_TABLE,
  findDocs,
  getDoc,
  patchDoc,
  putDoc,
  RUNS_TABLE,
} from "./db.js";
import { writeEvent } from "./events.js";
import { llm, missingLlmCredentials, type Provider } from "./llm.js";

export interface RunSpec {
  id: string;
  experimentId: string;
  productId: string;
  query: string;
  model: string;
  provider: Provider;
  variant: "original" | "fixed";
  rep: number;
  competitors: Array<Record<string, any>>;
  shelfOrder: Array<Record<string, any>>;
}

export interface ShopperElement {
  id: string;
  tag: string;
  label: string;
  type: string;
}

export interface ShopperObservation {
  url: string;
  title: string;
  visibleText: string;
  elements: ShopperElement[];
}

export type ShopperAction =
  | { type: "click"; id: string }
  | { type: "type"; id: string; text: string; submit?: boolean }
  | { type: "select"; id: string; value: string }
  | { type: "back" }
  | { type: "done"; summary: string; chosen_title: string };

export interface ShopperToolCall {
  id?: unknown;
  type?: unknown;
  function?: {
    name?: unknown;
    arguments?: unknown;
  };
}

export type ParsedShopperToolCall =
  | { ok: true; toolCallId: string; action: ShopperAction }
  | { ok: false; toolCallId: string; error: string; action?: string };

export const SHOPPER_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "click",
      description: "Click a visible interactive element by its observed id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "type",
      description: "Enter text into a visible input or textarea by its observed id.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          submit: { type: "boolean" },
        },
        required: ["id", "text"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "select",
      description: "Select an option by value from a visible select element.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          value: { type: "string" },
        },
        required: ["id", "value"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "back",
      description: "Navigate back one browser page.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "done",
      description: "Finish shopping and report the outcome.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          chosen_title: { type: "string" },
        },
        required: ["summary", "chosen_title"],
        additionalProperties: false,
      },
    },
  },
];

export function formatObservation(observation: ShopperObservation) {
  const elements = observation.elements.length
    ? observation.elements.map((element, index) =>
      `${index + 1}. id=${element.id} tag=${element.tag} label=${JSON.stringify(element.label)} type=${element.type}`,
    )
    : ["None"];
  return [
    `URL: ${observation.url}`,
    `Title: ${observation.title}`,
    "Visible text:",
    observation.visibleText.slice(0, 6000),
    "Interactive elements:",
    ...elements,
  ].join("\n");
}

export function parseShopperToolCall(
  toolCall: ShopperToolCall,
  validElementIds: ReadonlySet<string>,
): ParsedShopperToolCall {
  const toolCallId = typeof toolCall?.id === "string" ? toolCall.id : "";
  const name = typeof toolCall?.function?.name === "string"
    ? toolCall.function.name
    : "";
  const knownAction = ["click", "type", "select", "back", "done"].includes(name)
    ? name
    : undefined;
  const fail = (error: string): ParsedShopperToolCall => ({
    ok: false,
    toolCallId,
    error,
    ...(knownAction ? { action: knownAction } : {}),
  });
  if (toolCall?.type !== undefined && toolCall.type !== "function") {
    return fail("Unsupported shopper tool call type.");
  }
  if (!name || typeof toolCall?.function?.arguments !== "string") {
    return fail("Shopper tool call is missing its function name or JSON arguments.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(toolCall.function.arguments);
  } catch {
    return fail("Shopper tool call arguments must be valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return fail("Shopper tool call arguments must be a JSON object.");
  }
  const args = parsed as Record<string, unknown>;
  if (name === "back") {
    return { ok: true, toolCallId, action: { type: "back" } };
  }
  if (name === "done") {
    if (typeof args.summary !== "string" || typeof args.chosen_title !== "string") {
      return fail("The done tool requires summary and chosen_title strings.");
    }
    return {
      ok: true,
      toolCallId,
      action: {
        type: "done",
        summary: args.summary,
        chosen_title: args.chosen_title,
      },
    };
  }
  if (name !== "click" && name !== "type" && name !== "select") {
    return fail(`Unknown shopper tool: ${name}.`);
  }
  if (typeof args.id !== "string") {
    return fail(`The ${name} tool requires an element id string.`);
  }
  if (!validElementIds.has(args.id)) {
    return fail(`The ${name} tool referenced unknown element id ${args.id}.`);
  }
  if (name === "click") {
    return { ok: true, toolCallId, action: { type: "click", id: args.id } };
  }
  if (name === "type") {
    if (typeof args.text !== "string") {
      return fail("The type tool requires a text string.");
    }
    if (args.submit !== undefined && typeof args.submit !== "boolean") {
      return fail("The type tool submit value must be a boolean.");
    }
    return {
      ok: true,
      toolCallId,
      action: {
        type: "type",
        id: args.id,
        text: args.text,
        ...(typeof args.submit === "boolean" ? { submit: args.submit } : {}),
      },
    };
  }
  if (typeof args.value !== "string") {
    return fail("The select tool requires a value string.");
  }
  return {
    ok: true,
    toolCallId,
    action: { type: "select", id: args.id, value: args.value },
  };
}

export function formatShopperActionDetail(
  action: ShopperAction,
  target?: ShopperElement,
  paypalPassword = process.env.PAYPAL_SANDBOX_BUYER_PASSWORD,
) {
  const label = target?.label || (target ? `${target.tag} ${target.id}` : "");
  if (action.type === "click") return label || `Element ${action.id}`;
  if (action.type === "type") {
    const value = target?.type === "password" || (
      paypalPassword && action.text === paypalPassword
    )
      ? "••••••"
      : action.text;
    return `${label || `Element ${action.id}`}: ${value}`.slice(0, 1000);
  }
  if (action.type === "select") {
    return `${label || `Element ${action.id}`}: ${action.value}`.slice(0, 1000);
  }
  if (action.type === "done") return action.chosen_title || action.summary;
  return "Browser back";
}

export function missingShopperCredentials() {
  return [
    ...(!process.env.KERNEL_API_KEY ? ["KERNEL_API_KEY"] : []),
    ...missingLlmCredentials(),
  ];
}

export async function runShopper(db: Db, spec: RunSpec) {
  const startedAt = Date.now();
  const initial = {
    id: spec.id,
    experiment_id: spec.experimentId,
    product_id: spec.productId,
    query: spec.query,
    model: spec.model,
    variant: spec.variant,
    rep: spec.rep,
    shelf_order: spec.shelfOrder,
    status: "running",
    created_at: new Date().toISOString(),
  };
  await putDoc(db, RUNS_TABLE, spec.id, initial);

  const missing = missingShopperCredentials();
  if (missing.length) {
    return failRun(
      db,
      initial,
      "browser_create",
      `Computer-use shopping is unavailable. Missing environment variables: ${missing.join(", ")}.`,
      startedAt,
    );
  }

  const kernel = new Kernel({ apiKey: process.env.KERNEL_API_KEY });
  let browser: Awaited<ReturnType<typeof kernel.browsers.create>> | undefined;
  let cdpBrowser: PlaywrightBrowser | undefined;
  let replayId: string | undefined;
  let replayUrl: string | undefined;
  let liveViewUrl: string | undefined;
  let finalText = "";
  let lastToolResult = "";
  let lastAgentMessage = "";
  let failure: string | undefined;
  try {
    browser = await kernel.browsers.create({ stealth: true, headless: false });
    const replay = await kernel.browsers.replays.start(browser.session_id, {
      max_duration_in_seconds: Math.ceil(SHOPPER_TIMEOUT_MS / 1000),
    });
    replayId = replay.replay_id;
    replayUrl = replay.replay_view_url;
    liveViewUrl = withReadOnlyQuery(browser.browser_live_view_url);
    await patchDoc(db, RUNS_TABLE, spec.id, {
        status: "running",
        ...(liveViewUrl ? { live_view_url: liveViewUrl } : {}),
    });
    cdpBrowser = await chromium.connectOverCDP(browser.cdp_ws_url);
    const context = cdpBrowser.contexts()[0] ?? await cdpBrowser.newContext();
    const page = context.pages()[0] ?? await context.newPage();
    const shelfUrl = `${getAppUrl()}/shelf/${encodeURIComponent(spec.experimentId)}?run=${encodeURIComponent(spec.id)}`;
    await page.goto(shelfUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    const buyer = process.env.PAYPAL_SANDBOX_BUYER_EMAIL && process.env.PAYPAL_SANDBOX_BUYER_PASSWORD
      ? `Sandbox buyer email: ${process.env.PAYPAL_SANDBOX_BUYER_EMAIL}\nSandbox buyer password: ${process.env.PAYPAL_SANDBOX_BUYER_PASSWORD}`
      : "No sandbox buyer credentials are configured.";
    const prompt = [
      `Shop for "${spec.query}".`,
      `Start at ${getAppUrl()}/shelf/${encodeURIComponent(spec.experimentId)}?run=${encodeURIComponent(spec.id)}.`,
      "Choose the product you would genuinely buy after comparing the merchant product and competitors.",
      "If choosing the merchant product, add it to the cart, enter a US shipping address, select an available shipping method, and complete PayPal sandbox checkout.",
      `This run uses the ${spec.variant} merchant product copy.`,
      buyer,
      `Stop after ${SHOPPER_MAX_ACTIONS} meaningful browser actions.`,
    ].join("\n");
    const baseMessages: ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `You are shopping as a real customer. Use the browser tools, verify each step, and stop after at most ${SHOPPER_MAX_ACTIONS} meaningful browser actions. Never buy from a retailer. If a PayPal sandbox login is needed, use only the provided sandbox buyer credentials.`,
      },
      { role: "user", content: prompt },
    ];
    const ai = llm(spec.provider);
    const deadline = Date.now() + SHOPPER_TIMEOUT_MS;
    let previousToolMessages: ChatCompletionMessageParam[] = [];
    let actionCount = 0;
    let finished = false;
    while (actionCount < SHOPPER_MAX_ACTIONS && Date.now() < deadline && !finished) {
      const observation = await observePage(page);
      const messages: ChatCompletionMessageParam[] = [
        ...baseMessages,
        ...previousToolMessages,
        {
          role: "user",
          content: `Latest browser observation:\n${formatObservation(observation)}`,
        },
      ];
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      const requestCompletion = () =>
        ai.chat.completions.create({
          model: spec.model,
          messages,
          tools: SHOPPER_TOOLS,
          // Nebius only supports "auto" or a named function, not "required".
          tool_choice: spec.provider === "nebius" ? "auto" : "required",
        }, { timeout: remainingMs });
      let completion = await requestCompletion();
      let assistantMessage = completion.choices[0]?.message;
      if (!assistantMessage) throw new Error("Shopper model returned no message.");
      let calls = assistantMessage.tool_calls ?? [];
      if (!calls.length && spec.provider === "nebius") {
        // Nebius can answer without a tool call under "auto"; nudge once.
        lastAgentMessage = assistantMessage.content ?? "";
        messages.push(assistantMessage, {
          role: "user",
          content: "You must respond with exactly one browser tool call.",
        });
        completion = await requestCompletion();
        assistantMessage = completion.choices[0]?.message;
        if (!assistantMessage) throw new Error("Shopper model returned no message.");
        calls = assistantMessage.tool_calls ?? [];
      }
      lastAgentMessage = assistantMessage.content ?? "";
      if (!calls.length) {
        finalText = assistantMessage.content ?? "";
        throw new Error("Shopper model did not return a required tool call.");
      }

      const toolMessages: ChatCompletionMessageParam[] = [];
      messages.push(assistantMessage);
      for (const call of calls) {
        if (actionCount >= SHOPPER_MAX_ACTIONS) break;
        actionCount += 1;
        const parsed = parseShopperToolCall(call, new Set(observation.elements.map((item) => item.id)));
        const action = parsed.ok ? parsed.action : undefined;
        const target = action && "id" in action
          ? observation.elements.find((item) => item.id === action.id)
          : undefined;
        const actionName = action?.type ?? parsed.action ?? "error";
        let detail = action
          ? formatShopperActionDetail(action, target)
          : `Invalid ${actionName} tool call`;
        let ok = false;
        let errorMessage: string | undefined;
        let toolResult: string;

        if (!parsed.ok) {
          errorMessage = redactSecrets(parsed.error);
          toolResult = JSON.stringify({ ok: false, error: errorMessage });
        } else if (parsed.action.type === "done") {
          finalText = parsed.action.summary;
          finished = true;
          ok = true;
          toolResult = JSON.stringify({ ok: true, summary: parsed.action.summary });
        } else {
          try {
            toolResult = await executeShopperAction(page, parsed.action, target);
            await waitForActionSettled(page);
            ok = true;
            toolResult = JSON.stringify({ ok: true, result: toolResult });
          } catch (error) {
            errorMessage = redactSecrets(error instanceof Error ? error.message : String(error));
            toolResult = JSON.stringify({ ok: false, error: errorMessage });
          }
        }

        await writeEvent(db, {
          experimentId: spec.experimentId,
          runId: spec.id,
          stage: "agent_step",
          ok,
          step: actionCount,
          action: actionName,
          detail: redactSecrets(detail),
          ...(errorMessage ? { error: errorMessage } : {}),
        });
        lastToolResult = toolResult;
        toolMessages.push({
          role: "tool",
          tool_call_id: parsed.toolCallId || call.id,
          content: toolResult,
        });
        if (finished) break;
      }
      previousToolMessages = [assistantMessage, ...toolMessages];
      if (finished) break;
    }
    if (!finished && actionCount >= SHOPPER_MAX_ACTIONS) {
      failure = `Shopper reached the ${SHOPPER_MAX_ACTIONS} action limit.`;
    } else if (!finished && Date.now() >= deadline) {
      failure = `Shopper exceeded the ${SHOPPER_TIMEOUT_MS} ms timeout.`;
    }
    if (!finished) finalText = lastAgentMessage || lastToolResult || finalText;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    if (!finalText) finalText = lastAgentMessage || lastToolResult;
  } finally {
    if (browser && replayId) {
      try {
        await kernel.browsers.replays.stop(replayId, { id_or_name: browser.session_id });
        const replays = await kernel.browsers.replays.list(browser.session_id);
        replayUrl = replays.find((item) => item.replay_id === replayId)?.replay_view_url ?? replayUrl;
      } catch (error) {
        failure ??= `Replay stop failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (cdpBrowser) {
      try {
        await cdpBrowser.close();
      } catch (error) {
        failure ??= `Playwright browser cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (browser) {
      try {
        await kernel.browsers.deleteByID(browser.session_id);
      } catch (error) {
        failure ??= `Browser cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  if (failure) {
    await writeEvent(db, {
      experimentId: spec.experimentId,
      runId: spec.id,
      stage: "shopper_failed",
      ok: false,
      error: failure,
    });
  }
  const eventDocs = await findDocs<Record<string, any>>(db, EVENTS_TABLE, {
    where: { runId: spec.id },
    orderBy: "ts",
    limit: 1000,
  });
  const order = ["shelf_viewed", "offer_selected", "product_viewed", "cart_created", "cart_updated", "approval_redirected", "approval_returned", "captured"];
  const furthestStage = eventDocs.reduce<string | undefined>((furthest, event) =>
    order.indexOf(event.stage) > order.indexOf(furthest ?? "")
      ? String(event.stage)
      : furthest,
  undefined);
  const selection = eventDocs.find((event) => event.stage === "offer_selected");
  const errorEvent = eventDocs.find((event) => event.ok === false);
  const previous = await getDoc<Record<string, any>>(db, RUNS_TABLE, spec.id);
  const run = {
    ...previous,
    ...initial,
    status: failure || errorEvent ? "failed" : "done",
    ...(selection ? {
      chosen_offer: selection.chosen_offer,
      chosen_title: selection.chosen_title,
      chosen_is_merchant: selection.is_merchant,
      chosen_position: selection.position,
    } : {}),
    ...(furthestStage ? { furthest_stage: furthestStage } : {}),
    ...(failure || errorEvent ? {
      failure_stage: String(errorEvent?.stage ?? "shopper"),
      failure_reason: failure ?? String(errorEvent?.error ?? ""),
    } : {}),
    ...((selection?.paypal_order_id ?? previous?.paypal_order_id)
      ? { paypal_order_id: selection?.paypal_order_id ?? previous?.paypal_order_id }
      : {}),
    ...((selection?.capture_status ?? previous?.capture_status)
      ? { capture_status: selection?.capture_status ?? previous?.capture_status }
      : {}),
    ...(replayUrl ? { replay_view_url: replayUrl } : {}),
    agent_final_text: redactSecrets(finalText),
    duration_ms: Date.now() - startedAt,
    completed_at: new Date().toISOString(),
  };
  await putDoc(db, RUNS_TABLE, spec.id, run);
  return run;
}

async function observePage(page: Page): Promise<ShopperObservation> {
  const state = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll(
      "a, button, input, select, textarea, [role=button]",
    ));
    const elements = candidates.flatMap((element, index) => {
      const html = element as HTMLElement;
      const style = window.getComputedStyle(html);
      const bounds = html.getBoundingClientRect();
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0" ||
        bounds.width === 0 ||
        bounds.height === 0
      ) return [];

      const id = String(index + 1);
      html.setAttribute("data-as-id", id);
      const control = element as HTMLInputElement;
      const associatedLabel = control.labels
        ? Array.from(control.labels).map((label) => label.innerText.trim()).filter(Boolean).join(" ")
        : "";
      const label = (
        html.getAttribute("aria-label") ||
        html.innerText?.trim() ||
        associatedLabel ||
        html.getAttribute("placeholder") ||
        html.getAttribute("name") ||
        ""
      ).trim();
      const type = element instanceof HTMLInputElement
        ? element.type
        : html.getAttribute("type") ||
          html.getAttribute("role") ||
          html.tagName.toLowerCase();
      return [{
        id,
        tag: html.tagName.toLowerCase(),
        label,
        type,
      }];
    });
    return {
      visibleText: document.body?.innerText ?? "",
      elements,
    };
  });
  return {
    url: page.url(),
    title: await page.title(),
    ...state,
  };
}

function withReadOnlyQuery(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.searchParams.set("readOnly", "true");
    return url.toString();
  } catch {
    return value;
  }
}

async function executeShopperAction(
  page: Page,
  action: Exclude<ShopperAction, { type: "done" }>,
  target?: ShopperElement,
) {
  if (action.type === "back") {
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 8_000 });
    return "Navigated back.";
  }
  const locator = page.locator(`[data-as-id="${action.id}"]`);
  if (await locator.count() === 0) {
    throw new Error(`Element ${action.id} is no longer available.`);
  }
  const label = target?.label || `element ${action.id}`;
  if (action.type === "click") {
    await locator.click({ timeout: 8_000 });
    return `Clicked ${label}.`;
  }
  if (action.type === "type") {
    await locator.fill(action.text, { timeout: 8_000 });
    if (action.submit) await locator.press("Enter", { timeout: 8_000 });
    return `Entered text in ${label}.`;
  }
  await locator.selectOption(action.value, { timeout: 8_000 });
  return `Selected an option for ${label}.`;
}

async function waitForActionSettled(page: Page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 1_500 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 1_500 }).catch(() => undefined);
}

async function failRun(
  db: Db,
  initial: Record<string, any>,
  stage: string,
  reason: string,
  startedAt: number,
) {
  const run = {
    ...initial,
    status: "failed",
    failure_stage: stage,
    failure_reason: reason,
    duration_ms: Date.now() - startedAt,
    completed_at: new Date().toISOString(),
  };
  await Promise.all([
    putDoc(db, RUNS_TABLE, String(initial.id), run),
    writeEvent(db, {
      experimentId: String(initial.experiment_id),
      runId: String(initial.id),
      stage,
      ok: false,
      error: reason,
    }),
  ]);
  return run;
}

function redactSecrets(value: string) {
  return [
    process.env.PAYPAL_SANDBOX_BUYER_EMAIL,
    process.env.PAYPAL_SANDBOX_BUYER_PASSWORD,
  ].filter((secret): secret is string => Boolean(secret))
    .reduce((text, secret) => text.replaceAll(secret, "[redacted]"), value);
}

export function newRunId() {
  return randomUUID();
}
