import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  PAYPAL_MCP_SSE_URL,
  PAYPAL_MCP_URL,
} from "./config.js";
import { missingPayPalCredentials, PayPalClient } from "./paypal.js";

export const PAYPAL_MCP_TOOL_NAMES = [
  "get_order",
  "list_transactions",
  "list_disputes",
  "get_dispute",
  "get_merchant_insights",
  "get_refund",
] as const;

export type PayPalMcpToolName = (typeof PAYPAL_MCP_TOOL_NAMES)[number];

const allowedTools = new Set<string>(PAYPAL_MCP_TOOL_NAMES);
let cachedCredentials: { clientId: string; clientSecret: string; client: PayPalClient } | undefined;

export function isAllowedPayPalMcpTool(name: string): name is PayPalMcpToolName {
  return allowedTools.has(name);
}

export async function listPayPalMcpTools(): Promise<Tool[]> {
  return withPayPalMcp(async (client) => {
    const result = await client.listTools();
    return result.tools.filter((tool) => allowedTools.has(tool.name));
  });
}

export async function callPayPalMcp(
  name: string,
  args: Record<string, unknown> = {},
): Promise<CallToolResult> {
  if (!isAllowedPayPalMcpTool(name)) {
    throw new Error(`PayPal MCP tool is not allowed: ${name}`);
  }
  return withPayPalMcp((client) =>
    client.callTool({ name, arguments: args }) as Promise<CallToolResult>,
  );
}

async function withPayPalMcp<T>(action: (client: Client) => Promise<T>): Promise<T> {
  const paypal = getPayPalClient();
  const client = await connectClient(await paypal.accessToken());
  try {
    return await action(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function connectClient(accessToken: string): Promise<Client> {
  const authorization = `Bearer ${accessToken}`;
  const streamableClient = new Client(
    { name: "agentshelf-paypal", version: "1.0.0" },
    { capabilities: {} },
  );
  try {
    await streamableClient.connect(
      new StreamableHTTPClientTransport(new URL(PAYPAL_MCP_URL), {
        requestInit: { headers: { Authorization: authorization } },
      }),
    );
    return streamableClient;
  } catch (streamableError) {
    await streamableClient.close().catch(() => undefined);
    const sseClient = new Client(
      { name: "agentshelf-paypal", version: "1.0.0" },
      { capabilities: {} },
    );
    try {
      await sseClient.connect(
        new SSEClientTransport(new URL(PAYPAL_MCP_SSE_URL), {
          requestInit: { headers: { Authorization: authorization } },
        }),
      );
      return sseClient;
    } catch (sseError) {
      await sseClient.close().catch(() => undefined);
      throw new AggregateError(
        [streamableError, sseError],
        "Unable to connect to PayPal MCP over Streamable HTTP or SSE.",
      );
    }
  }
}

function getPayPalClient() {
  const missing = missingPayPalCredentials();
  if (missing.length) throw new Error("PayPal sandbox credentials missing");
  const clientId = process.env.PAYPAL_CLIENT_ID!;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET!;
  if (
    !cachedCredentials ||
    cachedCredentials.clientId !== clientId ||
    cachedCredentials.clientSecret !== clientSecret
  ) {
    cachedCredentials = {
      clientId,
      clientSecret,
      client: new PayPalClient(clientId, clientSecret),
    };
  }
  return cachedCredentials.client;
}
