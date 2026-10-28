import { test } from "node:test";
import assert from "node:assert/strict";
import { businessExtension } from "../packages/pi-business-os/src/index.js";
import { ApiClient } from "../packages/api-client/src/index.js";
test("agent can discover workflows in its configured workspace", async () => {
  const registered = new Map<string, any>();
  const calls: string[] = [];
  const client = new ApiClient("http://localhost", async () => "test");
  client.request = async <T>(route: string) => {
    calls.push(route);
    return [{ id: "workflow-1", kind: "adr", stage: "review" }] as T;
  };
  businessExtension(
    client,
    "workspace-1",
    () => {},
    () => ({}),
  )({ registerTool: (tool: any) => registered.set(tool.name, tool) } as any);
  const tool = registered.get("business_workflows");
  assert.ok(tool);
  const result = await tool.execute();
  assert.deepEqual(calls, ["/workspace-1/workflows"]);
  assert.equal(JSON.parse(result.content[0].text)[0].id, "workflow-1");
});
