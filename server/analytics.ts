import type { Db } from "./db.js";
import { findDocs, RUNS_TABLE } from "./db.js";

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
    return runs
      ? rows.reduce((total, row) => total + row.merchantPicks, 0) / runs
      : null;
  };
  const originalShare = overallFor("original");
  const fixedShare = overallFor("fixed");
  const overall = originalShare !== null && fixedShare !== null
    ? { originalShare, fixedShare }
    : null;

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

  return { headline, bestFix, topBreak, overall };
}

export async function getExperimentAnalytics(db: Db, experimentId: string) {
  const runs = await findDocs<Record<string, any>>(db, RUNS_TABLE, {
    where: { experiment_id: experimentId },
    orderBy: "created_at",
  });
  const models = groupTerms(runs, (run) => stringTerm(run.model)).slice(0, 50);
  const shareByModel = models.flatMap(({ key: model, docs: modelRuns }) =>
    groupTerms(modelRuns, (run) => stringTerm(run.variant))
      .slice(0, 5)
      .map(({ key: variant, docs: variantRuns }) => {
        const merchantPicks = variantRuns.filter((run) => run.chosen_is_merchant === true).length;
        return {
          model,
          variant,
          runs: variantRuns.length,
          merchantPicks,
          share: variantRuns.length ? merchantPicks / variantRuns.length : 0,
        };
      }),
  );
  const positionBias = groupTerms(
    runs.filter((run) => run.chosen_position !== undefined && run.chosen_position !== null),
    (run) => numberTerm(run.chosen_position),
  )
    .slice(0, 20)
    .map(({ key: position, docs }) => {
      const picks = docs.filter((run) => run.chosen_is_merchant === true).length;
      return {
        position,
        runs: docs.length,
        picks,
        share: docs.length ? picks / docs.length : 0,
      };
    });

  const funnel = models.flatMap(({ key: model, docs: modelRuns }) => {
    const stageBuckets = groupTerms(modelRuns, (run) => stringTerm(run.furthest_stage))
      .slice(0, funnelStages.length);
    return funnelStages.map((stage, stageIndex) => ({
      model,
      stage,
      count: stageBuckets.reduce((total, bucket) =>
        total + (funnelStages.indexOf(bucket.key as typeof funnelStages[number]) >= stageIndex
          ? bucket.docs.length
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

function groupTerms<T, K extends string | number>(
  docs: T[],
  keyFor: (doc: T) => K | undefined,
): { key: K; docs: T[] }[] {
  const groups = new Map<K, T[]>();
  for (const doc of docs) {
    const key = keyFor(doc);
    if (key === undefined) continue;
    const values = groups.get(key) ?? [];
    values.push(doc);
    groups.set(key, values);
  }
  return [...groups.entries()]
    .map(([key, values]) => ({ key, docs: values }))
    .sort((left, right) =>
      right.docs.length - left.docs.length ||
      (typeof left.key === "number" && typeof right.key === "number"
        ? left.key - right.key
        : String(left.key).localeCompare(String(right.key))),
    );
}

function stringTerm(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberTerm(value: unknown) {
  const number = Number(value);
  return value !== undefined && value !== null && Number.isFinite(number)
    ? number
    : undefined;
}
