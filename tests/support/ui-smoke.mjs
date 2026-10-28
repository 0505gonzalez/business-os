import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
const server = await createServer({
  configFile: false,
  root: "tests/ui",
  server: { host: "127.0.0.1", port: 5199, fs: { allow: [process.cwd()] } },
});
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5199");
  await page.getByRole("button", { name: "Needs you: 1" }).waitFor();
  await page
    .getByRole("button", { name: /Review: usage-based pricing/ })
    .click();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await page.getByRole("button", { name: /Pricing principles/ }).click();
  await page.getByRole("button", { name: "Revision history" }).click();
  await page.getByRole("button", { name: "Payments", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Loading transactions" })
    .waitFor();
  if (await page.getByRole("button", { name: "Sync sandbox" }).count())
    throw new Error("Manual sync should not be shown");
  await page.getByRole("button", { name: /TR_SANDBOX/ }).click();
  await page.getByText("SUCCEEDED", { exact: true }).last().waitFor();
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await page.getByRole("button", { name: "New workflow" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Test feature");
  await page
    .getByLabel("Proposal", { exact: true })
    .fill("A clear destination");
  await page
    .getByRole("button", { name: "Start workflow", exact: true })
    .click();
  await mkdir("test-results/qa", { recursive: true });
  await page.screenshot({ path: "test-results/workflows.png", fullPage: true });
  await page.getByRole("button", { name: "Team", exact: true }).click();
  await page.getByText("Sam Engineer", { exact: true }).waitFor();
  await page.getByLabel("Invitation label").fill("Jordan — engineering");
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await page.getByLabel("Invitation code").waitFor();
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await page.getByText("revoked", { exact: true }).waitFor();
  await page.getByLabel("Role for Sam Engineer").fill("product");
  await page
    .locator(".team-member")
    .filter({ hasText: "Sam Engineer" })
    .getByRole("button", { name: "Save role" })
    .click();
  await page
    .locator(".team-member")
    .filter({ hasText: "Sam Engineer" })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm removal" }).click();
  await page
    .getByText("Sam Engineer", { exact: true })
    .waitFor({ state: "detached" });
  await page.screenshot({ path: "test-results/team.png", fullPage: true });
  await page.locator(".agent-header").click();
  await page.getByLabel("Message your agent").fill("Show my workflows");
  await page.getByLabel("Message your agent").press("Enter");
  await page.locator(".message.assistant").waitFor();
  await page
    .locator(".message.assistant strong")
    .filter({ hasText: "Ready for review" })
    .waitFor();
  await page.getByLabel("Message your agent").fill("First line");
  await page.getByLabel("Message your agent").press("Shift+Enter");
  await page.getByLabel("Message your agent").pressSequentially("Second line");
  if (
    (await page.getByLabel("Message your agent").inputValue()) !==
    "First line\nSecond line"
  )
    throw Error("Multiline composer failed");
  await page.getByLabel("Message your agent").fill("");
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 1000, height: 700 },
  ]) {
    await page.setViewportSize(size);
    const layout = await page.evaluate(() => {
      const panel = document.querySelector(".agent-panel");
      const message = document.querySelector(".message.assistant");
      const log = document.querySelector(".chat-messages");
      const input = document.querySelector(".chat-input");
      const p = panel.getBoundingClientRect(),
        m = message.getBoundingClientRect(),
        i = input.getBoundingClientRect();
      return {
        position: getComputedStyle(message).position,
        inside: m.left >= p.left && m.right <= p.right,
        overflow: log.scrollWidth > log.clientWidth + 1,
        scrolls: log.scrollHeight > log.clientHeight,
        inputVisible: i.bottom <= innerHeight && i.top >= 0,
        panelVisible: p.top >= 0 && p.right <= innerWidth,
      };
    });
    if (
      layout.position !== "static" ||
      !layout.inside ||
      layout.overflow ||
      !layout.scrolls ||
      !layout.inputVisible ||
      !layout.panelVisible
    )
      throw Error(JSON.stringify(layout));
  }
  await page.screenshot({ path: "test-results/agent-panel.png" });
  await page.locator(".agent-header").click();
  await page.locator(".chat-messages").waitFor({ state: "detached" });
  await page.locator(".agent-header").click();
  await page.locator(".message.assistant").waitFor();
  await page.locator(".agent-header").click();
  await page.evaluate(() => {
    window.fixtureControls.paymentFailures = 1;
  });
  await page.getByRole("button", { name: "Payments", exact: true }).click();
  await page.getByText("Couldn’t load transactions", { exact: true }).waitFor();
  if (await page.getByText("No payments yet", { exact: true }).count())
    throw Error("Failure shown as empty account");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByRole("button", { name: /TR_SANDBOX/ }).waitFor();
  await page.evaluate(() => {
    window.fixtureControls.slowMemory = true;
  });
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await page.waitForTimeout(700);
  if (await page.getByRole("button", { name: /Pricing principles/ }).count())
    throw Error("Stale Memory response overwrote Workflows");
  await page.getByRole("button", { name: "New workflow" }).click();
  await page.getByRole("dialog", { name: "New workflow" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.evaluate(() => {
    window.fixtureControls.noRules = true;
  });
  await page.getByRole("button", { name: "New workflow" }).click();
  await page.getByRole("dialog", { name: "New workflow" }).waitFor();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: /Introduce usage-based pricing/ })
    .click();
  await page
    .getByRole("heading", { name: "Review rules", exact: true })
    .waitFor();
  await page.getByLabel("Approver role", { exact: true }).waitFor();
  await page.screenshot({path:"test-results/qa/workflow-rules-fixture.png",fullPage:true,scale:"css"});
  await page.getByRole("button", { name: "Workspace settings" }).click();
  if (
    await page
      .getByRole("heading", { name: "Review rules", exact: true })
      .count()
  )
    throw Error("Rules leaked into workspace settings");
  for (const name of ["Workflows", "Payments", "Memory", "Team"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page
      .getByRole("status")
      .filter({ hasText: /Loading/ })
      .waitFor({ state: "detached" });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      )
    )
      throw Error(`Horizontal overflow on ${name}`);
    await page.screenshot({
      path: `test-results/qa/${name.toLowerCase()}-small.png`,
      fullPage: true,
      scale: "css",
    });
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "UI verification passed: task approval; memory history; payment loading, failure and retry; workflow creation and setup; team management; Markdown and multiline chat; panel containment; keyboard dialogs; stale-response protection; narrow-screen overflow",
  );
} finally {
  await browser.close();
  await server.close();
}
