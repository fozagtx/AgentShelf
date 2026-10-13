import { describe, expect, it } from "vitest";
import type { Analytics, Experiment, RunRow } from "../web/src/api.js";
import { buildStudioData } from "../web/src/studio/data.js";

const experiment: Experiment = {
  id: "experiment-1",
  product_id: "product-1",
  query: "insulated water bottle",
  reps: 1,
  status: "complete",
  created_at: "2026-10-13T00:00:00.000Z",
  merchant_product: {
    id: "product-1",
    title: "Merchant bottle",
    brand: "AgentShelf",
    price: 25,
    url: "https://agentshelf.example/store/product-1",
  },
  competitors: [
    {
      id: "channel3-1",
      title: "Competitor bottle",
      brand: "Other Brand",
      price: 20,
      domain: "shop.example",
      url: "https://shop.example/bottle",
    },
    {
      id: "channel3-2",
      title: "Second competitor",
      brand: "Second Brand",
      price: 30,
      domain: "another.example",
      url: "https://another.example/bottle",
    },
  ],
};

const runs: RunRow[] = [
  {
    id: "run-1",
    model: "model-a",
    variant: "original",
    status: "done",
    chosen_is_merchant: true,
    chosen_offer: "https://agentshelf.example/store/product-1",
    chosen_title: "Merchant bottle",
    chosen_position: 1,
    furthest_stage: "captured",
    duration_ms: 8000,
    replay_view_url: "https://replay.example/run-1",
  },
  {
    id: "run-2",
    model: "model-a",
    variant: "original",
    status: "failed",
    chosen_is_merchant: false,
    chosen_offer: "https://shop.example/bottle",
    chosen_title: "Competitor bottle",
    chosen_position: 2,
    furthest_stage: "offer_selected",
    failure_stage: "checkout",
    failure_reason: "Checkout failed",
  },
  {
    id: "run-3",
    model: "model-a",
    variant: "fixed",
    status: "done",
    chosen_is_merchant: false,
    chosen_offer: "https://another.example/bottle",
    chosen_title: "Second competitor",
    furthest_stage: "product_viewed",
  },
  {
    id: "run-4",
    model: "model-b",
    variant: "original",
    status: "pending",
  },
];

const stats: Analytics = {
  shareByModel: [
    { model: "model-a", variant: "original", runs: 2, merchantPicks: 1, share: 0.5 },
    { model: "model-a", variant: "fixed", runs: 1, merchantPicks: 0, share: 0 },
    { model: "model-b", variant: "original", runs: 1, merchantPicks: 0, share: 0 },
  ],
  positionBias: [{ position: 1, runs: 1, picks: 1, share: 1 }],
  funnel: [{ model: "model-a", stage: "captured", count: 1 }],
  failures: [],
  takeaway: {
    headline: "The merchant was picked.",
    bestFix: null,
    topBreak: null,
    overall: null,
  },
};

describe("buildStudioData", () => {
  it("matches analytics shares and relates shelf picks to their actual offers", () => {
    const data = buildStudioData(experiment, runs, stats);
    const rows = (id: string) => {
      const source = data.sources.find((entry) => entry.id === id);
      return source && "data" in source
        ? source.data as Record<string, any>[]
        : [];
    };
    const runRows = rows("runs");
    const shelfRows = rows("shelf");

    expect(runRows).toHaveLength(stats.shareByModel.reduce((sum, row) => sum + row.runs, 0));
    for (const share of stats.shareByModel) {
      const group = runRows.filter((run) =>
        run.model === share.model && run.variant === share.variant,
      );
      expect(group).toHaveLength(share.runs);
      expect(group.reduce((sum, run) => sum + Number(run.picked_ours), 0) / group.length)
        .toBe(share.share);
    }

    expect(runRows[0]).toMatchObject({
      run_id: "run-1",
      picked_offer_id: "https://agentshelf.example/store/product-1",
      picked_brand: "AgentShelf",
      picked_price: 25,
      picked_domain: "agentshelf.example",
      reached: "Order captured",
      captured: 1,
      duration_s: 8,
      replay_url: "https://replay.example/run-1",
    });
    expect(runRows[1]).toMatchObject({
      picked_offer_id: "https://shop.example/bottle",
      picked_brand: "Other Brand",
      picked_price: 20,
      picked_domain: "shop.example",
      broke_at: "checkout",
      failure_reason: "Checkout failed",
    });
    expect(runRows[3]).toMatchObject({
      picked_ours: 0,
      picked_position: null,
      picked_offer_id: null,
      picked_brand: null,
      picked_price: null,
      picked_domain: null,
    });
    expect(shelfRows).toEqual([
      expect.objectContaining({
        offer_id: "https://agentshelf.example/store/product-1",
        is_ours: 1,
        picks: 1,
        share: 0.25,
      }),
      expect.objectContaining({
        offer_id: "https://shop.example/bottle",
        is_ours: 0,
        picks: 1,
        share: 0.25,
      }),
      expect.objectContaining({
        offer_id: "https://another.example/bottle",
        is_ours: 0,
        picks: 1,
        share: 0.25,
      }),
    ]);

    expect(data.relationships).toEqual([{
      id: "runs-picked-offer",
      source: { tableId: "runs", fieldId: "picked_offer_id" },
      target: { tableId: "shelf", fieldId: "offer_id" },
      type: "many-to-one",
    }]);
    expect(data.sources.map((source) => source.id)).toEqual([
      "runs",
      "shelf",
      "position",
      "funnel",
      "takeaway",
    ]);
  });
});
