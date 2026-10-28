import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [role, projectId, environment = "production"] = process.argv.slice(2);
const services = JSON.parse(
  readFileSync(
    new URL("../infra/railway-services.json", import.meta.url),
    "utf8",
  ),
);
if (!services[role] || !projectId) {
  throw new Error(
    "Usage: node scripts/deploy-railway.mjs <api|worker> <project-id> [environment]",
  );
}
const project = JSON.parse(
  execFileSync("railway", ["status", "--json"], { encoding: "utf8" }),
);
if (project.id !== projectId)
  throw new Error("Link the checkout to the intended Railway project first.");
const service = project.services.edges.find(
  ({ node }) => node.name === services[role].name,
)?.node;
const env = project.environments.edges.find(
  ({ node }) => node.name === environment || node.id === environment,
)?.node;
if (!service || !env)
  throw new Error("Create the service and environment before deploying.");
execFileSync(
  "railway",
  [
    "api",
    "mutation($id:String!,$env:String!,$input:ServiceInstanceUpdateInput!){serviceInstanceUpdate(serviceId:$id,environmentId:$env,input:$input)}",
    "--variables",
    JSON.stringify({
      id: service.id,
      env: env.id,
      input: services[role].settings,
    }),
  ],
  { stdio: "inherit" },
);
execFileSync(
  "railway",
  [
    "up",
    "--project",
    projectId,
    "--environment",
    env.id,
    "--service",
    service.id,
    "--detach",
  ],
  { stdio: "inherit" },
);
