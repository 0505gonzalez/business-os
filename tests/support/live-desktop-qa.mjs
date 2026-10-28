import { _electron as electron, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const folder = "test-results/qa";
await mkdir(folder, { recursive: true });
const app = await electron.launch({
  executablePath:
    "out/Business OS-darwin-arm64/Business OS.app/Contents/MacOS/Business OS",
});
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const checks = [];
try {
  await page
    .getByRole("button", { name: "Workflows", exact: true })
    .waitFor({ timeout: 30000 });
  for (const [width, height] of [
    [1320, 900],
    [1000, 700],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setSize(...size),
      [width, height],
    );
    for (const name of ["Workflows", "Payments", "Memory", "Team"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await page.getByRole("heading", { name, exact: true }).waitFor();
      await page
        .getByRole("status")
        .filter({ hasText: /Loading/ })
        .waitFor({ state: "detached" });
      if (name === "Team")
        await page
          .getByRole("button", { name: "Create invitation", exact: true })
          .waitFor();
      await page.evaluate(() => scrollTo(0, 0));
      await expect(page.getByRole("alert")).toHaveCount(0);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      if (overflow) throw Error(`Horizontal overflow: ${name} at ${width}`);
      await page.screenshot({
        path: `${folder}/live-${name.toLowerCase()}-${width}.png`,
        scale: "css",
      });
      checks.push(
        `${name} loaded without errors or horizontal overflow at ${width}×${height}`,
      );
    }
  }
  await page
    .getByRole("button", { name: "Workspace settings", exact: true })
    .click();
  await page.getByLabel("Approver role", { exact: true }).waitFor();
  await page.screenshot({
    path: `${folder}/live-settings-1000.png`,
    scale: "css",
  });
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: /Loading/ })
    .waitFor({ state: "detached" });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1320, 900),
  );
  await page.locator(".agent-header").click();
  await expect(page.getByLabel("Message your agent")).toBeEnabled({
    timeout: 30000,
  });
  await page
    .getByLabel("Message your agent")
    .fill(
      "Check the current workflows and summarize what needs attention in two or three short bullets. Use workflow titles and explain the next action. Do not create or modify anything.",
    );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.locator(".message.assistant").waitFor({ timeout: 90000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  if (
    (await page
      .locator(".message.assistant")
      .evaluate((el) => getComputedStyle(el).position)) !== "static"
  )
    throw Error("Assistant escaped document flow");
  await page.screenshot({
    path: `${folder}/live-agent-1320.png`,
    scale: "css",
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1000, 700),
  );
  await page.screenshot({
    path: `${folder}/live-agent-1000.png`,
    scale: "css",
  });
  await page.locator(".agent-header").click();
  await page.locator(".agent-header").click();
  await page.locator(".message.assistant").waitFor();
  checks.push(
    "Live Claude response rendered as Markdown; composer ready; collapse/reopen preserved conversation",
  );
  if (errors.length) throw Error(errors.join("\n"));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1320, 900),
  );
  await writeFile(
    `${folder}/live-results.json`,
    JSON.stringify({ checks, rendererErrors: errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, rendererErrors: errors }, null, 2));
} catch (error) {
  process.exitCode = 1;
  console.error(error);
  await page.screenshot({ path: `${folder}/live-failure.png`, scale: "css" });
}
// Leave the user's verified app open for testing.
await new Promise((resolve) => app.on("close", resolve));
