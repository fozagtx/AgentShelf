import { afterEach, describe, expect, it, vi } from "vitest";
import { callPayPalMcp, PAYPAL_MCP_TOOL_NAMES } from "../server/paypalMcp.js";
import { createApp } from "../server/app.js";
import { ensureSchema } from "../server/db.js";
import { db, request } from "./helpers.js";

describe("PayPal MCP allowlist", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects mutating tools before making any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(callPayPalMcp("create_order", {})).rejects.toThrow(
      "PayPal MCP tool is not allowed: create_order",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/paypal-mcp/tools", () => {
  it("reports disconnected with the allowlisted tool names when credentials are missing", async () => {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    try {
      await ensureSchema(db);
      const app = await createApp({ db });
      const res = await request(app, "GET", "/api/paypal-mcp/tools");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.connected).toBe(false);
      expect(body.server).toBe("https://mcp.sandbox.paypal.com/http");
      expect(body.tools.map((tool: { name: string }) => tool.name))
        .toEqual([...PAYPAL_MCP_TOOL_NAMES]);
    } finally {
      if (clientId) process.env.PAYPAL_CLIENT_ID = clientId;
      if (clientSecret) process.env.PAYPAL_CLIENT_SECRET = clientSecret;
    }
  });
});
