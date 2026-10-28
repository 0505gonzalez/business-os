import { createApi } from "../../../packages/backend/src/api.js";
import { db } from "../../../packages/backend/src/database.js";
const app = createApi();
await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
