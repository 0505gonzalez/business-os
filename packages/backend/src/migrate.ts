import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { db } from "./database.js";
export async function migrate() {
  const c = await db.connect();
  try {
    await c.query("SELECT pg_advisory_lock(713291)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
    );
    const folder = pathToFileURL(
      path.resolve(process.cwd(), "migrations") + "/",
    );
    for (const name of (await readdir(folder))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      if (
        (await c.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]))
          .rowCount
      )
        continue;
      await c.query("BEGIN");
      try {
        await c.query(await readFile(new URL(name, folder), "utf8"));
        await c.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await c.query("SELECT pg_advisory_unlock(713291)");
    c.release();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await migrate();
  await db.end();
}
