import { Render } from "@renderinc/sdk";
import { task, type TaskContext } from "@renderinc/sdk/workflows";
import type { Client } from "@elastic/elasticsearch";
import { DEFAULT_REPS, MODEL_FLEET, WORKFLOW_SERVICE_NAME } from "./config.js";
import {
  EXPERIMENTS_INDEX,
  PRODUCTS_INDEX,
  RUNS_INDEX,
  getDocument,
} from "./elastic.js";
import { buildRunSpecs } from "./shelf.js";
import { runShopper, type RunSpec } from "./shopper.js";

export function createWorkflowTasks(client: Client) {
  const shop = task(
    { name: "shop", timeoutSeconds: 240 },
    async (_ctx: TaskContext, runSpec: RunSpec) => runShopper(client, runSpec),
  );
  const runExperiment = task(
    { name: "runExperiment", timeoutSeconds: 3600 },
    async (ctx: TaskContext, experimentId: string) => {
      const experiment = await getDocument<Record<string, any>>(client, EXPERIMENTS_INDEX, experimentId);
      if (!experiment) throw new Error(`Experiment ${experimentId} was not found.`);
      const product = await getDocument<Record<string, any>>(client, PRODUCTS_INDEX, String(experiment.product_id));
      if (!product) throw new Error(`Product ${experiment.product_id} was not found.`);
      const reps = Number.isInteger(experiment.reps) && experiment.reps > 0
        ? Math.min(experiment.reps, 20)
        : DEFAULT_REPS;
      const specs = buildRunSpecs({
        id: String(experiment.id),
        query: String(experiment.query),
        reps,
        competitors: Array.isArray(experiment.competitors) ? experiment.competitors : [],
      }, product, MODEL_FLEET, reps);
      for (const spec of specs) {
        await client.index({
          index: RUNS_INDEX,
          id: spec.id,
          document: {
            ...spec,
            experiment_id: experimentId,
            product_id: spec.productId,
            shelf_order: spec.shelfOrder,
            status: "pending",
            created_at: new Date().toISOString(),
          },
          refresh: "wait_for",
        });
      }
      await Promise.all(specs.map((spec) => ctx.run(shop, spec)));
      const completed = { ...experiment, status: "complete", completed_at: new Date().toISOString() };
      await client.index({ index: EXPERIMENTS_INDEX, id: experimentId, document: completed, refresh: "wait_for" });
      return completed;
    },
  );
  return { shop, runExperiment };
}

export async function startExperimentWorkflow(experimentId: string) {
  const missing = process.env.RENDER_API_KEY ? [] : ["RENDER_API_KEY"];
  if (missing.length) {
    throw new Error(`Experiment workflows are unavailable. Missing environment variables: ${missing.join(", ")}.`);
  }
  const render = new Render({
    token: process.env.RENDER_API_KEY,
    useLocalDev: process.env.RENDER_USE_LOCAL_DEV === "true",
    localDevUrl: process.env.RENDER_LOCAL_DEV_URL,
  });
  return render.workflows.startTask(
    `${WORKFLOW_SERVICE_NAME}/runExperiment`,
    [experimentId],
  );
}
