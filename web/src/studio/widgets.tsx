import { useEffect, useMemo, useState } from "react";
import { createWidgets } from "ag-studio-react";
import type { AgWidgetApi, AgWidgetField } from "ag-studio";

type WidgetProps = {
  dataMapping: Record<string, AgWidgetField[]>;
  widgetApi: AgWidgetApi;
};

const colors = {
  ink: "#141414",
  muted: "#777777",
  line: "#ECECEC",
  red: "#E1261C",
  pale: "#FAFAFA",
  white: "#FFFFFF",
  font: "Mona Sans Variable, system-ui, sans-serif",
};

function useRows({ dataMapping, widgetApi }: WidgetProps, keys: string[]) {
  const fieldKeys = keys.join("|");
  const fields = useMemo(
    () => fieldKeys.split("|").flatMap((key) => dataMapping[key] ?? []),
    [dataMapping, fieldKeys],
  );
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    let active = true;
    if (!fields.length) {
      setRows([]);
      return () => { active = false; };
    }
    widgetApi.getData({ kind: "flat", fields })
      .then((response) => {
        if (active) setRows(response.results.rows);
      })
      .catch(() => {
        if (active) setRows([]);
      });
    return () => { active = false; };
  }, [fields, widgetApi]);

  const value = (row: Record<string, unknown>, key: string) => {
    const field = dataMapping[key]?.[0];
    return field ? row[field.key] : undefined;
  };
  return { rows, value };
}

function TakeawayWidget(props: WidgetProps) {
  const { rows, value } = useRows(props, [
    "headline",
    "model",
    "originalShare",
    "fixedShare",
    "delta",
    "topBreakStage",
    "topBreakCount",
  ]);
  const row = rows[0];
  const delta = Number(value(row ?? {}, "delta"));
  const model = String(value(row ?? {}, "model") ?? "");
  const headline = String(value(row ?? {}, "headline") ?? "");
  return (
    <div style={{ fontFamily: colors.font, color: colors.ink, padding: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>
        {headline || "Waiting for completed shopper runs."}
      </div>
      {row && model && Number.isFinite(delta) && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 12 }}>
          <strong style={{ color: delta > 0 ? colors.red : colors.ink, fontSize: 34, letterSpacing: "-0.06em" }}>
            {delta > 0 ? "+" : ""}{Math.round(delta * 100)}%
          </strong>
          <span style={{ color: colors.muted, fontSize: 12 }}>best fix on {model}</span>
        </div>
      )}
    </div>
  );
}

function ModelScoreboardWidget(props: WidgetProps) {
  const { rows, value } = useRows(props, ["model", "variant", "share"]);
  const modelField = props.dataMapping.model?.[0];
  const modelFieldId = modelField && "id" in modelField ? modelField.id : undefined;
  const [, setSelectionTick] = useState(0);
  const crossFilter = props.widgetApi.getCrossFilterSelections()?.find((selection) =>
    selection.type === "value" &&
    "id" in selection.field &&
    selection.field.id === modelFieldId,
  );
  const selectedModel = crossFilter?.type === "value"
    ? String(crossFilter.values[0] ?? "")
    : "";
  const models = new Map<string, { original?: number; fixed?: number }>();
  for (const row of rows) {
    const model = String(value(row, "model") ?? "");
    const variant = String(value(row, "variant") ?? "");
    const share = Number(value(row, "share") ?? 0);
    const current = models.get(model) ?? {};
    if (variant === "original") current.original = share;
    if (variant === "fixed") current.fixed = share;
    models.set(model, current);
  }
  const percent = (value: number | undefined) => `${Math.round((value ?? 0) * 100)}%`;
  const bar = (share: number | undefined, color: string) => (
    <div style={{ height: 6, background: colors.line, borderRadius: 6, overflow: "hidden", flex: 1 }}>
      <div style={{ width: `${Math.max(0, Math.min(100, (share ?? 0) * 100))}%`, height: "100%", background: color }} />
    </div>
  );
  return (
    <div style={{ padding: 16, color: colors.ink, fontFamily: colors.font }}>
      {!models.size && <div style={{ color: colors.muted, fontSize: 13 }}>Waiting for shopper runs.</div>}
      {[...models.entries()].map(([model, shares]) => {
        const delta = (shares.fixed ?? 0) - (shares.original ?? 0);
        return (
          <button
            key={model}
            type="button"
            aria-pressed={selectedModel === model}
            onClick={() => {
              if (!modelField) return;
              props.widgetApi.toggleCrossFilter({
                type: "value",
                field: modelField,
                value: model,
                group: 0,
              });
              setSelectionTick((tick) => tick + 1);
            }}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(100px,1fr) 2fr 2fr 64px",
              gap: 12,
              alignItems: "center",
              padding: "10px 8px",
              border: 0,
              borderBottom: `1px solid ${colors.line}`,
              background: selectedModel === model ? colors.pale : colors.white,
              color: colors.ink,
              font: "inherit",
              textAlign: "left",
              cursor: "pointer",
              width: "100%",
            }}
          >
            <strong>{model}</strong>
            {(["original", "fixed"] as const).map((variant) => {
              const share = shares[variant];
              return (
                <div key={variant} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 48, color: colors.muted }}>{variant === "original" ? "Original" : "Fixed"}</span>
                  {bar(share, variant === "fixed" ? colors.red : colors.ink)}
                  <span style={{ width: 34, textAlign: "right" }}>{percent(share)}</span>
                </div>
              );
            })}
            <strong style={{ textAlign: "right", color: delta > 0 ? colors.red : colors.muted }}>
              {delta > 0 ? "+" : ""}{Math.round(delta * 100)}%
            </strong>
          </button>
        );
      })}
    </div>
  );
}

const funnelStages = [
  ["shelf_viewed", "Shelf viewed"],
  ["offer_selected", "Offer selected"],
  ["product_viewed", "Product viewed"],
  ["cart_created", "Cart created"],
  ["cart_updated", "Cart updated"],
  ["approval_redirected", "PayPal approval"],
  ["approval_returned", "PayPal returned"],
  ["captured", "Order captured"],
] as const;

function CheckoutFunnelWidget(props: WidgetProps) {
  const { rows, value } = useRows(props, ["stage", "count"]);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const stage = String(value(row, "stage") ?? "");
    counts.set(stage, (counts.get(stage) ?? 0) + Number(value(row, "count") ?? 0));
  }
  const stages = funnelStages
    .map(([id, label]) => ({ id, label, count: counts.get(id) ?? 0 }))
    .filter((stage) => counts.has(stage.id));
  const biggestDrop = stages.reduce<{ stage: string; amount: number } | null>((best, stage, i) => {
    if (i === 0) return best;
    const amount = stages[i - 1]!.count - stage.count;
    return amount > (best?.amount ?? 0) ? { stage: stage.id, amount } : best;
  }, null);
  const max = Math.max(1, ...stages.map((stage) => stage.count));
  return (
    <div style={{ padding: 16, color: colors.ink, fontFamily: colors.font }}>
      {!stages.length && <div style={{ color: colors.muted, fontSize: 13 }}>Waiting for checkout events.</div>}
      {stages.map((stage) => (
        <div key={stage.id} style={{ display: "grid", gridTemplateColumns: "140px 1fr 44px 8px", gap: 10, alignItems: "center", padding: "6px 0", fontSize: 12 }}>
          <span>{stage.label}</span>
          <div style={{ height: 8, background: colors.line, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ width: `${stage.count / max * 100}%`, height: "100%", background: colors.ink }} />
          </div>
          <span style={{ textAlign: "right", color: colors.muted }}>{stage.count}</span>
          <span style={{ width: 6, height: 6, borderRadius: 6, background: biggestDrop?.stage === stage.id ? colors.red : "transparent" }} />
        </div>
      ))}
    </div>
  );
}

function categoryField(aiDescription: string, required = false) {
  return {
    type: "field",
    supportedRoles: ["category"],
    requires: { cardinality: "one" },
    aiDescription,
    ...(required ? { required: true } : {}),
  };
}

function numericField(aiDescription: string, required = false) {
  return {
    type: "field",
    supportedRoles: ["numeric"],
    requires: { cardinality: "one" },
    aiDescription,
    ...(required ? { required: true } : {}),
  };
}

function formatShape() {
  const schema = {
    type: "object",
    properties: {
      caption: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          text: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: true,
  };
  const value = (input: unknown) =>
    input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    parse: (input: unknown) => ({ success: true, value: value(input) }),
    toJSONSchema: () => schema,
    "~standard": {
      version: 1,
      vendor: "ag",
      validate: (input: unknown) => ({ success: true, value: value(input) }),
      types: { input: {}, output: {} },
      jsonSchema: { input: () => schema, output: () => schema },
    },
  } as any;
}

const widgetFormatShape = formatShape();

const widgetDefinitions = [
  {
    id: "takeaway",
    label: "Takeaway",
    dataMapping: {
      headline: categoryField("Takeaway headline text.", true),
      model: categoryField("Model with the largest fixed-copy improvement."),
      originalShare: numericField("Selection share before the copy change."),
      fixedShare: numericField("Selection share after the copy change."),
      delta: numericField("Selection-share change from original to fixed copy."),
      topBreakStage: categoryField("Checkout stage with the most shopper failures."),
      topBreakCount: numericField("Number of failures at the top break stage."),
    },
    comp: TakeawayWidget,
    formatShape: () => widgetFormatShape,
    ai: {
      label: "Merchant takeaway",
      description: "Highlights the experiment's main takeaway and strongest copy change.",
      usage: "Use on the Overview page when a concise experiment summary is useful.",
      configuration: "Map the takeaway headline and optional model, share, delta, and break-stage fields.",
    },
    form: ({ createDefaults }: any) => createDefaults({
      dataMappingItems: Object.keys({
        headline: 1,
        model: 1,
        originalShare: 1,
        fixedShare: 1,
        delta: 1,
        topBreakStage: 1,
        topBreakCount: 1,
      }).map((key) => ({ key, label: key })),
    }),
    defaultSize: { width: 600, height: 140 },
    minSize: { width: 280, height: 100 },
  },
  {
    id: "modelScoreboard",
    label: "Model scoreboard",
    dataMapping: {
      model: categoryField("AI shopper model name.", true),
      variant: categoryField("Product-copy variant tested.", true),
      share: numericField("Average merchant-selection value for this model and variant.", true),
    },
    comp: ModelScoreboardWidget,
    formatShape: () => widgetFormatShape,
    ai: {
      label: "Model scoreboard",
      description: "Compares merchant-selection share across models and product-copy variants.",
      usage: "Use to compare original and fixed product-copy performance by model.",
      configuration: "Map model, variant, and average merchant-selection share.",
    },
    form: ({ createDefaults }: any) => createDefaults({
      dataMappingItems: ["model", "variant", "share"].map((key) => ({ key, label: key })),
    }),
    defaultSize: { width: 600, height: 300 },
    minSize: { width: 360, height: 180 },
  },
  {
    id: "checkoutFunnel",
    label: "Checkout funnel",
    dataMapping: {
      stage: categoryField("Experiment checkout funnel stage.", true),
      count: numericField("Runs reaching this funnel stage.", true),
    },
    comp: CheckoutFunnelWidget,
    formatShape: () => widgetFormatShape,
    ai: {
      label: "Checkout funnel",
      description: "Shows shopper progression through product selection and checkout.",
      usage: "Use when the report should show stage counts and the largest drop-off.",
      configuration: "Map checkout stage and its run count.",
    },
    form: ({ createDefaults }: any) => createDefaults({
      dataMappingItems: ["stage", "count"].map((key) => ({ key, label: key })),
    }),
    defaultSize: { width: 600, height: 300 },
    minSize: { width: 360, height: 180 },
  },
] as any[];

const defaultMappings = {
  takeaway: {
    headline: [{ id: "takeaway.headline" }],
    model: [{ id: "takeaway.model" }],
    originalShare: [{ id: "takeaway.originalShare" }],
    fixedShare: [{ id: "takeaway.fixedShare" }],
    delta: [{ id: "takeaway.delta" }],
    topBreakStage: [{ id: "takeaway.topBreakStage" }],
    topBreakCount: [{ id: "takeaway.topBreakCount" }],
  },
  modelScoreboard: {
    model: [{ id: "runs.model" }],
    variant: [{ id: "runs.variant" }],
    share: [{ id: "runs.picked_ours", aggregation: "avg" }],
  },
  checkoutFunnel: {
    stage: [{ id: "funnel.stage" }],
    count: [{ id: "funnel.count", aggregation: "sum" }],
  },
};

export function createAgentShelfWidgets(base: any) {
  return createWidgets<any>({
    additionalTypes: widgetDefinitions,
    menu: [
      ...base.menu,
      { label: "AgentShelf", widgetIds: ["takeaway", "modelScoreboard", "checkoutFunnel"] },
    ],
  });
}

export function agentShelfWidgetState() {
  return Object.fromEntries(
    Object.entries(defaultMappings).map(([id, dataMapping]) => [
      id,
      { type: id, dataMapping },
    ]),
  );
}
