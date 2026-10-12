import { createDb, ensureSchema } from "./db.js";
import { createWorkflowTasks } from "./workflows.js";

const db = createDb();
await ensureSchema(db);
createWorkflowTasks(db);
