import { useEffect, useMemo, useState } from "react";
import { AllCommunityModule, themeQuartz, type ColDef } from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { directLlmRunner, createAiHarness, studioTheme, type AgReportState } from "ag-studio";
import { api, type Analytics, type Experiment, type RunRow } from "./api";
import { LiveShoppers } from "./LiveShoppers";
import { AsciiImage } from "./Ascii";
import { Item, hoverCard } from "./motion";
import { createGatewayAdapter } from "./studio/adapter";
import { agentShelfWidgetState, createAgentShelfWidgets } from "./studio/widgets";

const LICENSE = import.meta.env.VITE_AG_STUDIO_LICENSE_KEY ?? "";
const AGENT_MODELS = ["claude-sonnet-4-6", "gpt-5-6-terra", "nova-pro", "mistral-large-3"];
const fonts = { fontFamily: "Mona Sans Variable, system-ui, sans-serif" };
const palette = {
  accentColor: "#E1261C",
  backgroundColor: "#FFFFFF",
  foregroundColor: "#141414",
  borderColor: "#ECECEC",
  ...fonts,
};
const gridTheme = themeQuartz.withParams({ ...palette, headerBackgroundColor: "#FAFAFA", rowHoverColor: "#FCFCFC", wrapperBorderRadius: 14 });
const reportTheme = studioTheme.withParams({
  ...palette,
  studioCanvasBackgroundColor: "#FAFAFA",
  studioWrapperSpacing: 12,
  studioWidgetTitleTextColor: "#141414",
  gridCellTextColor: "#141414",
  chartAxisLineColor: "#ECECEC",
});

const pct = (n: number) => `${Math.round(n * 100)}%`;

function report(): AgReportState {
  const customWidgets = agentShelfWidgetState();
  const chart = (id: string, text: string, category: string, value: string, legend?: string) => ({
    type: "column-chart-grouped" as const,
    dataMapping: {
      categoryKey: [{ id: category }],
      valueKey: [{ id: value, aggregation: "avg" as const }],
      ...(legend ? { legendKey: [{ id: legend }] } : {}),
    },
    format: { title: { enabled: true, text } },
  });
  return {
    pages: [
      {
        id: "shelf",
        widgets: {
          takeaway: {
            ...customWidgets.takeaway,
            format: { title: { enabled: true, text: "Merchant takeaway" } },
          },
          modelScoreboard: {
            ...customWidgets.modelScoreboard,
            format: { title: { enabled: true, text: "Model scoreboard" } },
          },
          checkoutFunnel: {
            ...customWidgets.checkoutFunnel,
            format: { title: { enabled: true, text: "Checkout funnel" } },
          },
          share: chart("share", "Selection share by model", "share.model", "share.share", "share.variant"),
          position: chart("position", "Picks by shelf position", "position.position", "position.share"),
          funnel: { ...chart("funnel", "Checkout funnel", "funnel.stage", "funnel.count", "funnel.model"), dataMapping: { categoryKey: [{ id: "funnel.stage" }], valueKey: [{ id: "funnel.count", aggregation: "sum" as const }], legendKey: [{ id: "funnel.model" }] } },
        },
        widgetLayout: {
          takeaway: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 12 },
          modelScoreboard: { xTrack: 0, yTrack: 12, xSpan: 14, ySpan: 26 },
          checkoutFunnel: { xTrack: 14, yTrack: 12, xSpan: 10, ySpan: 26 },
          share: { xTrack: 0, yTrack: 38, xSpan: 14, ySpan: 26 },
          position: { xTrack: 14, yTrack: 38, xSpan: 10, ySpan: 26 },
          funnel: { xTrack: 0, yTrack: 64, xSpan: 24, ySpan: 26 },
        },
      },
    ],
    selectedPageId: "shelf",
  } as AgReportState;
}

export function ExperimentView({ id }: { id: string }) {
  const [exp, setExp] = useState<Experiment | null>(null);
  const [stats, setStats] = useState<Analytics | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([api.experiment(id), api.analytics(id), api.runs(id)])
        .then(([e, a, r]) => { if (!alive) return; setExp(e); setStats(a); setRuns(r); return e; })
        .catch((e) => alive && setError(e.message));
    load();
    const t = setInterval(() => { if (exp?.status !== "complete") load(); }, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [id, exp?.status]);

  const data = useMemo(() => stats && ({
    sources: [
      { id: "share", data: stats.shareByModel },
      { id: "position", data: stats.positionBias },
      { id: "funnel", data: stats.funnel },
      {
        id: "takeaway",
        data: [{
          headline: stats.takeaway.headline,
          model: stats.takeaway.bestFix?.model ?? null,
          originalShare: stats.takeaway.bestFix?.originalShare ?? null,
          fixedShare: stats.takeaway.bestFix?.fixedShare ?? null,
          delta: stats.takeaway.bestFix?.delta ?? null,
          topBreakStage: stats.takeaway.topBreak?.stage ?? null,
          topBreakCount: stats.takeaway.topBreak?.count ?? null,
        }],
      },
    ],
  }), [stats]);
  const initialState = useMemo(report, []);
  const widgets = useMemo(() => (base: any) => createAgentShelfWidgets(base), []);
  const ai = useMemo(() => ({ api: studioApi }: any) => {
    const adapter = createGatewayAdapter();
    return createAiHarness(studioApi, ({ builtIn }: any) => {
      const builtIns = Object.entries(builtIn).map(([agentId, definition]: [string, any]) => {
        if (agentId !== "lead") return directLlmRunner({ ...definition, adapter });
        return directLlmRunner({
          ...definition,
          adapter,
          tools: (context: any, params: any) => [
            ...(definition.tools?.(context, params) ?? []).filter(
              (tool: { name: string }) => !tool.name.toLowerCase().includes("delegate"),
            ),
            context.tools.delegateTo(["planning", "data", "page", "widget", "shelf-analyst"]),
          ],
        });
      });
      const analyst = directLlmRunner({
        id: "shelf-analyst",
        name: "AgentShelf analyst",
        description: "Explains why AI shoppers picked or skipped the merchant's product.",
        adapter,
        instructions: () => "Explain why AI shoppers picked or skipped the merchant's product using only experiment results available in Studio. Do not invent findings.",
      });
      return {
        agents: [...builtIns, analyst],
        primary: "lead",
        models: AGENT_MODELS.map((model) => ({ id: model, label: model })),
      };
    });
  }, []);

  const cols = useMemo<ColDef[]>(() => [
    { field: "model", filter: true, flex: 1.2 },
    { field: "variant", filter: true, width: 110 },
    { field: "chosen_title", headerName: "Picked", flex: 2 },
    { field: "chosen_position", headerName: "Position", width: 110 },
    { field: "chosen_is_merchant", headerName: "Ours", width: 90, cellRenderer: (p: { value: boolean }) => (p.value ? "Yes" : "No") },
    { field: "furthest_stage", headerName: "Reached", flex: 1 },
    { field: "failure_stage", headerName: "Broke at", flex: 1, cellStyle: { color: "#B4170F" } },
    { field: "replay_view_url", headerName: "Replay", width: 110, cellRenderer: (p: { value?: string }) => (p.value ? <a href={p.value} target="_blank" rel="noreferrer">Watch</a> : "") },
  ], []);

  if (error) return <div className="notice">{error}</div>;
  if (!exp || !stats) return <div className="empty">Loading</div>;

  const total = stats.shareByModel.reduce((s, r) => s + r.runs, 0);
  const picks = stats.shareByModel.reduce((s, r) => s + r.merchantPicks, 0);
  const first = stats.positionBias.find((p) => p.position === 1);
  const captured = stats.funnel.filter((f) => f.stage === "captured").reduce((s, f) => s + f.count, 0);

  return (
    <div className="enter">
      <div className="eyebrow">{exp.status}{exp.run_counts ? ` · ${exp.run_counts.done}/${exp.run_counts.total} runs` : ""}</div>
      <h1 className="display" style={{ maxWidth: "20ch" }}>{exp.query}</h1>
      <div style={{ height: 20 }} />
      <Item className="card takeaway" initial="hidden" animate="show">
        <div className="eyebrow">What this means for you</div>
        <p className="takeaway-text">{stats.takeaway.headline ?? "Your takeaway appears as soon as the first agents finish."}</p>
      </Item>
      <div className="gap-xl" />

      <div className="grid4">
        <div className="card kpi"><div className="kpi-label">Runs</div><div className="kpi-value">{total}</div></div>
        <div className="card kpi"><div className="kpi-label">Picked your product</div><div className="kpi-value red">{total ? pct(picks / total) : "0%"}</div></div>
        <div className="card kpi"><div className="kpi-label">Took the first offer</div><div className="kpi-value">{first ? pct(first.share) : "0%"}</div></div>
        <div className="card kpi"><div className="kpi-label">Sandbox orders captured</div><div className="kpi-value">{captured}</div></div>
      </div>

      <div className="gap-xl" />
      <h2 className="section">Shoppers right now</h2>
      <div style={{ height: 16 }} />
      <LiveShoppers id={id} />

      <div className="gap-xl" />
      <div className="card studio">
        {data && (
          <AgStudioProvider licenseKey={LICENSE}>
            <AgStudio data={data} initialState={initialState} widgets={widgets} ai={ai} mode="view" theme={reportTheme} style={{ height: "100%", width: "100%" }} />
          </AgStudioProvider>
        )}
      </div>

      <div className="gap-xl" />
      <h2 className="section">Runs</h2>
      <div style={{ height: 16 }} />
      <div className="gridbox">
        <AgGridProvider modules={[AllCommunityModule]}>
          <AgGridReact rowData={runs} columnDefs={cols} theme={gridTheme} />
        </AgGridProvider>
      </div>

      <div className="gap-xl" />
      <h2 className="section">The shelf</h2>
      <div style={{ height: 16 }} />
      <div className="grid3">
        {exp.competitors.map((c, i) => (
          <a key={c.id} href={c.url} target="_blank" rel="noreferrer" className="card product">
            <div className="product-img">{c.image_url && <AsciiImage src={`/api/img/competitor/${id}/${i}`} alt={c.title} />}</div>
            <div className="product-body">
              <div className="product-title">{c.title}</div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="price">${c.price.toFixed(2)}</span>
                <span className="meta">{c.domain}</span>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
