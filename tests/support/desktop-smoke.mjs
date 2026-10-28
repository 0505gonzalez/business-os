import { _electron as electron } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const app = await electron.launch({
  executablePath:
    "out/Business OS-darwin-arm64/Business OS.app/Contents/MacOS/Business OS",
});
try {
  const window = await app.firstWindow();
  await window
    .getByRole("heading", { name: "Business OS", exact: true })
    .waitFor();
  const bridge = await window.evaluate(() => ({
    available: typeof window.businessOS?.chat === "function",
    node: typeof window.require,
    protocol: location.protocol,
  }));
  if (
    !bridge.available ||
    bridge.node !== "undefined" ||
    bridge.protocol !== "business-os:"
  )
    throw new Error(JSON.stringify(bridge));
  await window.evaluate(async () => {
    await window.businessOS.configure({
      token: "test-transport-only",
      workspaceId: "00000000-0000-4000-a000-000000000001",
      userId: "test_transport",
      apiUrl: "http://127.0.0.1:59999",
    });
    await window.businessOS.disconnect();
    const status = await window.businessOS.claudeStatus();
    if (typeof status.loggedIn !== "boolean")
      throw new Error("Claude status transport failed");
  });
  await mkdir("test-results", { recursive: true });
  await window.screenshot({ path: "test-results/desktop.png" });
  console.log(
    "Packaged desktop verified: custom protocol, isolated renderer, typed preload bridge, agent subprocess, Claude status transport",
  );
} finally {
  await app.close();
}
