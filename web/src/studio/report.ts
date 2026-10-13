import type { AgReportState } from "ag-studio";
import { agentShelfWidgetState } from "./widgets";

const caption = (text: string) => ({ caption: { enabled: true, text } });
const valueWidget = (text: string, field: string, aggregation: "avg" | "count" | "sum") => ({
  type: "value",
  dataMapping: { value: [{ id: field, aggregation }] },
  format: caption(text),
});
const chart = (
  type: string,
  text: string,
  category: string,
  value: string,
  aggregation: "avg" | "sum",
  legend?: string,
) => ({
  type,
  dataMapping: {
    categoryKey: [{ id: category }],
    valueKey: [{ id: value, aggregation }],
    ...(legend ? { legendKey: [{ id: legend }] } : {}),
  },
  format: caption(text),
});
const grid = (text: string, columns: string[]) => ({
  type: "grid",
  dataMapping: { cols: columns.map((id) => ({ id })) },
  format: caption(text),
});

export function createDefaultReportState(): AgReportState {
  const customWidgets = agentShelfWidgetState();
  return {
    pages: [
      {
        id: "Overview",
        widgets: {
          "model-filter": {
            type: "list-filter",
            dataMapping: { value: [{ id: "runs.model" }] },
          },
          "variant-filter": {
            type: "list-filter",
            dataMapping: { value: [{ id: "runs.variant" }] },
          },
          "runs-kpi": valueWidget("Runs", "runs.run_id", "count"),
          "picked-kpi": valueWidget("Picked yours", "runs.picked_ours", "avg"),
          "first-offer-kpi": {
            ...valueWidget("Took the first offer", "position.share", "sum"),
          },
          "captured-kpi": valueWidget("Orders captured", "runs.captured", "sum"),
          takeaway: {
            ...customWidgets.takeaway,
            format: caption("Merchant takeaway"),
          },
          modelScoreboard: {
            ...customWidgets.modelScoreboard,
            dataMapping: {
              model: [{ id: "runs.model" }],
              variant: [{ id: "runs.variant" }],
              share: [{ id: "runs.picked_ours", aggregation: "avg" }],
            },
            format: caption("Model scoreboard"),
          },
          "selection-share": chart(
            "column-chart-grouped",
            "Selection share by model",
            "runs.model",
            "runs.picked_ours",
            "avg",
            "runs.variant",
          ),
          checkoutFunnel: {
            ...customWidgets.checkoutFunnel,
            format: caption("Checkout funnel"),
          },
        },
        widgetLayout: {
          "model-filter": { xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 8 },
          "variant-filter": { xTrack: 12, yTrack: 0, xSpan: 12, ySpan: 8 },
          "runs-kpi": { xTrack: 0, yTrack: 8, xSpan: 6, ySpan: 10 },
          "picked-kpi": { xTrack: 6, yTrack: 8, xSpan: 6, ySpan: 10 },
          "first-offer-kpi": { xTrack: 12, yTrack: 8, xSpan: 6, ySpan: 10 },
          "captured-kpi": { xTrack: 18, yTrack: 8, xSpan: 6, ySpan: 10 },
          takeaway: { xTrack: 0, yTrack: 18, xSpan: 24, ySpan: 12 },
          modelScoreboard: { xTrack: 0, yTrack: 30, xSpan: 12, ySpan: 24 },
          "selection-share": { xTrack: 12, yTrack: 30, xSpan: 12, ySpan: 24 },
          checkoutFunnel: { xTrack: 0, yTrack: 54, xSpan: 24, ySpan: 26 },
        },
        filter: {
          widget: {
            "first-offer-kpi": [{
              type: "value",
              field: { id: "position.position" },
              values: [1],
            }],
          },
        },
      },
      {
        id: "Shelf",
        widgets: {
          "position-chart": chart(
            "column-chart-grouped",
            "Picks by shelf position",
            "position.position",
            "position.picks",
            "sum",
          ),
          "price-picks": {
            type: "scatter-chart",
            dataMapping: {
              categoryKey: [{ id: "shelf.price", aggregation: "avg" }],
              valueKey: [{ id: "shelf.picks", aggregation: "sum" }],
              groupByKey: [{ id: "shelf.title" }],
            },
            format: caption("Price vs picks"),
          },
          "shelf-grid": grid("Shelf offers", [
            "shelf.title",
            "shelf.brand",
            "shelf.price",
            "shelf.picks",
            "shelf.share",
          ]),
        },
        widgetLayout: {
          "position-chart": { xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 24 },
          "price-picks": { xTrack: 12, yTrack: 0, xSpan: 12, ySpan: 24 },
          "shelf-grid": { xTrack: 0, yTrack: 24, xSpan: 24, ySpan: 24 },
        },
      },
      {
        id: "Runs",
        widgets: {
          "runs-pivot": {
            type: "pivot-grid",
            dataMapping: {
              rows: [{ id: "runs.model" }],
              columns: [{ id: "runs.variant" }],
              values: [
                { id: "runs.picked_ours", aggregation: "avg" },
                { id: "runs.captured", aggregation: "sum" },
              ],
            },
            format: caption("Runs by model and variant"),
          },
          "runs-grid": grid("Runs", [
            "runs.model",
            "runs.variant",
            "runs.broke_at",
            "runs.failure_reason",
            "runs.replay_url",
          ]),
        },
        widgetLayout: {
          "runs-pivot": { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 24 },
          "runs-grid": { xTrack: 0, yTrack: 24, xSpan: 24, ySpan: 28 },
        },
        filter: {
          widget: {
            "runs-grid": [{
              field: { id: "runs.broke_at" },
              model: { operator: "isNotBlank" },
            }],
          },
        },
      },
    ],
    selectedPageId: "Overview",
  } as AgReportState;
}
