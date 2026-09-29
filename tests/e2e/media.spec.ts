import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

const picture = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="blue"/></svg>',
);
function recording() {
  const buffer = Buffer.alloc(44 + 1600);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(1600, 40);
  return buffer;
}
async function download(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download HTML + Media", exact: true }).click();
  const result = await pending;
  return { name: result.suggestedFilename(), bytes: await readFile((await result.path())!) };
}
async function storedFiles(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Array<{ id: string; name: string; content: string }>>((resolve, reject) => {
        const request = indexedDB.open("localdox");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("files", "readonly");
          const files = tx.objectStore("files").getAll();
          tx.oncomplete = () => {
            resolve(files.result);
            db.close();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("localdox:prefs"))
      localStorage.setItem(
        "localdox:prefs",
        JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
      );
  });
  await page.goto("/");
});

test("mixed local media plays and all sections export to a ZIP with exact, deduplicated assets", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const clip = await readFile("tests/fixtures/media/clip.webm");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([
      {
        name: "media.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(
          '# First section\n\n![Picture](photo.svg)\n\n![Clip](clip.webm)\n\n![Voice](voice.wav)\n\n# Last section\n\nEnd of the complete document.\n\n![Again](photo.svg)\n\n<video controls poster="photo.svg"><source src="clip.webm" type="video/webm"></video>\n\n```mermaid\ngraph LR\n A --> B\n```\n',
        ),
      },
      { name: "photo.svg", mimeType: "image/svg+xml", buffer: picture },
      { name: "clip.webm", mimeType: "video/webm", buffer: clip },
      { name: "voice.wav", mimeType: "audio/wav", buffer: recording() },
    ]);
  await expect(page.getByRole("img", { name: "Picture", exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("video")
        .first()
        .evaluate((node: HTMLVideoElement) => node.readyState),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      page
        .locator("audio")
        .first()
        .evaluate((node: HTMLAudioElement) => node.readyState),
    )
    .toBeGreaterThan(0);
  await expect(page.getByText("End of the complete document.", { exact: true })).not.toBeVisible();
  const result = await download(page);
  expect(result.name).toBe("media.zip");
  const zip = await JSZip.loadAsync(result.bytes);
  const assets = Object.keys(zip.files).filter(
    (name) => !zip.files[name].dir && name !== "index.html",
  );
  expect(assets).toHaveLength(3);
  expect(
    await zip.file(assets.find((name) => name.endsWith("photo.svg"))!)!.async("nodebuffer"),
  ).toEqual(picture);
  expect(
    await zip.file(assets.find((name) => name.endsWith("clip.webm"))!)!.async("nodebuffer"),
  ).toEqual(clip);
  const html = await zip.file("index.html")!.async("string");
  expect(html).toContain("End of the complete document.");
  expect(html).toContain('<video controls=""');
  expect(html).toContain('<audio controls=""');
  expect(html).toContain('poster="media/');
  expect(html).toContain('<source src="media/');
  expect(html).toContain("data:image/svg+xml;charset=utf-8,");
  expect(html).not.toContain("blob:");
  expect(html).not.toContain("workspace-artifact.local");
  expect(html).not.toContain("Download HTML");
  expect(errors).toEqual([]);
  const exported = await page.context().newPage();
  await exported.route("https://export.test/**", async (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    const entry = zip.file(name);
    if (!entry) return route.abort();
    await route.fulfill({
      body: await entry.async("nodebuffer"),
      contentType: name.endsWith(".html")
        ? "text/html"
        : name.endsWith(".svg")
          ? "image/svg+xml"
          : name.endsWith(".webm")
            ? "video/webm"
            : "audio/wav",
    });
  });
  await exported.goto("https://export.test/index.html");
  await expect(exported.getByText("End of the complete document.", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      exported
        .locator("video")
        .first()
        .evaluate((node: HTMLVideoElement) => node.readyState),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      exported
        .locator("img")
        .first()
        .evaluate((node: HTMLImageElement) => node.naturalWidth),
    )
    .toBeGreaterThan(0);
  await exported.screenshot({ path: "/tmp/localdox-media-export.png", fullPage: true });
  await exported.close();
});

test("web-only media downloads styled HTML without fetching remote assets during export", async ({
  page,
}) => {
  const remote = "https://media.example.test";
  await page.route(`${remote}/**`, (route) => route.abort());
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "online.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        `# Online\n\n![Image](${remote}/photo.png)\n\n![Video](${remote}/movie.mp4)\n\n![Audio](${remote}/voice.mp3)\n\n<video controls src="${remote}/extra.mp4" onerror="alert(1)"></video>\n\n<script>alert(1)</script>\n`,
      ),
    });
  await expect(page.locator("video")).toHaveCount(2);
  await expect(page.locator("audio")).toHaveCount(1);
  const result = await download(page);
  expect(result.name).toBe("online.html");
  const html = result.bytes.toString();
  expect(html).toContain("<style>");
  expect(html).toContain(`${remote}/movie.mp4`);
  expect(html).toContain(`${remote}/voice.mp3`);
  expect(html).not.toContain("onerror");
  expect(html).not.toContain("<script");
});

test("attachment picker imports into the workspace, inserts a durable reference, and persists after reload", async ({
  page,
}) => {
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "attach.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Attachments\n\nHello."),
    });
  await expect(
    page.getByRole("button", { name: "Download HTML + Media", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Options", exact: true }).first().click();
  await page.getByText("Edit", { exact: true }).click();
  await page.locator("#markdown-source").focus();
  await page
    .locator("#markdown-source")
    .evaluate((node: HTMLTextAreaElement) =>
      node.setSelectionRange(node.value.length, node.value.length),
    );
  await page.getByRole("button", { name: "Attach media or files", exact: true }).click();
  await page
    .getByLabel("Upload attachments", { exact: true })
    .setInputFiles({ name: "uploaded.svg", mimeType: "image/svg+xml", buffer: picture });
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator("#markdown-source")).toHaveValue(/workspace-artifact\.local/);
  await page.getByRole("button", { name: /Done.*Preview/ }).click();
  await expect(page.getByRole("img", { name: "uploaded.svg", exact: true })).toBeVisible();
  await expect.poll(async () => (await storedFiles(page)).length).toBe(2);
  await page.reload();
  await expect(page.getByRole("img", { name: "uploaded.svg", exact: true })).toBeVisible();
  expect((await download(page)).name).toBe("attach.zip");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: /Web page/ }).click();
  const menuDownload = await pending;
  expect(menuDownload.suggestedFilename()).toBe("attach.zip");
  const menuZip = await JSZip.loadAsync(await readFile((await menuDownload.path())!));
  expect(Object.keys(menuZip.files).some((name) => name.endsWith("uploaded.svg"))).toBe(true);
});

test("missing attachments report an error and do not emit a broken export", async ({ page }) => {
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "missing.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Missing\n\n![Missing clip](missing.webm)"),
    });
  await expect(page.getByText(/Couldn’t find missing.webm/)).toBeVisible();
  await page.getByRole("button", { name: "Download HTML + Media", exact: true }).click();
  await expect(page.getByText(/Could not export: attachment/)).toBeVisible();
});

test("nested folders and cross-workspace Markdown embeds render and bundle their own media", async ({
  page,
}) => {
  // Let the application initialize its versioned IndexedDB schema first.
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "seed.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Seed"),
    });
  await expect.poll(async () => (await storedFiles(page)).length).toBe(1);
  const blue = picture.toString("base64");
  const red = picture.toString().replace("blue", "red");
  await page.evaluate(
    async ({ blue, red }) => {
      const pictureFile = (id: string, data: string) => ({
        id,
        name: "photo.svg",
        content: "",
        kind: "image",
        data: `data:image/svg+xml;base64,${data}`,
        mimeType: "image/svg+xml",
        folderId: "media",
        size: 120,
      });
      const current = {
        id: "media-current",
        name: "Project",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        folders: [
          { id: "docs", name: "Docs", createdAt: 0 },
          { id: "media", name: "Media", createdAt: 0 },
        ],
        files: [
          {
            id: "guide",
            name: "guide.md",
            kind: "markdown",
            folderId: "docs",
            content:
              "# Across workspaces\n\n![Local](../Media/photo.svg)\n\n![Other](Library/Media/photo.svg)\n\n![[Library/intro.md]]",
          },
          pictureFile("blue", blue),
        ],
        bookmarks: [],
        highlights: [],
        saved: [],
        ui: { activeFileId: "guide", expanded: {}, sidebarCollapsed: false, scrollTop: 0 },
      };
      const library = {
        ...current,
        id: "media-library",
        name: "Library",
        folders: [{ id: "media", name: "Media", createdAt: 0 }],
        files: [
          pictureFile("red", btoa(red)),
          {
            id: "intro",
            name: "intro.md",
            content: "## Nested document\n\n![Nested red](Media/photo.svg)",
          },
        ],
        ui: { ...current.ui, activeFileId: "intro" },
      };
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("localdox");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(
            ["workspaces", "files", "file-bodies", "workspace-summaries"],
            "readwrite",
          );
          for (const workspace of [current, library]) {
            const { files, ...metadata } = workspace;
            tx.objectStore("workspaces").put({
              ...metadata,
              fileIds: files.map((file) => file.id),
              revision: crypto.randomUUID(),
            });
            tx.objectStore("workspace-summaries").put({
              id: workspace.id,
              name: workspace.name,
              createdAt: workspace.createdAt,
              updatedAt: workspace.updatedAt,
              docCount: files.length,
            });
            for (const { data, ...file } of files as { id: string; data?: string }[]) {
              tx.objectStore("files").put({ ...file, workspaceId: workspace.id });
              if (data)
                tx.objectStore("file-bodies").put({ workspaceId: workspace.id, id: file.id, data });
            }
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => reject(tx.error);
        };
      });
      const prefs = JSON.parse(localStorage.getItem("localdox:prefs") || "{}");
      localStorage.setItem(
        "localdox:prefs",
        JSON.stringify({ ...prefs, lastWorkspaceId: current.id }),
      );
    },
    { blue, red },
  );
  await page.reload();
  await expect(page.getByRole("img", { name: "Local", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Other", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Nested red", exact: true })).toBeVisible();
  const result = await download(page);
  const zip = await JSZip.loadAsync(result.bytes);
  const images = Object.keys(zip.files).filter((name) => name.endsWith("photo.svg"));
  expect(images).toHaveLength(2);
  expect(await zip.file("index.html")!.async("string")).toContain("Nested document");
  expect(await Promise.all(images.map((name) => zip.file(name)!.async("string")))).toEqual(
    expect.arrayContaining([picture.toString(), red]),
  );
});
