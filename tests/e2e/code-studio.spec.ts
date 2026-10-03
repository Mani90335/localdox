import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/code-studio");
});

test("runs edited JavaScript, displays memory, and invalidates a stale trace", async ({ page }) => {
  test.setTimeout(60000);
  const editor = page.getByRole("textbox", { name: "Code editor" });
  await editor.fill("const values = [4, 9];\nvalues.push(16);\nconsole.log(values);");
  await page.getByRole("button", { name: /Run code/ }).click();
  // Compilation and execution have separate 20s and 8s limits on a cold load.
  await expect(page.getByText("Recorded execution", { exact: true })).toBeVisible({
    timeout: 35000,
  });
  await page.getByRole("button", { name: "Last step", exact: true }).click();
  await expect(page.getByLabel("Program output")).toHaveText("[4,9,16]\n");
  await page.getByRole("button", { name: "Look inside the computer" }).click();
  await page.getByRole("tab", { name: "Memory", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText("values");
  await expect(page.getByRole("tabpanel")).toContainText("0x1");
  await expect(page.getByRole("tabpanel")).toContainText("16");
  await editor.fill("console.log(2);");
  await expect(page.getByText("Code changed. Run it to update the visualization.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play visualization" })).toBeDisabled();
});

test("renders Mermaid references and plays a guided swap", async ({ page }) => {
  await page.getByRole("button", { name: "Show foundations" }).click();
  await page.getByRole("button", { name: /An array, one place/ }).click();
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Exchange the ends" })).toBeVisible();
  await page.getByRole("button", { name: "Look inside the computer" }).click();
  await page.getByRole("tab", { name: "Connections" }).click();
  await expect(page.locator(".cs-mermaid svg")).toBeVisible();
  await expect(page.locator(".cs-mermaid")).toContainText("numbers");
  await page.getByRole("tab", { name: "Computer" }).click();
  await expect(page.getByText("Simplified computer model")).toBeVisible();
});

test("retains completed checkpoints and draft on reload", async ({ page }) => {
  await page.getByRole("button", { name: "Last step", exact: true }).click();
  await page.getByRole("button", { name: "20", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "That's right" })).toBeVisible();
  await page.waitForTimeout(600);
  await page.reload();
  await page.getByRole("button", { name: "Show foundations" }).click();
  await expect(page.getByRole("button", { name: /Learn step by step 1/ })).toBeVisible();
});

test("a beginner follows the pictures with one caption and moves to the next lesson", async ({
  page,
}, testInfo) => {
  await expect(page.getByRole("heading", { name: "From Enter to an answer" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Memory", exact: true })).toHaveCount(0);
  await expect(
    page.getByText("If number were 10 instead of 21, what would this program show?"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Remember 21", exact: true })).toBeVisible();
  await expect(page.getByLabel("A number becomes an answer")).toContainText("21");
  await expect(
    page.locator(".cs-lesson-intro, .cs-editor-guide, .cs-word-help, .cs-below-workbench"),
  ).toHaveCount(0);
  await expect(page.locator(".cs-caption p")).toHaveCount(0);
  await expect(page.locator(".cs-executing-line")).toContainText("const number = 21");
  await page.screenshot({
    path: testInfo.outputPath("beginner-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Double the number", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous step", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Remember 21", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Last step", exact: true }).click();
  await expect(page.getByLabel("Program output")).toHaveText("42\n");
  await page.getByRole("button", { name: "10", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Try again" })).toBeVisible();
  await page.getByRole("button", { name: "20", exact: true }).click();
  await page.getByRole("button", { name: "Next lesson", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "An array, one place at a time", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Watch it happen", exact: true })).toBeVisible();
});

test("changing a lesson's language keeps the guided lesson; editing keeps a personal draft", async ({
  page,
}) => {
  await page.getByRole("combobox", { name: "Programming language" }).selectOption("python");
  await expect(page.getByRole("tab", { name: "Watch it happen", exact: true })).toBeVisible();
  const editor = page.getByRole("textbox", { name: "Code editor" });
  await expect(editor).toContainText("number = 21");
  await editor.fill("print(123)");
  await expect(page.getByRole("heading", { name: "See what your code does." })).toBeVisible();
  await page.waitForTimeout(600);
  await page.reload();
  await expect(editor).toContainText("print(123)");
  await expect(page.getByRole("heading", { name: "See what your code does." })).toBeVisible();
});

test("syntax errors and infinite loops leave the UI usable", async ({ page }) => {
  test.setTimeout(70000);
  const editor = page.getByRole("textbox", { name: "Code editor" });
  await editor.fill("const =;");
  await page.getByRole("button", { name: /Run code/ }).click();
  await expect(page.getByRole("alert")).toContainText("Unexpected token", { timeout: 35000 });
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
    await page.getByRole("button", { name: "Look inside the computer" }).click();
    await page.getByRole("tab", { name: "Memory", exact: true }).click();
    await expect(page.getByRole("tabpanel")).toContainText("values");
    await expect(page.getByRole("tabpanel")).toContainText("16");
    await expect(page.getByRole("tabpanel")).not.toContainText("std::__ioinit");
    await expect(page.getByRole("tabpanel")).not.toContainText("_GLOBAL__");
    await expect(page.getByRole("tabpanel")).not.toContainText("Not yet initialized");
    await expect(page.getByRole("tabpanel")).toContainText("0x1");
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

test("mobile layout and operation dialog remain accessible", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("button", { name: "Show foundations" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show foundations" })).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Code editor" })).toBeVisible();
  await expect(page.getByLabel("A number becomes an answer")).toBeVisible();
  await expect
    .poll(async () =>
      page.locator(".cs-run-button").evaluate((el) => {
        const button = el.getBoundingClientRect();
        const pane = el.closest(".cs-editor-pane")!.getBoundingClientRect();
        return button.top >= pane.top && button.bottom <= pane.bottom;
      }),
    )
    .toBe(true);
  await expect
    .poll(async () => page.locator(".cs-stage").evaluate((el) => el.getBoundingClientRect().height))
    .toBeGreaterThan(250);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("beginner-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Show foundations" }).click();
  await page.getByRole("button", { name: "Operation library", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("stored tree scene draws real links and supports backward playback", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "Show foundations" }).click();
  await page.getByRole("button", { name: /Trees & priorities/ }).click();
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  const scene = page.getByRole("img", { name: "Connected values", exact: true });
  await expect(scene).toBeVisible();
  await expect(scene.locator(".cs-graph-value")).toHaveCount(3);
  await expect(scene.locator(".cs-connection")).toHaveCount(2);
  await expect(scene).toContainText("0x1");
  await expect(scene).toContainText("0x2");
  await expect(scene).toContainText("0x3");
  await page.screenshot({
    path: testInfo.outputPath("tree-scene.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Previous step", exact: true }).click();
  await expect(scene.locator(".cs-graph-value")).toHaveCount(2);
  await expect(scene.locator(".cs-connection")).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(scene.locator(".cs-graph-value")).toHaveCount(3);
});
