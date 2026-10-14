import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Analytics, Experiment, RunRow } from "./api";
import type { LiveRun } from "./LiveShoppers";
import { EASE } from "./motion";

type State = "done" | "running" | "waiting" | "failed";
export type NodeId = "listing" | "shelf" | "fleet" | "checkout" | "results";

const STAGES: [string, string][] = [
  ["shelf_viewed", "Saw the shelf"],
  ["offer_selected", "Picked an offer"],
  ["product_viewed", "Opened the product"],
  ["cart_created", "Created a Store Sync cart"],
  ["cart_updated", "Updated the cart"],
  ["approval_redirected", "Sent to PayPal"],
  ["approval_returned", "Approved in PayPal"],
  ["captured", "Sandbox order captured"],
];
const CHECKOUT_STAGES = ["cart_created", "approval_redirected", "approval_returned", "captured"];
const FINISHED = new Set(["done", "complete", "completed", "failed"]);
const PILL: Record<State, string> = { done: "Success", running: "Running", waiting: "Waiting", failed: "Failed" };
const BOARD_W = 1092;

const pct = (n: number) => `${Math.round(n * 100)}%`;
const money = (n: number) => `$${n.toFixed(2)}`;
const stageLabel = (key: string) => STAGES.find(([k]) => k === key)?.[1] ?? key.replaceAll("_", " ");

const ICONS: Record<NodeId, ReactNode> = {
  listing: <path d="M5 8h14l-1.2 11.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8L5 8Zm4 0V7a3 3 0 0 1 6 0v1" />,
  shelf: <path d="M4 6h16M4 12h16M4 18h16M8 6v-2M15 12v-2M11 18v-2" />,
  fleet: <path d="M12 4v3m-5 3h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Zm2.5 4h.01M14.5 14h.01" />,
  checkout: <path d="M3.5 7.5h17v10h-17zM3.5 11h17M7 15h3" />,
  results: <path d="M5 19V9m5 10V5m5 14v-7m5 7v-4M3 19h18" />,
};

function Icon({ id }: { id: NodeId }) {
  return (
    <span className="node-ico" aria-hidden>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[id]}</svg>
    </span>
  );
}

function Mark({ state }: { state: State }) {
  if (state === "done") return <svg className="mark done" width="14" height="14" viewBox="0 0 16 16" aria-label="Done"><path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (state === "failed") return <svg className="mark failed" width="14" height="14" viewBox="0 0 16 16" aria-label="Failed"><path d="m4.5 4.5 7 7m0-7-7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
  if (state === "running") return <span className="mark running" aria-label="Running" />;
  return <span className="mark waiting" aria-label="Waiting" />;
}

function Chip({ logo, children }: { logo?: string; children: ReactNode }) {
  return <span className="chip">{logo && <img src={logo} alt="" />}{children}</span>;
}

type Row = { key: string; label: ReactNode; value?: ReactNode; state: State };

function Rows({ rows }: { rows: Row[] }) {
  return (
    <ul className="node-rows">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="node-row-label">{r.label}</span>
          {r.value !== undefined && <span className="node-row-value">{r.value}</span>}
          <Mark state={r.state} />
        </li>
      ))}
    </ul>
  );
}

function Wire({ dir, state, area, delay }: { dir: "h" | "v"; state: State; area: string; delay: number }) {
  return (
    <div className={`wire ${dir} ${state}`} style={{ gridArea: area }} aria-hidden>
      <motion.i className="wire-line" initial={{ scaleX: dir === "h" ? 0 : 1, scaleY: dir === "v" ? 0 : 1 }} animate={{ scaleX: 1, scaleY: 1 }} transition={{ duration: 0.6, ease: EASE, delay }} />
      <motion.span className="wire-plus" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.3, ease: EASE, delay: delay + 0.35 }}>+</motion.span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={state} className={`pill ${state}`} initial={{ opacity: 0, y: 4, scale: 0.92 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.92 }} transition={{ duration: 0.25, ease: EASE }}>
          {PILL[state]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

function Node(props: { id: NodeId; title: string; sub: string; chips?: ReactNode; selected: boolean; onSelect: (id: NodeId) => void; index: number; children: ReactNode }) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onSelect(props.id); }
  };
  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-pressed={props.selected}
      aria-label={`${props.title} details`}
      className={`node${props.selected ? " on" : ""}`}
      style={{ gridArea: props.id }}
      onClick={() => props.onSelect(props.id)}
      onKeyDown={onKey}
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, ease: EASE, delay: props.index * 0.12 }}
      whileHover={{ y: -2 }}
    >
      <div className="node-head">
        <Icon id={props.id} />
        <div className="node-titles">
          <div className="node-title">{props.title}</div>
          <div className="node-sub">{props.sub}</div>
        </div>
        <span className="node-kebab" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="3.5" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="8" cy="12.5" r="1.3" /></svg>
        </span>
      </div>
      {props.chips && <div className="node-chips">{props.chips}</div>}
      <div className="node-body">{props.children}</div>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pfield">
      <div className="pfield-label">{label}</div>
      <div className="pfield-box">{children}</div>
    </div>
  );
}

export function FlowCanvas({ exp, stats, runs, checkoutExtra, live, initial }: { exp: Experiment; stats: Analytics; runs: RunRow[]; checkoutExtra?: ReactNode; live?: LiveRun[]; initial?: NodeId }) {
  const d = useMemo(() => {
    const models = new Map<string, { total: number; finished: number; failed: number }>();
    const variants = new Map<string, { total: number; finished: number }>();
    for (const r of runs) {
      const status = String(r.status ?? "");
      const m = models.get(String(r.model ?? "")) ?? { total: 0, finished: 0, failed: 0 };
      m.total++;
      if (FINISHED.has(status)) m.finished++;
      if (status === "failed") m.failed++;
      models.set(String(r.model ?? ""), m);
      const v = variants.get(String(r.variant ?? "")) ?? { total: 0, finished: 0 };
      v.total++;
      if (FINISHED.has(status)) v.finished++;
      variants.set(String(r.variant ?? ""), v);
    }
    const finished = runs.filter((r) => FINISHED.has(String(r.status ?? ""))).length;
    const stage = (key: string) => stats.funnel.filter((f) => f.stage === key).reduce((s, f) => s + f.count, 0);
    const total = stats.shareByModel.reduce((s, r) => s + r.runs, 0);
    const picks = stats.shareByModel.reduce((s, r) => s + r.merchantPicks, 0);
    const first = stats.positionBias.find((p) => p.position === 1);
    return { models, variants, finished, stage, total, picks, first, captured: stage("captured") };
  }, [runs, stats]);

  const complete = exp.status === "complete";
  const shelfState: State = exp.competitors.length ? "done" : exp.status === "failed" ? "failed" : "running";
  const fleetState: State = !exp.competitors.length
    ? "waiting"
    : runs.length && d.finished === runs.length
      ? (runs.every((r) => r.status === "failed") ? "failed" : "done")
      : "running";
  const checkoutState: State = d.finished === 0
    ? (fleetState === "running" ? "running" : "waiting")
    : fleetState === "running" ? "running" : d.captured > 0 ? "done" : "failed";
  const resultsState: State = complete ? "done" : d.finished > 0 ? "running" : "waiting";

  const states: Record<NodeId, State> = { listing: "done", shelf: shelfState, fleet: fleetState, checkout: checkoutState, results: resultsState };
  const [selected, setSelected] = useState<NodeId | null>(initial ?? null);
  const active: NodeId | null = selected;

  const runningLive = useMemo(() => (live ?? []).filter((r) => r.status === "running"), [live]);
  const liveBrowsers = useMemo(() => runningLive.filter((r) => r.liveViewUrl), [runningLive]);
  const replays = useMemo(() => (live ?? []).filter((r) => r.status !== "running" && r.replayUrl), [live]);
  const providerFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of exp.models ?? []) if (m.provider) map.set(m.id, m.provider);
    for (const r of runs) {
      const model = String(r.model ?? "");
      const provider = String(r.provider ?? "");
      if (model && provider && !map.has(model)) map.set(model, provider);
    }
    return (model: string) => map.get(model);
  }, [exp.models, runs]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const [zoomStep, setZoomStep] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setFit(Math.min(1, (entry.contentRect.width - 56) / BOARD_W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const zoom = Math.max(0.4, Math.min(1.5, fit + zoomStep * 0.1));

  const topBreak = stats.takeaway.topBreak?.stage;
  const product = exp.merchant_product;
  const modelRows: Row[] = [...d.models].map(([model, m]) => {
    const provider = providerFor(model);
    return {
      key: model,
      label: <>{model}{provider && <span className="meta"> · {provider}</span>}</>,
      value: `${m.finished}/${m.total}`,
      state: (m.finished < m.total ? "running" : m.failed === m.total ? "failed" : "done") as State,
    };
  });
  const checkoutRows: Row[] = CHECKOUT_STAGES.map((key) => {
    const count = d.stage(key);
    return {
      key,
      label: stageLabel(key),
      value: runs.length ? count : undefined,
      state: key === topBreak && checkoutState !== "running" ? "failed" : count > 0 ? "done" : d.finished > 0 && fleetState !== "running" ? "failed" : "waiting",
    };
  });
  const variantRows: Row[] = d.variants.size
    ? [...d.variants].map(([v, s]) => ({ key: v, label: `${v[0]?.toUpperCase()}${v.slice(1)} listing`, value: `${s.total} runs`, state: s.finished === s.total ? "done" : "running" }))
    : [{ key: "original", label: "Original listing", state: "waiting" }];

  const steps: [string, State][] = [["Setup", "done"], ["Run", fleetState], ["Results", resultsState]];

  return (
    <section className={`flow${active ? " has-panel" : ""}`} aria-label="Experiment flow">
      <div className="canvas" ref={wrapRef}>
        <div className="canvas-tools">
          <button type="button" className="tool" aria-label="Fit to screen" title="Fit to screen" onClick={() => setZoomStep(0)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg>
          </button>
          <div className="tool-group">
            <button type="button" className="tool" aria-label="Zoom out" onClick={() => setZoomStep((z) => z - 1)}>−</button>
            <span className="tool-zoom" aria-live="polite">{Math.round(zoom * 100)}%</span>
            <button type="button" className="tool" aria-label="Zoom in" onClick={() => setZoomStep((z) => z + 1)}>+</button>
          </div>
        </div>

        <div className="board" style={{ ["--z" as string]: zoom }}>
          <Node id="listing" index={0} title="Your listing" sub="Published through your Store Sync cart" selected={active === "listing"} onSelect={setSelected}
            chips={<><Chip logo="/logos/paypal.png">Store Sync</Chip>{product && <Chip>{money(product.price)}</Chip>}</>}>
            <div className="node-panel">
              <div className="node-panel-title">{product?.title ?? "Merchant product"}</div>
              <div className="node-panel-sub">Shopper intent: {exp.query}</div>
              <Rows rows={variantRows} />
            </div>
          </Node>
          <Wire dir="h" area="w1" state={shelfState} delay={0.25} />

          <Node id="shelf" index={1} title="Competitor shelf" sub={exp.competitors.length ? `${exp.competitors.length} real offers next to yours` : "Finding real competing offers"} selected={active === "shelf"} onSelect={setSelected}
            chips={<Chip logo="/logos/channel3.png">Channel3</Chip>}>
            <div className="node-panel">
              <div className="node-panel-title">On the shelf</div>
              <Rows rows={exp.competitors.slice(0, 3).map((c) => ({ key: c.id, label: c.title, value: money(c.price), state: "done" as State }))} />
              {exp.competitors.length > 3 && <div className="node-more">+{exp.competitors.length - 3} more offers</div>}
              {!exp.competitors.length && <div className="node-more">No offers yet</div>}
            </div>
          </Node>
          <Wire dir="h" area="w2" state={fleetState} delay={0.4} />

          <Node id="fleet" index={2} title="Shopper fleet" sub={`${d.models.size || "No"} models shopping in live browsers`} selected={active === "fleet"} onSelect={setSelected}
            chips={<><Chip logo="/logos/render.svg">Workflows</Chip><Chip logo="/logos/kernel.svg">KERNEL</Chip></>}>
            <div className="node-panel">
              <div className="node-panel-title">Runs by model</div>
              {modelRows.length ? <Rows rows={modelRows} /> : <div className="node-more">The fleet starts once the shelf is ready</div>}
              {runningLive.length > 0 && (
                <ul className="node-rows">
                  <li>
                    <span className="node-row-label"><span className="live-dot" aria-hidden />Live browsers</span>
                    <span className="node-row-value">{runningLive.length}</span>
                    <Mark state="running" />
                  </li>
                </ul>
              )}
            </div>
          </Node>
          <Wire dir="v" area="w3" state={checkoutState} delay={0.55} />

          <Node id="checkout" index={3} title="PayPal checkout" sub="Store Sync cart to sandbox order" selected={active === "checkout"} onSelect={setSelected}
            chips={<><Chip logo="/logos/paypal.png">Orders v2</Chip>{runs.length > 0 && <Chip>{d.captured}/{runs.length} captured</Chip>}</>}>
            <div className="node-panel">
              <div className="node-panel-title">Checkout funnel</div>
              <Rows rows={checkoutRows} />
            </div>
          </Node>
          <Wire dir="h" area="w4" state={resultsState} delay={0.7} />

          <Node id="results" index={4} title="Results" sub="Selection share and what to fix" selected={active === "results"} onSelect={setSelected}
            chips={<Chip logo="/logos/aggrid.svg">AG Studio</Chip>}>
            <div className={`node-info${stats.takeaway.headline ? "" : " muted"}`}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><circle cx="8" cy="8" r="6.2" /><path d="M8 7.2v4M8 4.8v.01" strokeLinecap="round" /></svg>
              <span>{stats.takeaway.headline ?? "Your takeaway appears as soon as the first agents finish."}</span>
            </div>
            <div className="node-panel">
              <Rows rows={[
                { key: "runs", label: "Runs finished", value: d.total, state: d.total ? "done" : "waiting" },
                { key: "picks", label: "Picked your product", value: d.total ? pct(d.picks / d.total) : "0%", state: d.total ? "done" : "waiting" },
                { key: "first", label: "Took the first offer", value: d.first ? pct(d.first.share) : "0%", state: d.first ? "done" : "waiting" },
                { key: "captured", label: "Sandbox orders captured", value: d.captured, state: d.captured ? "done" : "waiting" },
              ]} />
            </div>
          </Node>
        </div>
      </div>

      <AnimatePresence>
        {active && (
          <motion.aside
            key="panel"
            className="side"
            aria-label={`${active} details`}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <div className="side-head">
              <Icon id={active} />
              <div className="side-title">{{ listing: "Your listing", shelf: "Competitor shelf", fleet: "Shopper fleet", checkout: "PayPal checkout", results: "Results" }[active]}</div>
              <button type="button" className="tool" aria-label="Close details" onClick={() => setSelected(null)}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="m4 4 8 8m0-8-8 8" /></svg>
              </button>
            </div>
            <ol className="side-steps">
              {steps.map(([label, s], i) => (
                <li key={label} className={s}>
                  {i > 0 && <span className="side-chev" aria-hidden>›</span>}
                  {label}
                  <Mark state={s} />
                </li>
              ))}
            </ol>
            <div className="side-body">
              {active === "listing" && (
                <>
                  <Field label="Product">{product ? <a href={product.url} target="_blank" rel="noreferrer">{product.title}</a> : "Merchant product"}</Field>
                  {product?.brand && <Field label="Brand">{product.brand}</Field>}
                  {product && <Field label="Price">{money(product.price)}</Field>}
                  <Field label="Shopper intent">{exp.query}</Field>
                  <Field label="Listings tested"><div className="pchips">{variantRows.map((v) => <Chip key={v.key}>{v.label}</Chip>)}</div></Field>
                </>
              )}
              {active === "shelf" && (
                <Field label={`Offers (${exp.competitors.length})`}>
                  <ul className="plist">
                    {exp.competitors.map((c) => (
                      <li key={c.id}><a href={c.url} target="_blank" rel="noreferrer">{c.title}</a><span>{money(c.price)} · {c.domain}</span></li>
                    ))}
                    {!exp.competitors.length && <li><span>No offers yet</span></li>}
                  </ul>
                </Field>
              )}
              {active === "fleet" && (
                <>
                  <Field label="Runs per model and listing">{exp.reps}</Field>
                  <Field label="Progress">{exp.run_counts ? `${exp.run_counts.done} of ${exp.run_counts.total} runs finished` : `${d.finished} of ${runs.length} runs finished`}</Field>
                  <Field label="Models">{modelRows.length ? <Rows rows={modelRows} /> : "Not started"}</Field>
                  <Field label={`Live browsers${liveBrowsers.length ? ` (${liveBrowsers.length})` : ""}`}>
                    {liveBrowsers.length ? (
                      <div className="live-canvas">
                        {liveBrowsers.map((r) => (
                          <figure key={r.runId} className="live-card">
                            <div className="live-screen">
                              <iframe src={r.liveViewUrl} allow="autoplay; clipboard-read; clipboard-write" title={`${r.model} live browser`} />
                            </div>
                            <figcaption>
                              <span className="live-cap"><span className="live-dot" aria-hidden />{r.model} · {r.variant} · run {r.rep}</span>
                              {r.steps.length > 0 && <span className="meta">{r.steps[r.steps.length - 1].detail}</span>}
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    ) : (
                      <>
                        <div className="meta">No browsers running right now. Live views appear here while shoppers run.</div>
                        {replays.length > 0 && (
                          <ul className="plist">
                            {replays.slice(0, 5).map((r) => (
                              <li key={r.runId}>
                                <a href={r.replayUrl} target="_blank" rel="noreferrer">Watch replay</a>
                                <span>{r.model} · {r.variant} · run {r.rep}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </Field>
                </>
              )}
              {active === "checkout" && (
                <>
                  <Field label="Funnel, all models">
                    <Rows rows={STAGES.map(([key, label]) => ({ key, label, value: runs.length ? d.stage(key) : undefined, state: (key === topBreak ? "failed" : d.stage(key) > 0 ? "done" : "waiting") as State }))} />
                  </Field>
                  {checkoutExtra}
                  {stats.failures.length > 0 && (
                    <Field label={`Where checkout broke (${stats.failures.length})`}>
                      <ul className="plist">
                        {stats.failures.slice(0, 8).map((f) => (
                          <li key={f.runId}>
                            <b>{f.model} · {stageLabel(f.stage)}</b>
                            <span>{f.reason}</span>
                            {f.replayUrl && <a href={f.replayUrl} target="_blank" rel="noreferrer">Watch replay</a>}
                          </li>
                        ))}
                      </ul>
                    </Field>
                  )}
                </>
              )}
              {active === "results" && (
                <>
                  <Field label="Takeaway">{stats.takeaway.headline ?? "Appears as soon as the first agents finish."}</Field>
                  <Field label="Share of picks by model">
                    {stats.shareByModel.length
                      ? <Rows rows={stats.shareByModel.map((s) => ({ key: `${s.model}-${s.variant}`, label: `${s.model} · ${s.variant}`, value: pct(s.share), state: "done" as State }))} />
                      : "No finished runs yet"}
                  </Field>
                  <a className="side-link" href="#report">Open the full report</a>
                </>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </section>
  );
}
