import { describe, expect, it } from "vitest";
import {
  SHOPPER_TOOLS,
  formatObservation,
  formatShopperActionDetail,
  missingShopperCredentials,
  parseShopperToolCall,
} from "../server/shopper.js";

describe("shopper tool helpers", () => {
  it("formats page context and a numbered interactive-element list", () => {
    const observation = formatObservation({
      url: "https://agentshelf.example/shelf/example?run=run-1",
      title: "Product shelf",
      visibleText: "x".repeat(6500),
      elements: [
        { id: "1", tag: "button", label: "Checkout", type: "submit" },
      ],
    });

    expect(observation).toContain("URL: https://agentshelf.example/shelf/example?run=run-1");
    expect(observation).toContain("Title: Product shelf");
    expect(observation).toContain("x".repeat(6000));
    expect(observation).not.toContain("x".repeat(6001));
    expect(observation).toContain('1. id=1 tag=button label="Checkout" type=submit');
  });

  it("exposes the shopper tool definitions", () => {
    expect(SHOPPER_TOOLS.map((tool) =>
      tool.type === "function" ? tool.function.name : "custom",
    )).toEqual([
      "click",
      "type",
      "select",
      "back",
      "done",
    ]);
  });

  it("requires KERNEL and LLM provider credentials", () => {
    const kernelKey = process.env.KERNEL_API_KEY;
    const openAiKey = process.env.OPENAI_API_KEY;
    const nebiusKey = process.env.NEBIUS_API_KEY;
    delete process.env.KERNEL_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.NEBIUS_API_KEY;
    try {
      expect(missingShopperCredentials()).toEqual([
        "KERNEL_API_KEY",
        "OPENAI_API_KEY or NEBIUS_API_KEY",
      ]);
    } finally {
      if (kernelKey) process.env.KERNEL_API_KEY = kernelKey;
      else delete process.env.KERNEL_API_KEY;
      if (openAiKey) process.env.OPENAI_API_KEY = openAiKey;
      else delete process.env.OPENAI_API_KEY;
      if (nebiusKey) process.env.NEBIUS_API_KEY = nebiusKey;
      else delete process.env.NEBIUS_API_KEY;
    }
  });

  it("masks password input and the PayPal sandbox password", () => {
    expect(formatShopperActionDetail(
      { type: "type", id: "1", text: "sandbox-secret" },
      { id: "1", tag: "input", label: "Password", type: "password" },
      "sandbox-secret",
    )).toBe("Password: ••••••");
    expect(formatShopperActionDetail(
      { type: "type", id: "2", text: "sandbox-secret" },
      { id: "2", tag: "input", label: "Email", type: "text" },
      "sandbox-secret",
    )).toBe("Email: ••••••");
  });

  it("parses a valid tool call with an observed element id", () => {
    const parsed = parseShopperToolCall({
      id: "call-1",
      type: "function",
      function: { name: "type", arguments: '{"id":"2","text":"buyer@example.com"}' },
    }, new Set(["1", "2"]));

    expect(parsed).toEqual({
      ok: true,
      toolCallId: "call-1",
      action: { type: "type", id: "2", text: "buyer@example.com" },
    });
  });

  it("returns a tool error for malformed JSON", () => {
    const parsed = parseShopperToolCall({
      id: "call-bad-json",
      type: "function",
      function: { name: "click", arguments: "{" },
    }, new Set(["1"]));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("valid JSON");
  });

  it("returns a tool error for an unknown element id", () => {
    const parsed = parseShopperToolCall({
      id: "call-unknown",
      type: "function",
      function: { name: "click", arguments: '{"id":"99"}' },
    }, new Set(["1"]));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("unknown element id");
  });

  it("parses done without requiring an element id", () => {
    const parsed = parseShopperToolCall({
      id: "call-done",
      type: "function",
      function: {
        name: "done",
        arguments: '{"summary":"Finished checkout.","chosen_title":"Everyday bottle"}',
      },
    }, new Set());

    expect(parsed).toEqual({
      ok: true,
      toolCallId: "call-done",
      action: {
        type: "done",
        summary: "Finished checkout.",
        chosen_title: "Everyday bottle",
      },
    });
  });
});
