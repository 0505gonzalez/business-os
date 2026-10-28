import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openAgent } from "../../packages/agent-runtime/src/session.js";
import { ApiClient } from "../../packages/api-client/src/index.js";
const directory = await mkdtemp(path.join(tmpdir(), "business-os-agent-"));
try {
  const session = await openAgent({
    directory,
    workspaceId: "00000000-0000-4000-a000-000000000001",
    client: new ApiClient("http://localhost:3000", async () => ""),
    emit: () => {},
    context: () => ({ page: "Workflows" }),
  });
  try {
    console.log(
      JSON.stringify({
        provider: session.model?.provider,
        model: session.model?.id,
        tools: session.getActiveToolNames(),
      }),
    );
    if (process.argv.includes("--inference")) {
      await session.prompt(
        "Reply with exactly: Business OS connected. Do not call tools.",
      );
      const result = session.getLastAssistantText();
      if (!result?.includes("Business OS connected."))
        throw new Error(
          "Claude connection verification failed: " + (result ?? "No response"),
        );
      console.log(result);
    }
  } finally {
    session.dispose();
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
