import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const { mcpCallMock } = vi.hoisted(() => ({
  mcpCallMock: vi.fn(),
}));

vi.mock("../server/paypalMcp.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../server/paypalMcp.js")>(),
  callPayPalMcp: mcpCallMock,
}));

import { createApp } from "../server/app.js";
import {
  ensureSchema,
  EXPERIMENTS_TABLE,
  putDoc,
  RUNS_TABLE,
} from "../server/db.js";
import { db, request, testPrefix } from "./helpers.js";

const integrationId = `${testPrefix}-paypal-verification`;
const experimentId = `${integrationId}-experiment`;
const runIds = [
  `${integrationId}-verified`,
  `${integrationId}-mismatch`,
  `${integrationId}-missing`,
];
const paypalCredentials = {
  clientId: process.env.PAYPAL_CLIENT_ID,
  clientSecret: process.env.PAYPAL_CLIENT_SECRET,
};

describe("PayPal experiment verification with local PostgreSQL", () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    await ensureSchema(db);
    app = await createApp({ db });
    await putDoc(db, EXPERIMENTS_TABLE, experimentId, {
      id: experimentId,
      product_id: `${testPrefix}-product`,
      query: "water bottle",
      competitors: [],
      status: "complete",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const runDocs = [
      {
        id: runIds[0],
        experiment_id: experimentId,
        model: "model-verified",
        paypal_order_id: "ORDER-VERIFIED",
        paypal_captured_amount: { currency_code: "USD", value: "24.50" },
        capture_status: "COMPLETED",
        furthest_stage: "captured",
        created_at: "2026-01-01T00:00:01.000Z",
      },
      {
        id: runIds[1],
        experiment_id: experimentId,
        model: "model-mismatch",
        paypal_order_id: "ORDER-MISMATCH",
        paypal_captured_amount: { currency_code: "USD", value: "24.50" },
        capture_status: "COMPLETED",
        furthest_stage: "captured",
        created_at: "2026-01-01T00:00:02.000Z",
      },
      {
        id: runIds[2],
        experiment_id: experimentId,
        model: "model-missing",
        paypal_order_id: "ORDER-MISSING",
        paypal_captured_amount: { currency_code: "USD", value: "24.50" },
        capture_status: "COMPLETED",
        furthest_stage: "captured",
        created_at: "2026-01-01T00:00:03.000Z",
      },
    ];
    await Promise.all(runDocs.map((run) => putDoc(db, RUNS_TABLE, run.id, run)));
  });

  afterEach(() => {
    mcpCallMock.mockReset();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (paypalCredentials.clientId === undefined) delete process.env.PAYPAL_CLIENT_ID;
    else process.env.PAYPAL_CLIENT_ID = paypalCredentials.clientId;
    if (paypalCredentials.clientSecret === undefined) delete process.env.PAYPAL_CLIENT_SECRET;
    else process.env.PAYPAL_CLIENT_SECRET = paypalCredentials.clientSecret;
    await Promise.all([
      db.query("delete from runs where id like $1", [`${integrationId}%`]),
      db.query("delete from experiments where id like $1", [`${integrationId}%`]),
    ]);
    await db.end();
  });

  it("verifies completed captured amounts and stores mismatches and 404s", async () => {
    process.env.PAYPAL_CLIENT_ID = "sandbox-client";
    process.env.PAYPAL_CLIENT_SECRET = "sandbox-secret";
    mcpCallMock.mockImplementation(async (_name: string, args: { id: string }) => {
      if (args.id === "ORDER-MISSING") {
        return {
          isError: true,
          content: [{ type: "text", text: "PayPal returned HTTP 404: resource not found." }],
        };
      }
      const order = {
        id: args.id,
        status: args.id === "ORDER-VERIFIED" ? "COMPLETED" : "PENDING",
        purchase_units: [{
          payments: {
            captures: [{
              amount: { currency_code: "USD", value: "24.50" },
            }],
          },
        }],
      };
      return { content: [{ type: "text", text: JSON.stringify(order) }] };
    });

    const response = await request(
      app,
      "POST",
      `/api/experiments/${experimentId}/paypal/verify`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checked: 3,
      verified: 1,
      mismatches: [
        {
          runId: runIds[1],
          model: "model-mismatch",
          orderId: "ORDER-MISMATCH",
          paypalStatus: "PENDING",
        },
        {
          runId: runIds[2],
          model: "model-missing",
          orderId: "ORDER-MISSING",
          paypalStatus: "NOT_FOUND",
        },
      ],
    });
    expect(mcpCallMock.mock.calls.map(([name, args]) => [name, args])).toEqual([
      ["get_order", { id: "ORDER-VERIFIED" }],
      ["get_order", { id: "ORDER-MISMATCH" }],
      ["get_order", { id: "ORDER-MISSING" }],
    ]);

    const storedColumns = await db.query(
      "select paypal_verified, paypal_status, paypal_checked_at from runs where id = $1",
      [runIds[0]],
    );
    expect(storedColumns.rows[0]).toMatchObject({
      paypal_verified: "verified",
      paypal_status: "COMPLETED",
    });
    expect(storedColumns.rows[0].paypal_checked_at).toBeInstanceOf(Date);

    const stored = await request(
      app,
      "GET",
      `/api/experiments/${experimentId}/paypal`,
    );
    expect(stored.status).toBe(200);
    expect(await stored.json()).toMatchObject({
      checked: 3,
      verified: 1,
      mismatches: [
        { runId: runIds[1], paypalStatus: "PENDING" },
        { runId: runIds[2], paypalStatus: "NOT_FOUND" },
      ],
    });
    expect(mcpCallMock).toHaveBeenCalledTimes(3);

    const rows = await request(app, "GET", `/api/experiments/${experimentId}/runs`);
    expect(await rows.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: runIds[0], paypal_verified: "verified" }),
        expect.objectContaining({ id: runIds[1], paypal_verified: "mismatch" }),
        expect.objectContaining({ id: runIds[2], paypal_verified: "not_found" }),
      ]),
    );
  });

  it("returns the missing-credentials response without calling PayPal", async () => {
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    const response = await request(
      app,
      "POST",
      `/api/experiments/${experimentId}/paypal/verify`,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "PayPal sandbox credentials missing",
    });
    expect(mcpCallMock).not.toHaveBeenCalled();
    const status = await request(app, "GET", "/api/status");
    expect((await status.json()).paypalMcp).toBe(false);
  });

  it("rejects write tools at the server proxy before invoking the MCP client", async () => {
    const response = await request(app, "POST", "/api/paypal-mcp/call", undefined, {
      name: "create_order",
      args: {},
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "PayPal MCP tool is not allowed: create_order",
    });
    expect(mcpCallMock).not.toHaveBeenCalled();
  });
});
