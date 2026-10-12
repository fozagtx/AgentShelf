import { randomUUID } from "node:crypto";
import type { Product } from "./products.js";

export interface ShelfEntry {
  type: "merchant" | "competitor";
  productId?: string;
  competitorIndex?: number;
}

export function shuffleShelf(
  product: Product | Record<string, any>,
  competitors: Array<Record<string, any>>,
  runId: string,
): ShelfEntry[] {
  const entries: ShelfEntry[] = [
    { type: "merchant", productId: String(product.id) },
    ...competitors.map((_, competitorIndex) => ({
      type: "competitor" as const,
      competitorIndex,
    })),
  ];
  let seed = hash(runId);
  for (let index = entries.length - 1; index > 0; index -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const swapIndex = seed % (index + 1);
    [entries[index], entries[swapIndex]] = [entries[swapIndex], entries[index]];
  }
  return entries;
}

export function buildRunSpecs(
  experiment: { id: string; query: string; reps?: number; competitors?: Array<Record<string, any>> },
  product: Product | Record<string, any>,
  models: ReadonlyArray<string>,
  reps: number,
) {
  const variants: Array<"original" | "fixed"> = product.fixed_variant
    ? ["original", "fixed"]
    : ["original"];
  const runs = [];
  for (const model of models) {
    for (const variant of variants) {
      for (let rep = 1; rep <= reps; rep += 1) {
        const id = randomUUID();
        runs.push({
          id,
          experimentId: experiment.id,
          productId: String(product.id),
          query: experiment.query,
          model,
          provider: "Astropods",
          variant,
          rep,
          competitors: experiment.competitors ?? [],
          shelfOrder: shuffleShelf(product, experiment.competitors ?? [], id),
        });
      }
    }
  }
  return runs;
}

function hash(value: string) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619) >>> 0;
  }
  return result >>> 0;
}
