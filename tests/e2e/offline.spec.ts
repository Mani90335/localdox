import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";

// A11: a populated workspace reopens with no network and the HTTP cache
// disabled (the audit's reproduction failed with ERR_INTERNET_DISCONNECTED),
// optional features can be downloaded for offline use up front, and Settings
// reports what the service worker actually holds.

// The worker and its manifest exist only in the production build.
test.skip(!process.env.PLAYWRIGHT_PRODUCTION, "Requires the production build");

type Manifest = { version: string; shell: string[]; files: [string, number, string | null][] };

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
});

const indicator = (page: Page) =>
  page.getByTestId("save-indicator").filter({ visible: true }).first();

async function importNote(page: Page, name: string, body: string) {
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name, mimeType: "text/markdown", buffer: Buffer.from(body) });
}

async function waitUntilControlled(page: Page) {
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, {
    timeout: 30_000,
  });
}

/** The manifest the deployed worker was built with. */
async function manifest(page: Page): Promise<Manifest> {
  const source = await page.evaluate(() => fetch("/sw.js").then((r) => r.text()));
  return JSON.parse(source.slice(source.indexOf("=") + 1, source.indexOf(";\n")));
}

/** Cache keys holding a URL path, across the worker's caches. */
async function cachedPaths(page: Page) {
  return page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) {
        paths.push(new URL(request.url).pathname);
      }
    }
    return paths;
  });
}

/**
 * No network at all, as in the audit: offline emulation, the HTTP cache off,
 * and every request that still reaches the network (including the worker's
 * own fetches) aborted.
 */
async function goOffline(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await context.setOffline(true);
  const reached: string[] = [];
  await context.route("**/*", (route) => {
    reached.push(route.request().url());
    return route.abort("internetdisconnected");
  });
  return reached;
}

async function goOnline(context: BrowserContext) {
  await context.unrouteAll({ behavior: "ignoreErrors" });
  await context.setOffline(false);
}

async function openStorageSettings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("tab", { name: "Storage", exact: true }).click();
  return page.getByRole("status", { name: "Offline access" });
}

async function createPdf(context: BrowserContext) {
  const source = await context.newPage();
  await source.setContent("<p>Offline fixture page</p>");
  const buffer = await source.pdf();
  await source.close();
  return buffer;
}

test("a workspace reopens and saves offline with the HTTP cache disabled", async ({
  context,
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await importNote(page, "offline-notes.md", "# Offline notes\n\nWritten while online.\n");
  await expect(page.getByRole("heading", { name: "Offline notes" }).first()).toBeVisible();
  await expect(indicator(page)).toHaveText("Saved on this device");
  await waitUntilControlled(page);
  const { shell, files } = await manifest(page);
  const cached = new Set(await cachedPaths(page));
  const uncached = files.find(([url]) => url.startsWith("/assets/") && !cached.has(url))![0];

  await goOffline(context, page);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  const failed: string[] = [];
  page.on("requestfailed", (request) => failed.push(request.url()));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Offline notes" }).first()).toBeVisible();
  await expect(page.getByText("Written while online.", { exact: true })).toBeVisible();
  // Nothing needed for startup was missing.
  expect(failed.filter((url) => shell.some((path) => url.endsWith(path)))).toEqual([]);

  // The network really is unreachable, including from the worker: a build file
  // it has not cached goes through it to the network and fails.
  const reachable = await page.evaluate(
    (url) =>
      fetch(url).then(
        () => true,
        () => false,
      ),
    uncached,
  );
  expect(reachable).toBe(false);

  // Editing offline still commits to IndexedDB and survives another reload.
  await page.getByRole("button", { name: "Options", exact: true }).first().click();
  await page.getByText("Edit", { exact: true }).click();
  await page.locator("#markdown-source").fill("# Offline notes\n\nEdited without a network.\n");
  await page.getByRole("button", { name: "Done · Preview", exact: true }).click();
  await expect(page.getByText("Edited without a network.", { exact: true })).toBeVisible();
  await expect(indicator(page)).toHaveText("Saved on this device");
  await page.reload();
  await expect(page.getByText("Edited without a network.", { exact: true })).toBeVisible();

  await goOnline(context);
  await page.reload();
  await expect(page.getByText("Edited without a network.", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("an offline deep link opens Settings, which reports offline readiness", async ({
  context,
  page,
}) => {
  // Settings is never opened online: its lazy chunk must come from the shell.
  await page.goto("/");
  await waitUntilControlled(page);

  await goOffline(context, page);
  const documents: { url: string; fromWorker: boolean }[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "document") {
      documents.push({ url: response.url(), fromWorker: response.fromServiceWorker() });
    }
  });
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Storage", exact: true }).click();
  const status = page.getByRole("status", { name: "Offline access" });
  await expect(status).toContainText("Ready offline");
  await expect(page.getByRole("button", { name: /^Download all features \(/ })).toBeVisible();
  expect(documents).toEqual([{ url: expect.stringMatching(/\/settings$/), fromWorker: true }]);
});

test("a fresh install imports and reads new local files offline", async ({ context, page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Nothing is opened online: only the empty app, then the network goes away.
  await page.goto("/");
  await waitUntilControlled(page);
  await goOffline(context, page);
  await page.reload();

  await importNote(page, "field-notes.md", "# Field notes\n\nImported without a network.\n");
  await expect(page.getByText("Imported without a network.", { exact: true })).toBeVisible();
  await expect(indicator(page)).toHaveText("Saved on this device");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "readings.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ station: "north ridge", readings: [3, 5, 8] })),
    });
  // Non-Markdown files render through the lazily loaded document viewer.
  await page.getByRole("button", { name: /^readings/ }).click();
  await expect(page.getByText("north ridge").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("north ridge").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("optional features download for offline use, and a PDF then opens offline", async ({
  context,
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const pdf = await createPdf(context);
  await page.goto("/");
  await waitUntilControlled(page);
  const { files, shell } = await manifest(page);
  const pdfWorker = files.find(([url]) => /\/pdf\.worker[^/]*\.m?js$/.test(url))![0];
  expect(shell).not.toContain(pdfWorker);
  expect(await cachedPaths(page)).not.toContain(pdfWorker);

  const status = await openStorageSettings(page);
  await expect(status).toContainText("Ready offline");
  const download = page.getByRole("button", { name: /^Download all features \(/ });
  await expect(download).toBeEnabled();
  // Hold the PDF worker (fetched by the service worker) to observe progress.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await context.route(`**${pdfWorker}`, async (route) => {
    await held;
    await route.continue();
  });
  await download.click();
  await expect(page.getByRole("button", { name: "Downloading…", exact: true })).toBeDisabled();
  const progress = page.getByRole("progressbar", { name: "Offline download" });
  await expect(progress).toBeVisible();
  // The live region announces the download, not every byte count.
  await expect(status).toContainText("Downloading for offline use…");
  await expect(status).not.toContainText(/\d+(\.\d+)? [KM]?B/);
  release();
  await expect(page.getByText(/Every feature is available offline/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("button", { name: /^Download all features/ })).toHaveCount(0);
  // Non-hashed files are cached under `?v=` keys, so compare by path.
  const cached = new Set(await cachedPaths(page));
  expect(files.map(([url]) => url).filter((url) => !cached.has(url))).toEqual([]);

  await goOffline(context, page);
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "offline.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.locator(".pdf-page-area .textLayer")).toContainText("Offline fixture page");
  expect(errors).toEqual([]);
});

/** The manifest version of the registration's active or waiting worker. */
async function workerVersion(page: Page, which: "active" | "waiting") {
  return page.evaluate(async (which) => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const worker = registration?.[which];
    if (!worker) return null;
    const channel = new MessageChannel();
    const reply = new Promise<{ result: { version: string } }>((resolve) => {
      channel.port1.onmessage = (event) => resolve(event.data);
    });
    worker.postMessage({ type: "status" }, [channel.port2]);
    return (await reply).result.version;
  }, which);
}

const hosts: { close: () => Promise<unknown> }[] = [];
test.afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

/**
 * The build as static hosting serves it (firebase.json): files as they are,
 * every other path rewritten to the SPA shell. `overrides` replaces a file's
 * body, which is how a test deploys a new worker: the browser fetches worker
 * scripts itself, out of reach of Playwright's request routing.
 */
async function staticHost(overrides: Map<string, string>) {
  const root = path.resolve(".output/public");
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
    ".woff2": "font/woff2",
  };
  const server = createServer(async (request, response) => {
    let file = decodeURIComponent(new URL(request.url!, "http://host").pathname);
    let body: string | Buffer | undefined = overrides.get(file);
    if (body === undefined) {
      const resolved = path.join(root, file);
      try {
        if (!resolved.startsWith(root + path.sep)) throw new Error("Outside the root");
        body = await readFile(resolved);
      } catch {
        file = "/_shell.html";
        body = await readFile(path.join(root, file));
      }
    }
    response.writeHead(200, {
      "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

test("a new version waits while a tab is open, then replaces the old shell", async ({
  context,
  page,
}) => {
  const overrides = new Map<string, string>();
  const host = await staticHost(overrides);
  hosts.push(host);
  await page.goto(`${host.origin}/`);
  await importNote(page, "upgrade.md", "# Upgrade\n\nKept across versions.\n");
  await expect(indicator(page)).toHaveText("Saved on this device");
  await waitUntilControlled(page);
  const { version } = await manifest(page);
  expect(await workerVersion(page, "active")).toBe(version);

  // Deploy the next version: same files, a different worker version.
  const next = "e2e-next-version";
  const worker = await readFile(path.resolve(".output/public/sw.js"), "utf8");
  overrides.set("/sw.js", worker.replace(`"version":"${version}"`, `"version":"${next}"`));
  await page.evaluate(async () => {
    const registration = (await navigator.serviceWorker.getRegistration("/"))!;
    await registration.update();
    const worker = registration.installing;
    if (!worker) return;
    await new Promise<void>((resolve) =>
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" || worker.state === "redundant") resolve();
      }),
    );
  });

  // The open tab keeps its worker; the new one waits with its shell cached.
  expect(await workerVersion(page, "waiting")).toBe(next);
  expect(await workerVersion(page, "active")).toBe(version);
  expect(await page.evaluate(() => caches.keys())).toEqual(
    expect.arrayContaining([`localdox-shell-${version}`, `localdox-shell-${next}`]),
  );
  // Reloading the only tab doesn't swap versions under it either.
  await page.reload();
  await expect(page.getByText("Kept across versions.", { exact: true })).toBeVisible();
  expect(await workerVersion(page, "active")).toBe(version);
  expect(await workerVersion(page, "waiting")).toBe(next);

  // Once no tab uses the old version, the new one takes over and cleans up.
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(`${host.origin}/`);
  await expect.poll(() => workerVersion(reopened, "active"), { timeout: 20_000 }).toBe(next);
  await expect
    .poll(() => reopened.evaluate(() => caches.keys()))
    .not.toContain(`localdox-shell-${version}`);
  // Unchanged content-hashed files were kept for the new version.
  expect(await reopened.evaluate(() => caches.keys())).toContain("localdox-assets");

  await goOffline(context, reopened);
  await reopened.goto(`${host.origin}/settings`);
  await expect(reopened.getByRole("tab", { name: "Storage", exact: true })).toBeVisible();
  await reopened.goto(`${host.origin}/`);
  await expect(reopened.getByText("Kept across versions.", { exact: true })).toBeVisible();
});

test("a failed first install is reported and can be retried", async ({ context, page }) => {
  // The shell HTML is fetched by the worker during install; fail it once.
  let failures = 0;
  await context.route("**/_shell.html", (route) => {
    if (failures++ === 0) return route.abort("internetdisconnected");
    return route.continue();
  });
  await page.goto("/");
  const status = await openStorageSettings(page);
  await expect(status).toContainText("Offline access couldn't be set up");
  await page.getByRole("button", { name: "Set up offline access again", exact: true }).click();
  await expect(status).toContainText("Ready offline");
  expect(failures).toBe(2);
});

test("browsers without service workers get an honest unavailable state", async ({ page }) => {
  await page.addInitScript(() => {
    delete (Navigator.prototype as unknown as Record<string, unknown>).serviceWorker;
  });
  await page.goto("/");
  const status = await openStorageSettings(page);
  await expect(status).toContainText("Offline access isn't available in this browser");
  await expect(page.getByRole("button", { name: /Download all features/ })).toHaveCount(0);
});
