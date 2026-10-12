import { afterEach, describe, expect, it } from "vitest";
import Kernel from "@onkernel/sdk";
import {
  PayPalClient,
  PayPalApiError,
} from "../server/paypal.js";
import { MODEL_FLEET, PAYPAL_API_BASE_URL } from "../server/config.js";
import { gateway } from "../server/gateway.js";

const paypalEnabled = Boolean(
  process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET,
);
const gatewayEnabled = Boolean(process.env.ASTRO_GATEWAY_API_KEY);
const kernelEnabled = Boolean(process.env.KERNEL_API_KEY && process.env.ASTRO_GATEWAY_API_KEY);

describe("live Astropods AI gateway", () => {
  it.skipIf(!gatewayEnabled)("returns a required tool call from each shopper model", async () => {
    const client = gateway();
    const tools = [{
      type: "function" as const,
      function: {
        name: "report_ready",
        description: "Report that the test is ready.",
        parameters: {
          type: "object",
          properties: { ready: { type: "boolean" } },
          required: ["ready"],
          additionalProperties: false,
        },
      },
    }];
    for (const model of MODEL_FLEET) {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: "Report that you are ready." }],
        tools,
        tool_choice: "required",
      });
      const call = response.choices[0]?.message.tool_calls?.[0];
      expect(call?.type === "function" ? call.function.name : undefined).toBe("report_ready");
    }
  });
});

describe("live PayPal sandbox", () => {
  it.skipIf(!paypalEnabled)("creates, patches, reads, and attempts to capture a real order", async () => {
    const paypal = new PayPalClient(
      process.env.PAYPAL_CLIENT_ID!,
      process.env.PAYPAL_CLIENT_SECRET!,
    );
    const initial = await paypal.createOrder({
      subtotal: { currency_code: "USD", value: "1.00" },
      shipping: { currency_code: "USD", value: "0.00" },
      tax: { currency_code: "USD", value: "0.00" },
      total: { currency_code: "USD", value: "1.00" },
    });
    expect(initial.id).toBeTruthy();
    expect(initial.links.find((link: { rel: string }) => link.rel === "approve")?.href)
      .toContain(PAYPAL_API_BASE_URL.replace("api-m.sandbox", "www.sandbox"));

    await paypal.patchOrderAmount(String(initial.id), {
      subtotal: { currency_code: "USD", value: "2.00" },
      shipping: { currency_code: "USD", value: "0.00" },
      tax: { currency_code: "USD", value: "0.00" },
      total: { currency_code: "USD", value: "2.00" },
    });
    const updated = await paypal.getOrder(String(initial.id));
    expect(updated.status).toBe("CREATED");
    expect(updated.purchase_units[0].amount.value).toBe("2.00");

    try {
      await paypal.captureOrder(String(initial.id));
      throw new Error("An unapproved sandbox order unexpectedly captured.");
    } catch (error) {
      expect(error).toBeInstanceOf(PayPalApiError);
      expect((error as PayPalApiError).status).toBe(422);
      expect((error as PayPalApiError).payload.details?.[0]?.issue).toBe("ORDER_NOT_APPROVED");
    }
  });
});

describe("live KERNEL browser", () => {
  let browser: Awaited<ReturnType<Kernel["browsers"]["create"]>> | undefined;
  let client: Kernel | undefined;
  let replayId: string | undefined;

  afterEach(async () => {
    if (client && browser && replayId) {
      await client.browsers.replays.stop(replayId, { id_or_name: browser.session_id });
    }
    if (client && browser) {
      await client.browsers.deleteByID(browser.session_id);
    }
  });

  it.skipIf(!kernelEnabled)("creates a stealth browser and records a replay", async () => {
    client = new Kernel({ apiKey: process.env.KERNEL_API_KEY });
    browser = await client.browsers.create({ stealth: true });
    const replay = await client.browsers.replays.start(browser.session_id);
    replayId = replay.replay_id;
    expect(browser.session_id).toBeTruthy();
    expect(replayId).toBeTruthy();
  });
});
