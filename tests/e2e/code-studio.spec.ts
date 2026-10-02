import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/code-studio");
});

test("runs edited JavaScript, displays memory, and invalidates a stale trace", async ({ page }) => {
  const editor = page.getByRole("textbox", { name: "Code editor" });
  await editor.fill("const values = [4, 9];\nvalues.push(16);\nconsole.log(values);");
  await page.getByRole("button", { name: /Run code/ }).click();
  await expect(page.getByText("Recorded execution", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Last step", exact: true }).click();
  await expect(page.getByLabel("Program output")).toHaveText("[4,9,16]\n");
  await page.getByRole("tab", { name: "Memory", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Global");
  await expect(page.getByRole("tabpanel")).toContainText("16");
  await editor.fill("console.log(2);");
  await expect(page.getByText("Code changed. Run it to update the visualization.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play visualization" })).toBeDisabled();
});

test("renders Mermaid references and plays a guided swap", async ({ page }) => {
  await page.getByRole("button", { name: /An array, one place/ }).click();
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Exchange the ends" })).toBeVisible();
  await page.getByRole("tab", { name: "Connections" }).click();
  await expect(page.locator(".cs-mermaid svg")).toBeVisible();
  await expect(page.locator(".cs-mermaid")).toContainText("numbers");
  await page.getByRole("tab", { name: "Computer" }).click();
  await expect(page.getByText("A small model of a big machine.")).toBeVisible();
});

test("retains completed checkpoints and draft on reload", async ({ page }) => {
  await page.getByRole("button", { name: /Foundations 0/ }).click();
  await page.getByRole("button", { name: "The first value in numbers", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "That's right" })).toBeVisible();
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByRole("button", { name: /Foundations 1/ })).toBeVisible();
});

test("syntax errors and infinite loops leave the UI usable", async ({ page }) => {
  test.setTimeout(70000);
  const editor = page.getByRole("textbox", { name: "Code editor" });
  await editor.fill("const =;");
  await page.getByRole("button", { name: /Run code/ }).click();
  await expect(page.getByRole("alert")).toContainText("Unexpected token");
  await editor.fill("while (true) {}");
  await page.getByRole("button", { name: /Run code/ }).click();
  await expect(
    page
      .getByText("Recorded execution", { exact: true })
      .or(page.getByRole("alert").filter({ hasText: "Stopped after 8 seconds" })),
  ).toBeVisible({ timeout: 35000 });
  if (await page.getByText("Recorded execution", { exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Last step", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Execution limit reached" })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /Run code/ })).toBeEnabled();
});

test("Python and C++ report missing runner without faking execution", async ({ page }) => {
  await page.route("**/trace", (route) => route.abort());
  for (const language of ["python", "cpp"]) {
    await page.getByRole("combobox", { name: "Programming language" }).selectOption(language);
    await page.getByRole("button", { name: /Run code/ }).click();
    await expect(page.getByRole("alert")).toContainText("needs the isolated runner");
    await expect(page.getByText("Guided animation", { exact: true })).toBeVisible();
  }
});

for (const scenario of [
  {
    language: "python",
    source: "values = [4, 9]\nvalues.append(16)\nprint(values)",
    output: "[4, 9, 16]",
  },
  {
    language: "cpp",
    source:
      '#include <iostream>\n#include <vector>\nint main() {\n  std::vector<int> values{4, 9};\n  values.push_back(16);\n  std::cout << values[2] << "\\n";\n  return 0;\n}',
    output: "16",
  },
]) {
  test(`records real ${scenario.language} through the isolated runner`, async ({ page }) => {
    test.skip(process.env.CODE_STUDIO_RUNNER_TESTS !== "1", "Requires the local Docker runner.");
    await page
      .getByRole("combobox", { name: "Programming language" })
      .selectOption(scenario.language);
    await page.getByRole("textbox", { name: "Code editor" }).fill(scenario.source);
    await page.getByRole("button", { name: /Run code/ }).click();
    await expect(page.getByText("Recorded execution", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Last step", exact: true }).click();
    await expect(page.getByLabel("Program output")).toContainText(scenario.output);
    await page.getByRole("tab", { name: "Memory", exact: true }).click();
    await expect(page.getByRole("tabpanel")).toContainText("values");
    await expect(page.getByRole("tabpanel")).toContainText("16");
  });
}

test("execution worker cannot access workspace storage or the network", async ({ page }) => {
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("studio-test.invalid")) sent.push(r.url());
  });
  await page
    .getByRole("textbox", { name: "Code editor" })
    .fill(
      'try { localStorage.getItem("test"); } catch (e) { console.log("no storage"); }\ntry { const req = new XMLHttpRequest(); req.open("GET", "https://studio-test.invalid/private", false); req.send(); } catch (e) { console.log("network blocked"); }\nconsole.log(typeof document);',
    );
  await page.getByRole("button", { name: /Run code/ }).click();
  await expect(page.getByText("Recorded execution", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Last step", exact: true }).click();
  await expect(page.getByLabel("Program output")).toContainText("no storage");
  await expect(page.getByLabel("Program output")).toContainText("network blocked");
  await expect(page.getByLabel("Program output")).toContainText("undefined");
  expect(sent).toHaveLength(0);
});

test("mobile layout and operation dialog remain accessible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("button", { name: "Show foundations" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Show foundations" }).click();
  await page.getByRole("button", { name: "Operation library", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
