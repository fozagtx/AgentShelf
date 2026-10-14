import { afterEach, describe, expect, it, vi } from "vitest";
import { callPayPalMcp } from "../server/paypalMcp.js";

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
