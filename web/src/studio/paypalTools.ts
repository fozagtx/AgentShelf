export interface PayPalListTransactionsArgs {
  start_date?: string;
  end_date?: string;
}

export function createPayPalTools(studioApi: any) {
  return [
    studioApi.defineAiTool({
      name: "paypal_get_order",
      description: "Get the status and details of a PayPal order by its order ID.",
      params: (s: any) => s.object({
        orderId: s.string({ description: "The PayPal order ID." }),
      }),
      execute: async ({ orderId }: { orderId: string }, ctx: any) => {
        const result = await callPayPalMcp("get_order", { id: orderId });
        return ctx.success(JSON.stringify(result), { result });
      },
    }),
    studioApi.defineAiTool({
      name: "paypal_list_transactions",
      description: "List PayPal transactions within an optional ISO 8601 date range.",
      params: (s: any) => s.object({
        start_date: s.string({
          description: "Start date and time in ISO 8601 format. Seconds are required.",
        }).optional(),
        end_date: s.string({
          description: "End date and time in ISO 8601 format. Seconds are required.",
        }).optional(),
      }),
      execute: async (args: PayPalListTransactionsArgs, ctx: any) => {
        const result = await callPayPalMcp("list_transactions", { ...args });
        return ctx.success(JSON.stringify(result), { result });
      },
    }),
  ];
}

async function callPayPalMcp(name: string, args: Record<string, unknown>) {
  const response = await fetch("/api/paypal-mcp/call", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, args }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(result.error ?? result.message ?? "PayPal MCP request failed."));
  }
  return result;
}
