import { test, expect, type Page } from "@playwright/test";
import * as XLSX from "xlsx";
import JSZip from "jszip";

async function storedFile(page: Page, name: string) {
  return page.evaluate(
    (name) =>
      new Promise<import("../../src/lib/persistence").PersistedFile>((resolve, reject) => {
        const request = indexedDB.open("localdox");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(["files", "file-bodies"], "readonly");
          const files = transaction.objectStore("files").getAll();
          const bodies = transaction.objectStore("file-bodies").getAll();
          transaction.oncomplete = () => {
            const file = files.result.find((file) => file.name === name);
            const body = bodies.result.find(
              (body) => body.workspaceId === file?.workspaceId && body.id === file?.id,
            );
            resolve(file && body ? { ...file, data: body.data } : file);
            db.close();
          };
        };
      }),
    name,
  );
}
async function upload(
  page: Page,
  name: string,
  buffer: Buffer,
  mimeType = "application/octet-stream",
) {
  await page.locator('input[type="file"]').first().setInputFiles({ name, buffer, mimeType });
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
  await page.goto("/");
});

test("Markdown tables fit the content column, wrap at spaces, and never break words", async ({
  page,
}) => {
  await upload(
    page,
    "widths.md",
    Buffer.from(
      "# Widths\n\nSome prose.\n\n| Name | Description |\n| --- | --- |\n| unbreakableidentifierabcdefghijklmnopqrstuvwxyz | Several words that can wrap at spaces in a narrow column |\n",
    ),
  );
  const wrap = page.locator(".docs-table-wrap");
  await expect(wrap).toBeVisible();
  const cell = wrap.locator("td").first();
  expect(await cell.evaluate((node) => getComputedStyle(node).overflowWrap)).toBe("normal");
  expect(await cell.evaluate((node) => getComputedStyle(node).whiteSpace)).toBe("normal");
  const paragraphWidth = await page
    .locator(".docs-prose p")
    .first()
    .evaluate((node) => node.getBoundingClientRect().width);
  const wrapWidth = await wrap.evaluate((node) => node.getBoundingClientRect().width);
  expect(Math.abs(wrapWidth - paragraphWidth)).toBeLessThan(1);
  await expect(page.getByRole("checkbox", { name: "Wrap words" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset widths" })).toHaveCount(0);
});

test("CSV editing preserves strings, quotes pasted cells, cancels, and persists after reload", async ({
  page,
}) => {
  await upload(
    page,
    "edit.csv",
    Buffer.from("Code,Name\r\n001,Apples\r\n002,Pears\r\n"),
    "text/csv",
  );
  await page.getByRole("button", { name: "Edit spreadsheet", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Cell A2", exact: true })).toHaveValue("001");
  await page.getByRole("textbox", { name: "Cell B2", exact: true }).fill('Fresh, "apples"');
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Edit spreadsheet", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Cell B2", exact: true })).toHaveValue("Apples");
  await page.getByRole("textbox", { name: "Cell B2", exact: true }).fill('Fresh, "apples"');
  await page.getByRole("textbox", { name: "Cell A3", exact: true }).evaluate((node) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "003\tBananas\n004\tPlums");
    node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: clipboard }));
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect
    .poll(async () => (await storedFile(page, "edit.csv"))?.content)
    .toContain('"Fresh, ""apples"""');
  const saved = await storedFile(page, "edit.csv");
  expect(saved.data).toBeUndefined();
  expect(saved.content).toContain("001");
  expect(saved.content).toContain("004,Plums");
  expect(saved.size).toBe(Buffer.byteLength(saved.content));
  await page.reload();
  await page.getByRole("button", { name: "Edit spreadsheet", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Cell B2", exact: true })).toHaveValue(
    'Fresh, "apples"',
  );
});

test("XLSX updates original cells across sheets and retains package parts", async ({ page }) => {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Name", "Count"],
    ["Apple", 4],
    [],
    ["Pear", 7],
    ...Array.from({ length: 2000 }, (_, index) => [`Row ${index}`, index]),
  ]);
  sheet.C2 = { t: "n", f: "B2*2", v: 8 };
  sheet["!ref"] = "A1:C2004";
  XLSX.utils.book_append_sheet(book, sheet, "Fruit");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Keep"], ["Original"]]), "Notes");
  const zip = await JSZip.loadAsync(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
  zip.file("custom/preserve.txt", "Unrelated package data");
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  await upload(page, "edit.xlsx", bytes);
  await page.getByRole("button", { name: "Edit spreadsheet", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Cell C2", exact: true })).toHaveValue("=B2*2");
  expect(await page.locator('input[aria-label^="Cell "]').count()).toBeLessThan(200);
  await page.getByRole("textbox", { name: "Cell B4", exact: true }).fill("99");
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("textbox", { name: "Cell A2", exact: true }).fill("Edited note");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect
    .poll(async () => (await storedFile(page, "edit.xlsx"))?.data)
    .not.toBe(`data:application/octet-stream;base64,${bytes.toString("base64")}`);
  await expect(page.getByRole("button", { name: "Edit spreadsheet", exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const file = await storedFile(page, "edit.xlsx");
      if (!file?.data) return "";
      const saved = XLSX.read(Buffer.from(file.data.split(",")[1], "base64"));
      return saved.Sheets.Notes.A2.v;
    })
    .toBe("Edited note");
  const saved = await storedFile(page, "edit.xlsx");
  const buffer = Buffer.from(saved.data.split(",")[1], "base64");
  const result = XLSX.read(buffer);
  expect(result.Sheets.Fruit.B4.v).toBe(99);
  expect(result.Sheets.Fruit.C2.f).toBe("B2*2");
  expect(await (await JSZip.loadAsync(buffer)).file("custom/preserve.txt")!.async("string")).toBe(
    "Unrelated package data",
  );
  expect(saved.size).toBe(buffer.length);
});

test("DOCX text edits retain runs, tables, and other ZIP entries", async ({ page }) => {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table value</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/><w:sectPr/></w:body></w:document>',
  );
  zip.file("word/preserved.txt", "keep exactly");
  await upload(page, "edit.docx", await zip.generateAsync({ type: "nodebuffer" }));
  await page.getByRole("button", { name: "Edit document", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Paragraph 1", exact: true })).toHaveValue(
    "Hello world",
  );
  await page.getByRole("textbox", { name: "Paragraph 1", exact: true }).fill("Hello new world");
  await page.getByRole("textbox", { name: "Paragraph 2", exact: true }).fill("Updated table");
  await page
    .getByRole("textbox", { name: "Paragraph 3", exact: true })
    .fill("New text\nSecond line");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit document", exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const saved = await storedFile(page, "edit.docx");
      if (!saved?.data) return "";
      const result = await JSZip.loadAsync(Buffer.from(saved.data.split(",")[1], "base64"));
      return result.file("word/document.xml")!.async("string");
    })
    .toContain("Updated table");
  const saved = await storedFile(page, "edit.docx");
  const result = await JSZip.loadAsync(Buffer.from(saved.data.split(",")[1], "base64"));
  const body = await result.file("word/document.xml")!.async("string");
  expect(body).toContain("w:b");
  expect(body).toContain("w:tbl");
  expect(body).toContain("w:br");
  expect(await result.file("word/preserved.txt")!.async("string")).toBe("keep exactly");
  await page.reload();
  await page.getByRole("button", { name: "Edit document", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Paragraph 1", exact: true })).toHaveValue(
    "Hello new world",
  );
});

test("wide sheets keep the DOM bounded and keyboard navigation crosses virtual columns", async ({
  page,
}) => {
  const columns = Array.from({ length: 120 }, (_, index) => `Column ${index}`);
  await upload(
    page,
    "wide.csv",
    Buffer.from(
      [columns.join(","), ...Array.from({ length: 200 }, () => columns.join(","))].join("\n"),
    ),
    "text/csv",
  );
  await page.getByRole("button", { name: "Edit spreadsheet", exact: true }).click();
  const first = page.getByRole("textbox", { name: "Cell A1", exact: true });
  await expect(first).toHaveValue("Column 0");
  expect(await page.locator('input[aria-label^="Cell "]').count()).toBeLessThan(600);
  await first.focus();
  for (let column = 0; column < 30; column++) await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: "Cell AE1", exact: true })).toBeFocused();
  await page.keyboard.type("Updated");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(async () => (await storedFile(page, "wide.csv"))?.content).toContain("Updated");
});

test("a shared formula save error keeps the draft and original workbook", async ({ page }) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Value"], [2]]), "Sheet1");
  const zip = await JSZip.loadAsync(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
  const source = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  zip.file(
    "xl/worksheets/sheet1.xml",
    source.replace(
      '<c r="A2"><v>2</v></c>',
      '<c r="A2"><f t="shared" si="0" ref="A2:A3">1+1</f><v>2</v></c>',
    ),
  );
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  await upload(page, "formula.xlsx", bytes);
  await page.getByRole("button", { name: "Edit spreadsheet", exact: true }).click();
  await page.getByRole("textbox", { name: "Cell A2", exact: true }).fill("42");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("shared or array formula");
  await expect(page.getByRole("textbox", { name: "Cell A2", exact: true })).toHaveValue("42");
  const file = await storedFile(page, "formula.xlsx");
  expect(Buffer.from(file.data!.split(",")[1], "base64")).toEqual(bytes);
});
