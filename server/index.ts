import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createElasticClient, ensureIndices } from "./elastic.js";
import { createWorkflowTasks } from "./workflows.js";

const elastic = createElasticClient();
await ensureIndices(elastic);
createWorkflowTasks(elastic);
const app = await createApp({ elastic });
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
