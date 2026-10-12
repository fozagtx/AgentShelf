import { randomUUID } from "node:crypto";
import type { Client } from "@elastic/elasticsearch";
import { EVENTS_INDEX, getDocument, RUNS_INDEX } from "./elastic.js";

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

export async function writeEvent(client: Client, event: ShelfEvent) {
  const run = await getDocument<Record<string, unknown>>(
    client,
    RUNS_INDEX,
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
  await client.index({
    index: EVENTS_INDEX,
    id: document.id,
    document,
    refresh: "wait_for",
  });
  return document;
}
