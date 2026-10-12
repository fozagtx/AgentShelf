import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createDb, ensureSchema } from "./db.js";
import { createWorkflowTasks } from "./workflows.js";

const db = createDb();
await ensureSchema(db);
createWorkflowTasks(db);
const app = await createApp({ db });
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
