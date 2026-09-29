import { test, expect } from "@playwright/test";

const picture = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="blue"/></svg>',
);

test("binary import/reload uses Blobs; mounted image URLs are revoked on navigation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("localdox:prefs"))
      localStorage.setItem(
        "localdox:prefs",
        JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
      );
    const active = new Map<string, string>();
    Object.assign(window, { __binaryUrls: active });
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (blob instanceof Blob) active.set(url, blob.type);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      active.delete(url);
      revoke(url);
    };
  });
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([
      { name: "photo.svg", mimeType: "image/svg+xml", buffer: picture },
      { name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Notes\n\nBody") },
    ]);
  const image = page.getByRole("img", { name: "photo.svg", exact: true });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(40);
  const stored = () =>
    page.evaluate(
      () =>
        new Promise<{ id: string; blob: boolean; size: number; type: string; bytes: number[] }>(
          (resolve, reject) => {
            const req = indexedDB.open("localdox");
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
              const db = req.result;
              const tx = db.transaction("files");
              const files = tx.objectStore("files").getAll();
              tx.oncomplete = async () => {
                db.close();
                const data = files.result.find((file) => file.name === "photo.svg")?.data;
                try {
                  resolve({
                    id: data?.id,
                    blob: data?.blob instanceof Blob,
                    size: data?.blob.size,
                    type: data?.blob.type,
                    bytes: Array.from(new Uint8Array(await data.blob.arrayBuffer())),
                  });
                } catch (error) {
                  reject(error);
                }
              };
            };
          },
        ),
    );
  const before = await stored();
  expect(before.blob).toBe(true);
  expect(before.size).toBe(picture.length);
  expect(before.type).toBe("image/svg+xml");
  expect(Buffer.from(before.bytes)).toEqual(picture);
  const url = (await image.getAttribute("src"))!;
  await page
    .getByRole("button", { name: /^notes /i })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Notes", exact: true }).first()).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        (url) => (window as unknown as { __binaryUrls: Map<string, string> }).__binaryUrls.has(url),
        url,
      ),
    )
    .toBe(false);
  await page
    .getByRole("button", { name: /photo.*Image/i })
    .first()
    .click();
  await expect(image).toHaveAttribute("src", /^blob:/);
  expect(await image.getAttribute("src")).not.toBe(url);
  await page.reload();
  await expect(image).toBeVisible();
  expect((await stored()).id).toBe(before.id);
  expect(Buffer.from((await stored()).bytes)).toEqual(picture);
});
