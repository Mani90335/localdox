import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "msedge" });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto("http://127.0.0.1:4175/exams");
  await page.getByRole("heading", { name: "Create an exam to start" }).waitFor();
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.screenshot({ path: "test-results/workspaces-light.png", fullPage: true });
  await page.getByRole("button", { name: "Learning materials (0)" }).click();
  await page.screenshot({ path: "test-results/workspaces-materials.png", fullPage: true });
  await page.getByRole("button", { name: "Back to exams" }).click();
  await page.getByRole("heading", { name: "Create an exam to start" }).waitFor();
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({ path: "test-results/workspaces-dark.png", fullPage: true });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.screenshot({ path: "test-results/workspaces-mobile.png", fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error("Mobile overflow");
  await page.getByRole("button", { name: "New exam", exact: true }).first().click();
  await page.getByRole("dialog", { name: "New exam" }).waitFor();
  await page.screenshot({ path: "test-results/workspaces-dialog.png", fullPage: true });
  console.log("Captured light, dark, materials, mobile and dialog views; no horizontal overflow at 320px.");
} finally { await browser.close(); }
