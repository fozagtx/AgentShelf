import type {
  AgAiEvent,
  AgAiOutputItem,
  AgLlmAdapter,
  AgLlmRequest,
  AgLlmResponse,
} from "ag-studio";

type ChatResponse = {
  id?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    index?: number;
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }> | null;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

function messageText(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) =>
    part && typeof part === "object" && "text" in part && typeof part.text === "string"
      ? [part.text]
      : [],
  ).join("\n");
}

function toChatMessages(request: AgLlmRequest) {
  const messages: Array<Record<string, unknown>> = [];
  if (request.instructions) messages.push({ role: "system", content: request.instructions });

  for (const item of request.input) {
    if (item.type === "message") {
      const role = item.kind === "input" ? item.role : "assistant";
      messages.push({
        role,
        content: messageText(item.content),
      });
    } else if (item.type === "function_call") {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: item.callId,
          type: "function",
          function: { name: item.name, arguments: item.arguments },
        }],
      });
    } else if (item.type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: item.callId,
        content: item.output,
      });
    }
  }
  return messages;
}

export function toChatPayload(request: AgLlmRequest, fallbackModel: string) {
  const toolChoice = request.toolChoice;
  const tools = request.tools?.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
  const responseFormat = request.responseFormat.type === "json"
    ? {
        type: "json_schema" as const,
        json_schema: {
          name: request.responseFormat.name,
          ...(request.responseFormat.description
            ? { description: request.responseFormat.description }
            : {}),
          strict: true,
          schema: request.responseFormat.schema,
        },
      }
    : undefined;

  return {
    model: request.model?.id ?? fallbackModel,
    messages: toChatMessages(request),
    ...(tools?.length ? { tools } : {}),
    ...(toolChoice
      ? {
          tool_choice: typeof toolChoice === "string"
            ? toolChoice
            : { type: "function", function: { name: toolChoice.name } },
        }
      : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    max_tokens: 2000,
  };
}

export function chatResponseToLlmResponse(chat: ChatResponse): AgLlmResponse {
  const responseId = chat.id ?? crypto.randomUUID();
  const message = chat.choices?.[0]?.message;
  const output: AgAiOutputItem[] = [];
  if (message?.content) {
    output.push({
      id: `${responseId}-message`,
      kind: "output",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "text", text: message.content, annotations: [] }],
    });
  }
  for (const [index, call] of (message?.tool_calls ?? []).entries()) {
    output.push({
      id: `${responseId}-tool-${index}`,
      kind: "output",
      type: "function_call",
      callId: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
      status: "completed",
    });
  }
  return {
    id: responseId,
    createdAt: (chat.created ?? Math.floor(Date.now() / 1000)) * 1000,
    output,
    status: "completed",
    ...(chat.model ? { model: chat.model } : {}),
    ...(chat.usage ? {
      usage: {
        inputTokens: chat.usage.prompt_tokens ?? 0,
        outputTokens: chat.usage.completion_tokens ?? 0,
        totalTokens: chat.usage.total_tokens ?? 0,
      },
    } : {}),
  };
}

async function* responseEvents(response: AgLlmResponse): AsyncGenerator<AgAiEvent> {
  for (const item of response.output) {
    if (item.type === "message") {
      const text = messageText(item.content);
      yield { type: "TEXT_MESSAGE_START", messageId: item.id, role: "assistant" };
      if (text) yield { type: "TEXT_MESSAGE_CONTENT", messageId: item.id, delta: text };
      yield { type: "TEXT_MESSAGE_END", messageId: item.id };
    } else if (item.type === "function_call") {
      yield {
        type: "TOOL_CALL_START",
        toolCallId: item.callId,
        toolCallName: item.name,
      };
      yield { type: "TOOL_CALL_ARGS", toolCallId: item.callId, delta: item.arguments };
      yield { type: "TOOL_CALL_END", toolCallId: item.callId };
    }
  }
}

export function createGatewayAdapter(defaultModel = "gpt-5-6-terra"): AgLlmAdapter {
  return {
    executeTurn(request, options) {
      const payload = toChatPayload(request, defaultModel);
      const complete = (async () => {
        const response = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: options?.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body?.error ?? `Chat request failed with status ${response.status}.`);
        }
        return chatResponseToLlmResponse(body as ChatResponse);
      })();
      return { stream: responseEventsFromPromise(complete), complete };
    },
  };
}

async function* responseEventsFromPromise(
  complete: Promise<AgLlmResponse>,
): AsyncGenerator<AgAiEvent> {
  yield* responseEvents(await complete);
}
