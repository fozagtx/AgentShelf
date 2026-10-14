import { afterEach, describe, expect, it, vi } from "vitest";
import { PayPalApiError, PayPalClient } from "../server/paypal.js";

const totals = {
  total: { currency_code: "USD", value: "12.00" },
};

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("PayPal REST requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends stable request IDs on create and capture retries", async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const attempts = new Map<string, number>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/oauth2/token")) {
        return response({ access_token: "access-token", expires_in: 3600 });
      }
      requests.push({ url, init: init ?? {} });
      const count = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, count);
      if (count === 1) return response({ name: "INTERNAL_SERVER_ERROR" }, 500);
      return response({ id: "ORDER-123", status: "COMPLETED" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const paypal = new PayPalClient("client-id", "client-secret");
    await expect(
      paypal.createOrder(totals, undefined, "agentshelf-create-cart-123"),
    ).rejects.toBeInstanceOf(PayPalApiError);
    await paypal.createOrder(totals, undefined, "agentshelf-create-cart-123");
    await expect(
      paypal.captureOrder("ORDER-123", "agentshelf-capture-ORDER-123"),
    ).rejects.toBeInstanceOf(PayPalApiError);
    await paypal.captureOrder("ORDER-123", "agentshelf-capture-ORDER-123");

    const createRequests = requests.filter(({ url }) => url.endsWith("/v2/checkout/orders"));
    const captureRequests = requests.filter(({ url }) => url.endsWith("/capture"));
    const requestId = (init: RequestInit) =>
      new Headers(init.headers).get("PayPal-Request-Id");
    expect(createRequests.map(({ init }) => requestId(init))).toEqual([
      "agentshelf-create-cart-123",
      "agentshelf-create-cart-123",
    ]);
    expect(captureRequests.map(({ init }) => requestId(init))).toEqual([
      "agentshelf-capture-ORDER-123",
      "agentshelf-capture-ORDER-123",
    ]);
  });

  it("maps known PayPal issues and falls back to PayPal's message", () => {
    const declined = new PayPalApiError(422, {
      message: "Processor message",
      details: [{ issue: "INSTRUMENT_DECLINED" }],
    });
    expect(declined.issue).toBe("INSTRUMENT_DECLINED");
    expect(declined.plainReason).toBe(
      "PayPal declined the payment method. Choose a different payment method.",
    );

    const fallback = new PayPalApiError(422, {
      message: "A different PayPal issue.",
      details: [{ issue: "SOME_NEW_ISSUE" }],
    });
    expect(fallback.issue).toBe("SOME_NEW_ISSUE");
    expect(fallback.plainReason).toBe("A different PayPal issue.");
  });
});
