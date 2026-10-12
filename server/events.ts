import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import { EVENTS_TABLE, getDoc, putDoc, RUNS_TABLE } from "./db.js";

export type EventStage = string;

export interface ShelfEvent {
  experimentId?: string;
  runId: string;
  stage: EventStage;
  ok: boolean;
  error?: string;
  position?: number;
  is_merchant?: boolean;
  [key: string]: unknown;
}

export async function writeEvent(db: Db, event: ShelfEvent) {
  const run = await getDoc<Record<string, unknown>>(
    db,
    RUNS_TABLE,
    event.runId,
  );
  const document = {
    ...event,
    experimentId: event.experimentId ?? String(run?.experiment_id ?? ""),
    model: run?.model,
    variant: run?.variant,
    id: randomUUID(),
    ts: new Date().toISOString(),
  };
  await putDoc(db, EVENTS_TABLE, document.id, document);
  return document;
}
