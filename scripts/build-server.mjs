import { build } from "esbuild";
await build({
  entryPoints: {
    api: "apps/api/src/index.ts",
    worker: "apps/worker/src/index.ts",
    migrate: "packages/backend/src/migrate.ts",
  },
  outdir: "dist/server",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  bundle: true,
  packages: "external",
  target: "node24",
});
