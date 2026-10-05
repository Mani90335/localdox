import { test, expect } from "@playwright/test";

// A regression check for the removed Python download, including old consent.
test("calculus stays local and advanced input never requests Python", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    );
    localStorage.setItem("localdox:advanced-math", "accepted");
  });
  const downloads: string[] = [];
  page.on("request", (request) => {
    if (/pyodide|advanced\.worker|sympy.*\.whl/.test(request.url())) downloads.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "guide.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Guide\n\nMath notes.\n"),
    });
  await expect(page.locator("article h1").first()).toBeVisible();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("tab", { name: "Compute" }).click();
  const panel = page.getByRole("region", { name: "Notes panel" });
  await panel.getByRole("radio", { name: "Text", exact: true }).click();
  const input = panel.getByRole("textbox", { name: /^Expression or equation/ });
  const compute = panel.getByRole("button", { name: "Compute", exact: true });
  for (const [latex, step] of [
    ["\\frac{d}{dx}\\left(x^3+2x\\right)", "lower the power by 1"],
    ["\\int_0^1 x^2\\,dx", "upper number"],
  ]) {
    await input.fill(latex);
    await compute.click();
    await expect(panel.getByRole("region", { name: "Evaluate result" })).toContainText(step);
  }
  await panel.getByRole("button", { name: "Add to rough work", exact: true }).click();
  await page.getByRole("tab", { name: "Rough work" }).click();
  await expect(panel).toContainText("upper number");
  await page.getByRole("tab", { name: "Compute" }).click();
  await input.fill("x + x");
  await compute.click();
  await expect(panel.getByRole("region", { name: "Simplify result" })).toContainText("2x");
  await input.fill("\\frac{d^{2}}{dx^{2}}\\left(x^3\\right)");
  await compute.click();
  await expect(panel.getByRole("region", { name: "Evaluate: Not supported yet" })).toContainText(
    "beyond what Compute can do",
  );
  await expect(panel.getByRole("button", { name: "Download and compute" })).toHaveCount(0);
  expect(downloads).toEqual([]);
});
