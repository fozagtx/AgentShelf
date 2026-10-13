import { useEffect, useMemo, useRef, useState } from "react";
import { AllCommunityModule, themeQuartz, type ColDef } from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { directLlmRunner, createAiHarness, studioTheme, type AgReportState } from "ag-studio";
import { api, type Analytics, type Experiment, type RunRow } from "./api";
import { LiveShoppers } from "./LiveShoppers";
import { AsciiImage } from "./Ascii";
import { Item, hoverCard } from "./motion";
import { createGatewayAdapter } from "./studio/adapter";
import { buildStudioData } from "./studio/data";
import { createDefaultReportState } from "./studio/report";
import { createAgentShelfWidgets } from "./studio/widgets";

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

export function ExperimentView({ id }: { id: string }) {
  const [exp, setExp] = useState<Experiment | null>(null);
  const [stats, setStats] = useState<Analytics | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [error, setError] = useState("");
  const [runSearch, setRunSearch] = useState("");
  const [reportMode, setReportMode] = useState<"view" | "edit">("view");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const shelfRowsRef = useRef<Record<string, string | number | boolean | null>[]>([]);
  const studioRef = useRef<AgStudio>(null);
  const gridRef = useRef<AgGridReact<RunRow>>(null);

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

  const data = useMemo(
    () => exp && stats ? buildStudioData(exp, runs, stats) : null,
    [exp, runs, stats],
  );
  const shelfSource = data?.sources.find((source) => source.id === "shelf");
  if (shelfSource && "data" in shelfSource) {
    shelfRowsRef.current = shelfSource.data as Record<string, string | number | boolean | null>[];
  }
  const defaultState = useMemo(createDefaultReportState, []);
  const initialState = useMemo(() => {
    const saved = exp?.report_state;
    return saved && typeof saved === "object" && !Array.isArray(saved)
      ? saved as AgReportState
      : defaultState;
  }, [exp?.id, defaultState]);
  const hasSavedReport = Boolean(
    exp?.report_state && typeof exp.report_state === "object" && !Array.isArray(exp.report_state),
  );
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
        instructions: () => "Explain why AI shoppers picked or skipped the merchant's product using only viewSchema, executeQuery, list_checkout_failures, and describe_shelf. Cite numbers from tool results. Never invent findings.",
        tools: (context: any) => [
          context.tools.studio.viewSchema(),
          context.tools.studio.executeQuery(),
          studioApi.defineAiTool({
            name: "list_checkout_failures",
            description: "List checkout failures from the current experiment, optionally filtered by model or variant.",
            params: (s: any) => s.object({
              model: s.string({ description: "Filter to one model." }).optional(),
              variant: s.string({ description: "Filter to one variant." }).optional(),
            }),
            execute: async ({ model, variant }: { model?: string; variant?: string }, ctx: any) => {
              const failures = runsRef.current
                .filter((run) =>
                  (!model || run.model === model) &&
                  (!variant || run.variant === variant) &&
                  Boolean(run.failure_stage || run.failure_reason),
                )
                .map((run) => ({
                  broke_at: typeof run.failure_stage === "string" ? run.failure_stage : null,
                  failure_reason: typeof run.failure_reason === "string" ? run.failure_reason : null,
                  model: String(run.model ?? ""),
                  variant: String(run.variant ?? ""),
                  replay_url: typeof run.replay_view_url === "string" ? run.replay_view_url : null,
                }));
              return ctx.success(JSON.stringify(failures), { failures });
            },
          }),
          studioApi.defineAiTool({
            name: "describe_shelf",
            description: "Describe shelf offers and their picks in the current experiment.",
            params: (s: any) => s.object({}),
            execute: async (_args: Record<string, never>, ctx: any) => {
              const offers = shelfRowsRef.current.map((row) => ({
                title: row.title,
                brand: row.brand,
                price: row.price,
                domain: row.domain,
                is_ours: row.is_ours,
                picks: row.picks,
                share: row.share,
              }));
              return ctx.success(JSON.stringify(offers), { offers });
            },
          }),
        ],
      });
      return {
        agents: [...builtIns, analyst],
        primary: "lead",
        models: AGENT_MODELS.map((model) => ({ id: model, label: model })),
      };
    });
  }, []);

  const cols = useMemo<ColDef[]>(() => [
    { field: "model", filter: true, flex: 1.2, pinned: "left" },
    { field: "variant", filter: true, width: 110 },
    {
      field: "status",
      width: 90,
      cellRenderer: (p: { value?: string }) => {
        const status = String(p.value ?? "");
        const color = status === "failed"
          ? "#E1261C"
          : ["done", "complete", "completed"].includes(status)
            ? "#141414"
            : "#A3A3A3";
        return <span title={status} aria-label={status} style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color }} />;
      },
    },
    { field: "chosen_title", headerName: "Picked", flex: 2 },
    { field: "chosen_position", headerName: "Position", width: 110 },
    { field: "chosen_is_merchant", headerName: "Ours", width: 90, cellRenderer: (p: { value: boolean }) => (p.value ? "Yes" : "No") },
    { field: "furthest_stage", headerName: "Reached", flex: 1 },
    { field: "failure_stage", headerName: "Broke at", flex: 1, cellStyle: { color: "#B4170F" } },
    { field: "replay_view_url", headerName: "Replay", width: 110, cellRenderer: (p: { value?: string }) => (p.value ? <a href={p.value} target="_blank" rel="noreferrer">Watch</a> : "") },
  ], []);

  const saveReport = async () => {
    const state = studioRef.current?.api.getState();
    if (!state) return;
    setReportBusy(true);
    setReportError("");
    try {
      await api.saveReport(id, state);
      setExp((current) => current ? { ...current, report_state: state } : current);
      setReportMode("view");
    } catch (saveError) {
      setReportError(saveError instanceof Error ? saveError.message : "Unable to save report.");
    } finally {
      setReportBusy(false);
    }
  };

  const resetReport = async () => {
    setReportBusy(true);
    setReportError("");
    try {
      await api.saveReport(id, null);
      studioRef.current?.api.setState(defaultState);
      setExp((current) => current ? { ...current, report_state: null } : current);
      setReportMode("view");
    } catch (saveError) {
      setReportError(saveError instanceof Error ? saveError.message : "Unable to reset report.");
    } finally {
      setReportBusy(false);
    }
  };

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, marginBottom: 12 }}>
        {reportError && <span role="alert" style={{ color: "#B4170F", fontSize: 13 }}>{reportError}</span>}
        {hasSavedReport && (
          <button
            type="button"
            disabled={reportBusy}
            onClick={() => void resetReport()}
            style={{ border: "1px solid #ECECEC", background: "#FFFFFF", color: "#141414", borderRadius: 999, padding: "8px 14px", font: "inherit", cursor: "pointer" }}
          >
            Reset layout
          </button>
        )}
        <button
          type="button"
          disabled={reportBusy}
          onClick={() => reportMode === "edit" ? void saveReport() : setReportMode("edit")}
          style={{ border: "1px solid #141414", background: "#141414", color: "#FFFFFF", borderRadius: 999, padding: "8px 14px", font: "inherit", cursor: "pointer" }}
        >
          {reportMode === "edit" ? "Done" : "Edit report"}
        </button>
      </div>
      <div className="card studio">
        {data && (
          <AgStudioProvider licenseKey={LICENSE}>
            <AgStudio ref={studioRef} data={data} initialState={initialState} widgets={widgets} ai={ai} mode={reportMode} theme={reportTheme} style={{ height: "100%", width: "100%" }} />
          </AgStudioProvider>
        )}
      </div>

      <div className="gap-xl" />
      <h2 className="section">Runs</h2>
      <div style={{ height: 16 }} />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <input
          aria-label="Search runs"
          value={runSearch}
          onChange={(event) => setRunSearch(event.target.value)}
          placeholder="Search runs"
          style={{ width: "min(320px, 100%)", border: "1px solid #ECECEC", borderRadius: 999, padding: "9px 14px", font: "inherit" }}
        />
        <button
          type="button"
          onClick={() => gridRef.current?.api.exportDataAsCsv()}
          style={{ border: "1px solid #ECECEC", background: "#FFFFFF", color: "#141414", borderRadius: 999, padding: "8px 14px", font: "inherit", cursor: "pointer" }}
        >
          Export CSV
        </button>
      </div>
      <div className="gridbox">
        <AgGridProvider modules={[AllCommunityModule]}>
          <AgGridReact
            ref={gridRef}
            rowData={runs}
            columnDefs={cols}
            getRowId={(params) => String(params.data.id ?? params.data.run_id ?? "")}
            quickFilterText={runSearch}
            theme={gridTheme}
          />
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
