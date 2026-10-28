import { db } from "../../../packages/backend/src/database.js";
import {
  checkpointer,
  tickRun,
} from "../../../packages/backend/src/modules/workflows.js";
await checkpointer.setup();
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
  });
while (!stopping) {
  const runs = await db.query(
    "SELECT id FROM workflow_runs WHERE stage<>'completed' AND next_tick<=now() ORDER BY next_tick LIMIT 20",
  );
  await Promise.all(runs.rows.map((r) => tickRun(r.id)));
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
await db.end();
