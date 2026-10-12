import { createElasticClient, ensureIndices } from "./elastic.js";
import { createWorkflowTasks } from "./workflows.js";

const elastic = createElasticClient();
await ensureIndices(elastic);
createWorkflowTasks(elastic);
