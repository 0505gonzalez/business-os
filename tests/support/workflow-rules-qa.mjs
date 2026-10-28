import { _electron as electron, expect } from "@playwright/test";
const app = await electron.launch({
  executablePath:
    "out/Business OS-darwin-arm64/Business OS.app/Contents/MacOS/Business OS",
});
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page
  .getByRole("button", { name: "Workflows", exact: true })
  .waitFor({ timeout: 30000 });
await page.getByRole("button", { name: /ABC/ }).click();
await page
  .getByRole("heading", { name: "Review rules", exact: true })
  .waitFor();
await page.getByLabel("Approver role", { exact: true }).waitFor();
await page.getByRole("button", {name:"Your agent",exact:true}).waitFor({timeout:30000});
await expect(page.getByRole("alert")).toHaveCount(0);
for (const [width, height] of [
  [1320, 900],
  [1000, 700],
]) {
  await app.evaluate(
    ({ BrowserWindow }, size) =>
      BrowserWindow.getAllWindows()[0].setSize(...size),
    [width, height],
  );
  await page.locator(".workflow-rules").evaluate(el=>el.scrollIntoView({block:"start"}));
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    )
  )
    throw Error("Workflow details overflow");
  await page.screenshot({
    path: `test-results/qa/workflow-rules-${width}.png`,
    scale: "css",
  });
}
await page.getByRole("button", { name: "Workspace settings" }).click();
await expect(
  page.getByRole("heading", { name: "Review rules", exact: true }),
).toHaveCount(0);
await page.getByRole("button", { name: "Workflows", exact: true }).click();
await page.getByRole("button", { name: "New workflow" }).click();
await page.getByRole("dialog", { name: "New workflow" }).waitFor();
await page.keyboard.press("Escape");
await page.getByRole("button", { name: /ABC/ }).click();
await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].setSize(1320, 900),
);
await page
  .getByRole("heading", { name: "Review rules", exact: true })
  .scrollIntoViewIfNeeded();
if (errors.length) throw Error(errors.join("\n"));
console.log(
  "Live workflow rules checks passed: scoped editor, no workspace rules, no creation prerequisite, responsive details, no renderer errors.",
);
