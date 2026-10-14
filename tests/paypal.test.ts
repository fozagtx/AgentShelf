import { afterEach, describe, expect, it, vi } from "vitest";
import { PayPalApiError, PayPalClient, retryDelay } from "../server/paypal.js";

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

  it("captures debug_id and appends it to the error message", () => {
    const error = new PayPalApiError(500, {
      name: "INTERNAL_SERVER_ERROR",
      message: "An internal server error has occurred.",
      debug_id: "abc123def456",
    });
    expect(error.debugId).toBe("abc123def456");
    expect(error.message).toContain("(debug_id: abc123def456)");

    const withoutDebugId = new PayPalApiError(500, { message: "boom" });
    expect(withoutDebugId.debugId).toBeUndefined();
    expect(withoutDebugId.message).not.toContain("debug_id");
  });

  it("retries HTTP 429 with the same request id and honors Retry-After", async () => {
    const requests: RequestInit[] = [];
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/oauth2/token")) {
        return response({ access_token: "access-token", expires_in: 3600 });
      }
      requests.push(init ?? {});
      calls += 1;
      if (calls === 1) {
        return response({ name: "RATE_LIMIT_REACHED" }, 429);
      }
      return response({ id: "ORDER-9", status: "CREATED" });
    }));
    const sleep = vi.fn(async () => {});
    const originalSleep = retryDelay.sleep;
    retryDelay.sleep = sleep;
    try {
      const paypal = new PayPalClient("client-id", "client-secret");
      const order = await paypal.createOrder(
        totals,
        undefined,
        "agentshelf-retry-429",
      );
      expect(order.id).toBe("ORDER-9");
    } finally {
      retryDelay.sleep = originalSleep;
    }

    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    const requestIds = requests.map((init) =>
      new Headers(init.headers).get("PayPal-Request-Id"),
    );
    expect(requestIds).toEqual(["agentshelf-retry-429", "agentshelf-retry-429"]);
  });

  it("sends payment_source experience context instead of application_context", async () => {
    const bodies: Record<string, any>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/oauth2/token")) {
        return response({ access_token: "access-token", expires_in: 3600 });
      }
      bodies.push(JSON.parse(String(init?.body)));
      return response({ id: "ORDER-7", status: "CREATED" });
    }));

    const paypal = new PayPalClient("client-id", "client-secret");
    await paypal.createOrder(totals, {
      returnUrl: "https://example.test/return",
      cancelUrl: "https://example.test/cancel",
    });

    const body = bodies[0];
    expect(body.application_context).toBeUndefined();
    const context = body.payment_source?.paypal?.experience_context;
    expect(context).toMatchObject({
      return_url: "https://example.test/return",
      cancel_url: "https://example.test/cancel",
      user_action: "PAY_NOW",
    });

    bodies.length = 0;
    await paypal.createOrder(totals);
    const contextWithoutUrls = bodies[0].payment_source.paypal.experience_context;
    expect(contextWithoutUrls.user_action).toBe("PAY_NOW");
    expect("return_url" in contextWithoutUrls).toBe(false);
    expect("cancel_url" in contextWithoutUrls).toBe(false);
  });
});
