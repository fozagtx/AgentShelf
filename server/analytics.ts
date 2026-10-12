import type { Client } from "@elastic/elasticsearch";
import { RUNS_INDEX } from "./elastic.js";

export const ANALYTICS_INDEX = RUNS_INDEX;

const funnelStages = [
  "shelf_viewed",
  "offer_selected",
  "product_viewed",
  "cart_created",
  "cart_updated",
  "approval_redirected",
  "approval_returned",
  "captured",
] as const;

const funnelStageLabels: Record<string, string> = {
  shelf_viewed: "shelf viewing",
  offer_selected: "offer selection",
  product_viewed: "product page",
  cart_created: "cart creation",
  cart_updated: "cart update",
  approval_redirected: "PayPal approval",
  approval_returned: "PayPal return",
  captured: "PayPal capture",
};

export interface ShareByModel {
  model: string;
  variant: string;
  runs: number;
  merchantPicks: number;
  share: number;
}

export interface Takeaway {
  headline: string | null;
  bestFix: {
    model: string;
    originalShare: number;
    fixedShare: number;
    delta: number;
  } | null;
  topBreak: { model: string; stage: string; count: number } | null;
  overall: { originalShare: number; fixedShare: number } | null;
}

export interface AnalyticsFailure {
  runId?: string;
  model: string;
  variant?: string;
  stage: string;
  reason?: string;
  replayUrl?: string | null;
}

export function buildTakeaway(
  shareByModel: ShareByModel[],
  failures: AnalyticsFailure[],
): Takeaway {
  const byModel = new Map<string, Map<string, ShareByModel>>();
  for (const row of shareByModel) {
    const variants = byModel.get(row.model) ?? new Map<string, ShareByModel>();
    variants.set(row.variant, row);
    byModel.set(row.model, variants);
  }

  const paired = [...byModel.entries()]
    .flatMap(([model, variants]) => {
      const original = variants.get("original");
      const fixed = variants.get("fixed");
      return original?.runs && fixed?.runs
        ? [{
            model,
            originalShare: original.share,
            fixedShare: fixed.share,
            delta: fixed.share - original.share,
          }]
        : [];
    })
    .sort((left, right) => left.model.localeCompare(right.model));
  const bestFix = paired
    .filter((row) => row.delta > 0)
    .sort((left, right) =>
      right.delta - left.delta || left.model.localeCompare(right.model),
    )[0] ?? null;

  const overallFor = (variant: string) => {
    const rows = shareByModel.filter((row) => row.variant === variant && row.runs > 0);
    const runs = rows.reduce((total, row) => total + row.runs, 0);
    if (!runs) return null;
    const picks = rows.reduce((total, row) => total + row.merchantPicks, 0);
    return picks / runs;
  };
  const originalShare = overallFor("original");
  const fixedShare = overallFor("fixed");
  const overall = originalShare === null || fixedShare === null
    ? null
    : { originalShare, fixedShare };

  const breakCounts = new Map<string, { model: string; stage: string; count: number }>();
  for (const failure of failures) {
    const key = `${failure.model}\0${failure.stage}`;
    const current = breakCounts.get(key);
    breakCounts.set(key, {
      model: failure.model,
      stage: failure.stage,
      count: (current?.count ?? 0) + 1,
    });
  }
  const topBreak = [...breakCounts.values()].sort((left, right) =>
    right.count - left.count ||
    left.model.localeCompare(right.model) ||
    left.stage.localeCompare(right.stage),
  )[0] ?? null;

  let headline = bestFix
    ? `The fixed listing raised your share on ${bestFix.model} from ${Math.round(bestFix.originalShare * 100)}% to ${Math.round(bestFix.fixedShare * 100)}%.`
    : paired.length
      ? "Your original listing beat the fix on every model."
      : shareByModel.some((row) => row.runs > 0)
        ? "Your experiment does not yet have paired runs for the original listing and the fix."
        : null;
  if (headline && topBreak) {
    const stageLabel = funnelStageLabels[topBreak.stage] ?? topBreak.stage.replaceAll("_", " ");
    headline += ` Checkout broke most often at ${stageLabel} for ${topBreak.model} (${topBreak.count} runs).`;
  }

  return {
    headline,
    bestFix,
    topBreak,
    overall,
  };
}

export async function getExperimentAnalytics(client: Client, experimentId: string) {
  const response = await client.search<Record<string, any>>({
    index: RUNS_INDEX,
    size: 1000,
    query: { term: { experiment_id: experimentId } },
    sort: [{ created_at: "asc" }],
    aggs: {
      model: {
        terms: { field: "model", size: 50 },
        aggs: {
          furthest_stages: {
            terms: { field: "furthest_stage", size: funnelStages.length },
          },
          variant: {
            terms: { field: "variant", size: 5 },
            aggs: {
              merchant_picks: { filter: { term: { chosen_is_merchant: true } } },
            },
          },
        },
      },
      positions: {
        terms: { field: "chosen_position", size: 20 },
        aggs: {
          merchant_picks: { filter: { term: { chosen_is_merchant: true } } },
        },
      },
    },
  });
  const aggregations = response.aggregations as any;
  const shareByModel = (aggregations?.model?.buckets ?? []).flatMap((model: any) =>
    (model.variant?.buckets ?? []).map((variant: any) => {
      const runs = Number(variant.doc_count);
      const merchantPicks = Number(variant.merchant_picks?.doc_count ?? 0);
      return {
        model: String(model.key),
        variant: String(variant.key),
        runs,
        merchantPicks,
        share: runs ? merchantPicks / runs : 0,
      };
    }),
  );
  const positionBias = (aggregations?.positions?.buckets ?? []).map((position: any) => {
    const runs = Number(position.doc_count);
    const picks = Number(position.merchant_picks?.doc_count ?? 0);
    return {
      position: Number(position.key),
      runs,
      picks,
      share: runs ? picks / runs : 0,
    };
  });

  const runs = response.hits.hits.flatMap((hit) => hit._source ? [hit._source] : []);
  const modelBuckets = aggregations?.model?.buckets ?? [];
  const funnel = modelBuckets.flatMap((modelBucket: any) => {
    const model = String(modelBucket.key);
    const stageBuckets = modelBucket.furthest_stages?.buckets ?? [];
    return funnelStages.map((stage, stageIndex) => ({
      model,
      stage,
      count: stageBuckets.reduce((total: number, bucket: any) =>
        total + (funnelStages.indexOf(String(bucket.key) as typeof funnelStages[number]) >= stageIndex
          ? Number(bucket.doc_count)
          : 0),
      0),
    }));
  });
  const failures = runs
    .filter((run) => Boolean(run.failure_stage))
    .map((run) => ({
      runId: String(run.id ?? ""),
      model: String(run.model ?? ""),
      variant: String(run.variant ?? ""),
      stage: String(run.failure_stage),
      reason: String(run.failure_reason ?? ""),
      replayUrl: run.replay_view_url ? String(run.replay_view_url) : null,
    }));
  return {
    shareByModel,
    positionBias,
    funnel,
    failures,
    takeaway: buildTakeaway(shareByModel, failures),
  };
}
