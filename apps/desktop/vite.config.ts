import { defineConfig, loadEnv } from "vite";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const host = env.VITE_CLERK_FRONTEND_API_HOST;
  const clerk = host ? `https://${new URL(`https://${host}`).hostname}` : "";
  const api = new URL(env.VITE_API_URL ?? "http://localhost:3000").origin;
  return {
    root: "apps/desktop",
    envDir: process.cwd(),
    base: "./",
    build: { outDir: "dist" },
    plugins: [
      {
        name: "desktop-content-policy",
        transformIndexHtml(html) {
          const policy = [
            "default-src 'self'",
            `script-src 'self' 'unsafe-inline' ${clerk} https://challenges.cloudflare.com https://*.protect.clerk.com`,
            `connect-src 'self' ${api} ${clerk} https://*.protect.clerk.com https://clerk-telemetry.com`,
            "img-src 'self' https://img.clerk.com data:",
            "style-src 'self' 'unsafe-inline'",
            "worker-src 'self' blob:",
            "frame-src 'self' https://challenges.cloudflare.com https://*.protect.clerk.com",
            "form-action 'self'",
            "object-src 'none'",
          ].join("; ");
          return html.replace(
            "<head>",
            `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`,
          );
        },
      },
    ],
  };
});
