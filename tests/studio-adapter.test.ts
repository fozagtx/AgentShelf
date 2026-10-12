import { describe, expect, it } from "vitest";
import type { AgLlmRequest } from "ag-studio";
import { chatResponseToLlmResponse, toChatPayload } from "../web/src/studio/adapter.js";

describe("AG Studio gateway adapter translations", () => {
  it("maps an AG Studio request to an OpenAI Chat Completions payload", () => {
    const request = {
      input: [{
        id: "user-1",
        kind: "input",
        type: "message",
        role: "user",
        content: [{ type: "text", text: "Why was the listing skipped?" }],
        status: "completed",
      }],
      instructions: "Use the experiment results.",
      model: { id: "gpt-5-6-terra" },
      tools: [{
        name: "readFunnel",
        description: "Read checkout funnel data.",
        parameters: {
          type: "object",
          properties: { stage: { type: "string" } },
          required: ["stage"],
          additionalProperties: false,
        },
      }],
      toolChoice: "required",
      responseFormat: { type: "text" },
    } as AgLlmRequest;

    expect(toChatPayload(request, "nova-pro")).toEqual({
      model: "gpt-5-6-terra",
      messages: [
        { role: "system", content: "Use the experiment results." },
        { role: "user", content: "Why was the listing skipped?" },
      ],
      tools: [{
        type: "function",
        function: {
          name: "readFunnel",
          description: "Read checkout funnel data.",
          parameters: {
            type: "object",
            properties: { stage: { type: "string" } },
            required: ["stage"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: "required",
      max_tokens: 2000,
    });
  });

  it("maps a Chat Completions tool call into an AG Studio function call result", () => {
    const result = chatResponseToLlmResponse({
      id: "chatcmpl-1",
      created: 1_700_000_000,
      model: "gpt-5-6-terra",
      choices: [{
        finish_reason: "tool_calls",
        index: 0,
        message: {
          role: "assistant",
          content: "I will inspect the checkout funnel.",
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: {
              name: "readFunnel",
              arguments: "{\"stage\":\"captured\"}",
            },
          }],
        },
      }],
    });

    expect(result.output).toEqual([
      {
        id: expect.any(String),
        kind: "output",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "text", text: "I will inspect the checkout funnel.", annotations: [] }],
      },
      {
        id: expect.any(String),
        kind: "output",
        type: "function_call",
        callId: "call-1",
        name: "readFunnel",
        arguments: "{\"stage\":\"captured\"}",
        status: "completed",
      },
    ]);
  });
});
