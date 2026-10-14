import { Render } from "@renderinc/sdk";
import { task, type TaskContext } from "@renderinc/sdk/workflows";
import type { Db } from "./db.js";
import { DEFAULT_REPS, WORKFLOW_SERVICE_NAME } from "./config.js";
import {
  EXPERIMENTS_TABLE,
  getDoc,
  PRODUCTS_TABLE,
  putDoc,
  RUNS_TABLE,
} from "./db.js";
import { buildRunSpecs } from "./shelf.js";
import { runShopper, type RunSpec } from "./shopper.js";

export function createWorkflowTasks(db: Db) {
  const shop = task(
    { name: "shop", timeoutSeconds: 240 },
    async (_ctx: TaskContext, runSpec: RunSpec) => runShopper(db, runSpec),
  );
  const runExperiment = task(
    { name: "runExperiment", timeoutSeconds: 3600 },
    async (ctx: TaskContext, experimentId: string) => {
      const experiment = await getDoc<Record<string, any>>(db, EXPERIMENTS_TABLE, experimentId);
      if (!experiment) throw new Error(`Experiment ${experimentId} was not found.`);
      const product = await getDoc<Record<string, any>>(db, PRODUCTS_TABLE, String(experiment.product_id));
      if (!product) throw new Error(`Product ${experiment.product_id} was not found.`);
      const reps = Number.isInteger(experiment.reps) && experiment.reps > 0
        ? Math.min(experiment.reps, 20)
        : DEFAULT_REPS;
      const specs = buildRunSpecs({
        id: String(experiment.id),
        query: String(experiment.query),
        reps,
        competitors: Array.isArray(experiment.competitors) ? experiment.competitors : [],
      }, product,
        Array.isArray(experiment.models) ? experiment.models : [],
        reps,
      );
      for (const spec of specs) {
        await putDoc(db, RUNS_TABLE, spec.id, {
            ...spec,
            experiment_id: experimentId,
            product_id: spec.productId,
            shelf_order: spec.shelfOrder,
            status: "pending",
            created_at: new Date().toISOString(),
        });
      }
      await Promise.all(specs.map((spec) => ctx.run(shop, spec)));
      const completed = { ...experiment, status: "complete", completed_at: new Date().toISOString() };
      await putDoc(db, EXPERIMENTS_TABLE, experimentId, completed);
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
