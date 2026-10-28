import { build } from "esbuild";
import { mkdir, copyFile, readFile, writeFile, cp } from "node:fs/promises";
await mkdir("dist/desktop", { recursive: true });
await build({
  entryPoints: ["apps/desktop/src/main.ts"],
  outfile: "dist/desktop/main.mjs",
  platform: "node",
  format: "esm",
  bundle: true,
  packages: "external",
  target: "node22",
});
await build({
  entryPoints: ["packages/agent-runtime/src/worker.ts"],
  outfile: "dist/desktop/agent-worker.mjs",
  platform: "node",
  format: "esm",
  bundle: true,
  packages: "external",
  target: "node22",
});
await build({
  entryPoints: ["apps/desktop/src/preload.ts"],
  outfile: "dist/desktop/preload.cjs",
  platform: "node",
  format: "cjs",
  bundle: true,
  external: ["electron"],
  target: "node22",
});
await cp("apps/desktop/dist", "dist/desktop/renderer", { recursive: true });
