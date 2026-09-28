import { expect, test, type Page } from "@playwright/test";

type StorageProbe = {
  calls: number;
  activated: boolean[];
  reply: "grant" | "deny" | "reject" | "hold";
  release?: (granted: boolean) => void;
};

declare global {
  interface Window {
    storageProbe: StorageProbe;
  }
}

async function mockStorage(
  page: Page,
  options: {
    persisted?: boolean;
    missing?: "storage" | "persisted" | "persist";
    checkFails?: boolean;
    reply?: StorageProbe["reply"];
  } = {},
) {
  await page.addInitScript((options) => {
    window.storageProbe = { calls: 0, activated: [], reply: options.reply ?? "grant" };
    let checkFails = options.checkFails;
    if (options.missing === "storage") {
      Object.defineProperty(navigator, "storage", { value: undefined });
      return;
    }
    Object.defineProperty(navigator.storage, "persisted", {
      value:
        options.missing === "persisted"
          ? undefined
          : async function (this: StorageManager) {
              if (this !== navigator.storage) throw new TypeError("Illegal invocation");
              if (checkFails) {
                checkFails = false;
                throw new Error("Status unavailable");
              }
              return options.persisted || sessionStorage.getItem("test:persistent") === "yes";
            },
    });
    Object.defineProperty(navigator.storage, "persist", {
      value:
        options.missing === "persist"
          ? undefined
          : async function (this: StorageManager) {
              if (this !== navigator.storage) throw new TypeError("Illegal invocation");
              const probe = window.storageProbe;
              probe.calls++;
              probe.activated.push(navigator.userActivation.isActive);
              if (probe.reply === "reject") throw new Error("Request unavailable");
              const granted =
                probe.reply === "hold"
                  ? await new Promise<boolean>((resolve) => (probe.release = resolve))
                  : probe.reply === "grant";
              if (granted) sessionStorage.setItem("test:persistent", "yes");
              return granted;
            },
    });
  }, options);
}

async function openStorage(page: Page) {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Storage", exact: true }).click();
  return page.getByRole("status", { name: "Storage protection" });
}

test("requests protection only on click, waits for the result, and rechecks on reload", async ({
  page,
}) => {
  await mockStorage(page, { reply: "hold" });
  const status = await openStorage(page);
  await expect(status).toContainText("Not protected from automatic cleanup");
  expect(await page.evaluate(() => window.storageProbe.calls)).toBe(0);
  const request = page.getByRole("button", { name: "Protect local data", exact: true });
  await request.click();
  await expect(page.getByRole("button", { name: "Requesting protection…" })).toBeDisabled();
  await expect(status).toContainText("Requesting protection");
  expect(await page.evaluate(() => window.storageProbe.calls)).toBe(1);
  expect(await page.evaluate(() => window.storageProbe.activated)).toEqual([true]);
  await page.evaluate(() => window.storageProbe.release?.(true));
  await expect(status).toContainText("Protected from automatic cleanup");
  await expect(request).toHaveCount(0);
  await expect(page.getByText(/Export workspace backups regularly/)).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Storage", exact: true }).click();
  await expect(status).toContainText("Protected from automatic cleanup");
  expect(await page.evaluate(() => window.storageProbe.calls)).toBe(0);
});

test("an existing browser grant is shown even if requesting is unavailable", async ({ page }) => {
  await mockStorage(page, { persisted: true, missing: "persist" });
  const status = await openStorage(page);
  await expect(status).toContainText("Protected from automatic cleanup");
  await expect(page.getByRole("button", { name: "Protect local data" })).toHaveCount(0);
  expect(await page.evaluate(() => window.storageProbe.calls)).toBe(0);
});

test("denial stays visible and a later explicit request can succeed", async ({ page }) => {
  await mockStorage(page, { reply: "deny" });
  const status = await openStorage(page);
  await page.getByRole("button", { name: "Protect local data", exact: true }).click();
  await expect(status).toContainText("The browser did not grant protection");
  await expect(status).toContainText("may still remove local data");
  await page.getByRole("tab", { name: "Workspace", exact: true }).click();
  await page.getByRole("tab", { name: "Storage", exact: true }).click();
  await expect(status).toContainText("Not protected from automatic cleanup");
  expect(await page.evaluate(() => window.storageProbe.calls)).toBe(1);
  await page.evaluate(() => (window.storageProbe.reply = "grant"));
  await page.getByRole("button", { name: "Protect local data", exact: true }).click();
  await expect(status).toContainText("Protected from automatic cleanup");
});

test("a rejected request reports an error, releases the button, and can be retried", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockStorage(page, { reply: "reject" });
  const status = await openStorage(page);
  await page.getByRole("button", { name: "Protect local data", exact: true }).click();
  await expect(status).toContainText("Couldn't request storage protection");
  await page.evaluate(() => (window.storageProbe.reply = "grant"));
  await page.getByRole("button", { name: "Try protection again", exact: true }).click();
  await expect(status).toContainText("Protected from automatic cleanup");
  expect(errors).toEqual([]);
});

test("a failed status check can be retried without requesting permission", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockStorage(page, { checkFails: true });
  const status = await openStorage(page);
  await expect(status).toContainText("Couldn't check storage protection");
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(status).toContainText("Not protected from automatic cleanup");
  expect(await page.evaluate(() => window.storageProbe.calls)).toBe(0);
  expect(errors).toEqual([]);
});

for (const missing of ["storage", "persisted", "persist"] as const) {
  test(`missing ${missing} API shows an honest unavailable state`, async ({ page }) => {
    await mockStorage(page, { missing });
    const status = await openStorage(page);
    await expect(status).toContainText("Storage protection is unavailable in this browser");
    await expect(page.getByRole("button", { name: "Protect local data" })).toHaveCount(0);
    await expect(page.getByText(/Export workspace backups regularly/)).toBeVisible();
    expect(await page.evaluate(() => window.storageProbe.calls)).toBe(0);
  });
}

test("leaving settings during a request is safe and reopening reads the browser grant", async ({
  page,
}) => {
  await mockStorage(page, { reply: "hold" });
  const status = await openStorage(page);
  await page.getByRole("button", { name: "Protect local data", exact: true }).click();
  await page.getByRole("tab", { name: "Workspace", exact: true }).click();
  await page.evaluate(() => window.storageProbe.release?.(true));
  await page.getByRole("tab", { name: "Storage", exact: true }).click();
  await expect(status).toContainText("Protected from automatic cleanup");
});

test("protection copy wraps and the request is keyboard usable at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await mockStorage(page, { reply: "deny" });
  const status = await openStorage(page);
  const request = page.getByRole("button", { name: "Protect local data", exact: true });
  await request.focus();
  await page.keyboard.press("Enter");
  await expect(status).toContainText("The browser did not grant protection");
  for (const element of [status, page.getByText(/Export workspace backups regularly/), request]) {
    const box = await element.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(await element.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
});

test("the unstubbed browser result agrees with the displayed protection state", async ({
  page,
}) => {
  const status = await openStorage(page);
  const before = await page.evaluate(() => navigator.storage.persisted());
  if (!before) {
    await page.getByRole("button", { name: "Protect local data", exact: true }).click();
    await expect(page.getByRole("button", { name: "Requesting protection…" })).toHaveCount(0);
  }
  const after = await page.evaluate(() => navigator.storage.persisted());
  await expect(status).toContainText(
    after ? "Protected from automatic cleanup" : "The browser did not grant protection",
  );
});
