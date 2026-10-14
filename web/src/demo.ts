import type { Analytics, Experiment, RunRow } from "./api";

const MODELS = ["claude-sonnet-4-6", "gpt-5-6-terra", "nova-pro", "mistral-large-3"];

export const demoExperiment: Experiment = {
  id: "demo",
  product_id: "merino-crew",
  merchant_product: { id: "merino-crew", title: "Merino Wool Crew Sweater", brand: "Northfold", price: 128, url: "#" },
  query: "merino wool crew sweater under $150",
  reps: 3,
  status: "running",
  created_at: "2026-10-14T12:00:00Z",
  competitors: [
    { id: "c1", title: "Everyday Merino Crew", price: 118, domain: "everlane.com", url: "#" },
    { id: "c2", title: "Fine Gauge Merino Sweater", price: 139, domain: "jcrew.com", url: "#" },
    { id: "c3", title: "Extra Fine Merino Crewneck", price: 49.9, domain: "uniqlo.com", url: "#" },
    { id: "c4", title: "Lightweight Merino Pullover", price: 145, domain: "patagonia.com", url: "#" },
  ],
  run_counts: { total: 24, done: 18 },
};

export const demoRuns: RunRow[] = MODELS.flatMap((model, m) =>
  ["original", "fixed"].flatMap((variant) =>
    [0, 1, 2].map((rep) => ({
      id: `${model}-${variant}-${rep}`,
      model,
      variant,
      status: m === 2 && rep > 0 ? "running" : m === 3 && rep === 2 ? "failed" : "done",
    })),
  ),
);

const funnel = (stage: string, counts: number[]) => MODELS.map((model, i) => ({ model, stage, count: counts[i] }));

export const demoStats: Analytics = {
  shareByModel: MODELS.flatMap((model, i) => [
    { model, variant: "original", runs: 3, merchantPicks: [1, 1, 0, 1][i], share: [0.33, 0.33, 0, 0.33][i] },
    { model, variant: "fixed", runs: 3, merchantPicks: [3, 2, 1, 2][i], share: [1, 0.67, 0.33, 0.67][i] },
  ]),
  positionBias: [{ position: 1, runs: 18, picks: 11, share: 0.61 }],
  funnel: [
    ...funnel("shelf_viewed", [6, 6, 2, 4]),
    ...funnel("cart_created", [5, 4, 1, 3]),
    ...funnel("approval_redirected", [5, 4, 1, 2]),
    ...funnel("approval_returned", [4, 3, 1, 2]),
    ...funnel("captured", [4, 3, 0, 2]),
  ],
  failures: [],
  takeaway: {
    headline: "The rewritten listing won 4 of every 6 picks on Claude.",
    bestFix: null,
    topBreak: null,
    overall: { originalShare: 0.25, fixedShare: 0.67 },
  },
};
