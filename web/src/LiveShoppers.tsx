import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Item, Stagger, hoverCard } from "./motion";

export type LiveStep = { step: number; action: string; detail: string; ok: boolean; ts: string };
export type LiveRun = {
  runId: string;
  model: string;
  variant: string;
  rep: number;
  status: "queued" | "running" | "done" | "failed";
  liveViewUrl?: string;
  replayUrl?: string;
  furthestStage?: string;
  steps: LiveStep[];
};

const verbs: Record<string, string> = { click: "Clicked", type: "Typed", select: "Chose", back: "Went back", done: "Finished" };

export function useLiveRuns(id: string) {
  const [runs, setRuns] = useState<LiveRun[] | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch(`/api/experiments/${id}/live`);
        if (res.ok) {
          const body = (await res.json()) as { runs: LiveRun[] };
          if (!alive) return;
          setRuns(body.runs);
          if (body.runs.length && body.runs.every((r) => r.status === "done" || r.status === "failed")) return;
        }
      } catch { /* retry on next tick */ }
      if (alive) timer = setTimeout(tick, 2000);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [id]);

  return runs;
}

function Feed({ steps }: { steps: LiveStep[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" }); }, [steps.length]);
  if (steps.length === 0) return <div className="feed-empty meta">Waiting for the first move</div>;
  return (
    <ol className="feed" ref={ref}>
      {steps.map((s) => (
        <li key={s.step} className={s.ok ? "" : "bad"}>
          <span className="feed-n">{String(s.step).padStart(2, "0")}</span>
          <span><b>{verbs[s.action] ?? s.action}</b> {s.detail}</span>
        </li>
      ))}
    </ol>
  );
}

export function LiveShoppers({ id, runs: liveRuns }: { id: string; runs?: LiveRun[] | null }) {
  const polled = useLiveRuns(id);
  const runs = liveRuns ?? polled;

  if (!runs || runs.length === 0) return <div className="card empty">Shoppers appear here as soon as the fleet starts.</div>;

  return (
    <Stagger className="live-grid" inView={false}>
      <AnimatePresence initial={false}>
      {runs.map((r) => (
        <Item key={r.runId} className="card live" layout exit="hidden" {...hoverCard}>
          <div className="live-head">
            <div>
              <div className="product-title">{r.model}</div>
              <div className="meta">{r.variant} listing · run {r.rep}</div>
            </div>
            <span className={`tag status-${r.status}`}>{r.status === "running" ? "Live" : r.status}</span>
          </div>
          <div className="screen">
            {r.status === "running" && r.liveViewUrl ? (
              <iframe src={r.liveViewUrl} title={`${r.model} browser`} allow="autoplay; clipboard-read; clipboard-write" />
            ) : r.replayUrl ? (
              <a className="btn ghost" href={r.replayUrl} target="_blank" rel="noreferrer">Watch replay <span className="arrow">→</span></a>
            ) : (
              <span className="meta">{r.status === "queued" ? "Queued" : "No recording"}</span>
            )}
          </div>
          <Feed steps={r.steps} />
        </Item>
      ))}
      </AnimatePresence>
    </Stagger>
  );
}
