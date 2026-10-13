import type { AgDataSourcesDefinition } from "ag-studio";
import type { Analytics, Experiment, RunRow } from "../api.js";

type Offer = {
  offer_id: string;
  title: string;
  brand: string | null;
  price: number | null;
  domain: string | null;
  is_ours: 0 | 1;
};

function domainFromUrl(url: string | undefined) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function stageLabel(stage: unknown) {
  const value = typeof stage === "string" ? stage : "";
  const labels: Record<string, string> = {
    shelf_viewed: "Shelf viewed",
    offer_selected: "Offer selected",
    product_viewed: "Product viewed",
    cart_created: "Cart created",
    cart_updated: "Cart updated",
    approval_redirected: "PayPal approval",
    approval_returned: "PayPal returned",
    captured: "Order captured",
  };
  return labels[value] ?? (value.replaceAll("_", " ") || null);
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(number)
    ? null
    : number;
}

export function buildStudioData(
  exp: Experiment,
  runs: RunRow[],
  stats: Analytics,
): AgDataSourcesDefinition {
  const offers: Offer[] = [];
  const merchant = exp.merchant_product;
  if (merchant?.url) {
    offers.push({
      offer_id: merchant.url,
      title: merchant.title,
      brand: merchant.brand ?? null,
      price: numberOrNull(merchant.price),
      domain: domainFromUrl(merchant.url),
      is_ours: 1,
    });
  }
  for (const competitor of exp.competitors) {
    offers.push({
      offer_id: competitor.url,
      title: competitor.title,
      brand: competitor.brand ?? null,
      price: numberOrNull(competitor.price),
      domain: competitor.domain || domainFromUrl(competitor.url),
      is_ours: 0,
    });
  }

  const offersById = new Map(offers.map((offer) => [offer.offer_id, offer]));
  const analyticsGroups = new Set(
    stats.shareByModel.map((share) => `${share.model}\0${share.variant}`),
  );
  const runRows = runs
    .filter((run) => {
      const model = String(run.model ?? "");
      const variant = String(run.variant ?? "");
      return analyticsGroups.has(`${model}\0${variant}`);
    })
    .map((run) => {
      const chosenOffer = typeof run.chosen_offer === "string" ? run.chosen_offer : "";
      const offer = offersById.get(chosenOffer);
      const durationMs = numberOrNull(run.duration_ms);
      return {
        run_id: String(run.id ?? run.run_id ?? ""),
        model: String(run.model ?? ""),
        variant: String(run.variant ?? ""),
        status: String(run.status ?? ""),
        picked_ours: run.chosen_is_merchant === true ? 1 : 0,
        picked_position: numberOrNull(run.chosen_position),
        picked_title: typeof run.chosen_title === "string" ? run.chosen_title : null,
        picked_brand: offer?.brand ?? null,
        picked_price: offer?.price ?? null,
        picked_domain: offer?.domain ?? null,
        reached: stageLabel(run.furthest_stage),
        broke_at: typeof run.failure_stage === "string" ? run.failure_stage : null,
        failure_reason: typeof run.failure_reason === "string" ? run.failure_reason : null,
        captured: run.furthest_stage === "captured" ? 1 : 0,
        duration_s: durationMs === null ? numberOrNull(run.duration_s) : durationMs / 1000,
        replay_url: typeof run.replay_view_url === "string"
          ? run.replay_view_url
          : typeof run.replay_url === "string"
            ? run.replay_url
            : null,
        picked_offer_id: offer?.offer_id ?? null,
      };
    });

  const picksByOffer = new Map<string, number>();
  for (const run of runRows) {
    if (run.picked_offer_id) {
      picksByOffer.set(run.picked_offer_id, (picksByOffer.get(run.picked_offer_id) ?? 0) + 1);
    }
  }
  const shelfRows = offers.map((offer) => {
    const picks = picksByOffer.get(offer.offer_id) ?? 0;
    return {
      ...offer,
      picks,
      share: runRows.length ? picks / runRows.length : 0,
    };
  });
  const takeaway = stats.takeaway;

  return {
    sources: [
      {
        id: "runs",
        name: "Runs",
        data: runRows,
        fields: [
          ...["run_id", "model", "variant", "status", "picked_title", "picked_brand", "picked_domain", "reached", "broke_at", "failure_reason", "replay_url", "picked_offer_id"].map((id) => ({ id, format: "textFormat" as const })),
          { id: "picked_ours", format: "percentageFormat" as const },
          { id: "picked_position", format: "integerFormat" as const },
          { id: "picked_price", format: "currencyFormat" as const },
          { id: "captured", format: "integerFormat" as const },
          { id: "duration_s", format: "decimalFormat" as const },
        ],
      },
      {
        id: "shelf",
        name: "Shelf",
        data: shelfRows,
        fields: [
          ...["offer_id", "title", "brand", "domain"].map((id) => ({ id, format: "textFormat" as const })),
          { id: "price", format: "currencyFormat" as const },
          { id: "is_ours", format: "integerFormat" as const },
          { id: "picks", format: "integerFormat" as const },
          { id: "share", format: "percentageFormat" as const },
        ],
      },
      {
        id: "position",
        name: "Position",
        data: stats.positionBias,
        fields: [
          { id: "position", format: "integerFormat" as const },
          { id: "runs", format: "integerFormat" as const },
          { id: "picks", format: "integerFormat" as const },
          { id: "share", format: "percentageFormat" as const },
        ],
      },
      {
        id: "funnel",
        name: "Funnel",
        data: stats.funnel,
        fields: [
          { id: "model", format: "textFormat" as const },
          { id: "stage", format: "textFormat" as const },
          { id: "count", format: "integerFormat" as const },
        ],
      },
      {
        id: "takeaway",
        name: "Takeaway",
        data: [{
          headline: takeaway.headline,
          model: takeaway.bestFix?.model ?? null,
          originalShare: takeaway.bestFix?.originalShare ?? null,
          fixedShare: takeaway.bestFix?.fixedShare ?? null,
          delta: takeaway.bestFix?.delta ?? null,
          topBreakStage: takeaway.topBreak?.stage ?? null,
          topBreakCount: takeaway.topBreak?.count ?? null,
        }],
        fields: [
          ...["headline", "model", "topBreakStage"].map((id) => ({ id, format: "textFormat" as const })),
          { id: "originalShare", format: "percentageFormat" as const },
          { id: "fixedShare", format: "percentageFormat" as const },
          { id: "delta", format: "percentageFormat" as const },
          { id: "topBreakCount", format: "integerFormat" as const },
        ],
      },
    ],
    relationships: [{
      id: "runs-picked-offer",
      source: { tableId: "runs", fieldId: "picked_offer_id" },
      target: { tableId: "shelf", fieldId: "offer_id" },
      type: "many-to-one",
    }],
  };
}
