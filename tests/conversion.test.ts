import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { initSync } from "@firecrawl/anydoc-wasm";
import { convertDocument } from "../src/services/doc-conversion/anydoc-adapter.ts";
import {
  canConvertToMarkdown,
  markdownCopyName,
  parseDerivation,
  remapDerivation,
  sameSource,
  describeConversionError,
  latestMarkdownCopies,
} from "../src/services/doc-conversion/types.ts";
import { parseSharedFiles, serializeSharedFiles } from "../src/lib/workspace/share.ts";
import {
  persistence,
  newWorkspaceRecord,
  parseWorkspaceImport,
  serializeWorkspace,
} from "../src/lib/workspace/persistence.ts";
import { indexedDB, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  remarkConvertedHtml,
  convertedFootnotes,
  convertedAnchorMap,
} from "../src/services/doc-conversion/markdown-compat.ts";

Object.assign(globalThis, { indexedDB, IDBKeyRange });
initSync({
  module: await readFile(
    new URL("../node_modules/@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm", import.meta.url),
  ),
});
const fixture = async (name: string) => ({
  id: "source",
  name,
  content: "",
  data: `data:application/octet-stream;base64,${(await readFile(new URL(`./fixtures/anydoc/${name}`, import.meta.url))).toString("base64")}`,
});

test("published WASM converts representative formats without modifying source bytes", async () => {
  for (const name of [
    "handmade-rich.docx",
    "handmade-tables.docx",
    "text.pdf",
    "pres.pptx",
    "sheet.xlsx",
    "sheet.xls",
    "handmade-utf16.csv",
    "text.odt",
    "sheet.ods",
    "pres.odp",
    "text.rtf",
    "book.epub",
    "text.doc",
    "pres.ppt",
    "handmade-sheet.xlsb",
  ]) {
    const source = await fixture(name);
    const original = structuredClone(source);
    assert.equal(canConvertToMarkdown(source), true, name);
    const result = await convertDocument(source);
    assert.ok(result.markdown.trim(), name);
    assert.match(result.inputHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(source, original);
  }
});

test("scanned/mixed PDFs, encrypted and damaged files return actionable failures", async () => {
  for (const [name, code] of [
    ["handmade-scanned.pdf", "needsOcr"],
    ["handmade-mixed.pdf", "needsOcr"],
    ["encrypted--errors.odt", "encrypted"],
    ["truncated--errors.docx", "malformed"],
  ]) {
    await assert.rejects(convertDocument(await fixture(name)), (error: unknown) => {
      const failure = error as { code: string; pages?: number[] };
      assert.equal(failure.code, code);
      assert.ok(describeConversionError(failure).length);
      if (code === "needsOcr") assert.ok(failure.pages?.length);
      return true;
    });
  }
});

test("copy naming, eligibility and late-result guards preserve edits", () => {
  assert.equal(markdownCopyName("Report.pdf", ["report.md", "Report (2).md"]), "Report (3).md");
  const source = { id: "s", name: "report.pdf", content: "", data: "original" };
  assert.equal(sameSource({ ...source, data: "edited" }, source), false);
  assert.equal(sameSource({ ...source, deletedAt: Date.now() }, source), false);
  assert.equal(canConvertToMarkdown({ ...source, name: "image.png" }), false);
});

test("provenance round trips and derivative-only shares never retain a live source id", async () => {
  const source = await fixture("text.pdf");
  const result = await convertDocument(source);
  const derivedFrom = {
    sourceFileId: source.id,
    sourceName: source.name,
    inputHash: result.inputHash,
    converter: "anydoc" as const,
    converterVersion: "0.2.4",
    convertedAt: 123,
  };
  const derivative = { id: "copy", name: "text.md", content: result.markdown, derivedFrom };
  const workspace = newWorkspaceRecord("Conversion");
  workspace.files = [source, derivative];
  await persistence.putWorkspace(workspace);
  assert.deepEqual((await persistence.getWorkspace(workspace.id))?.files, workspace.files);
  assert.deepEqual(
    parseWorkspaceImport(serializeWorkspace(workspace)).files[1].derivedFrom,
    derivedFrom,
  );
  workspace.files[1] = {
    ...derivative,
    derivedFrom: { ...derivedFrom, sourceName: "renamed.pdf" },
  };
  await persistence.putWorkspace(workspace);
  assert.equal(
    (await persistence.getWorkspace(workspace.id))?.files[1].derivedFrom?.sourceName,
    "renamed.pdf",
  );
  assert.equal(
    parseSharedFiles(serializeSharedFiles([derivative], "W")).files[0].derivedFrom?.sourceFileId,
    undefined,
  );
  assert.equal(
    parseSharedFiles(serializeSharedFiles([source, derivative], "W")).files[1].derivedFrom
      ?.sourceFileId,
    source.id,
  );
  assert.equal(
    remapDerivation(derivedFrom, new Map([[source.id, "new-source"]]))?.sourceFileId,
    "new-source",
  );
  assert.equal(remapDerivation(derivedFrom, new Map())?.sourceFileId, undefined);
  assert.equal(parseDerivation({ ...derivedFrom, inputHash: "bad" }), undefined);

  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, ...args) {
    const request = put.call(this, value, ...args);
    if (this.name === "workspace-summaries")
      request.addEventListener("success", () => this.transaction.abort());
    return request;
  };
  try {
    await assert.rejects(
      persistence.putWorkspace({
        ...workspace,
        files: [...workspace.files, { ...derivative, id: "failed-copy" }],
      }),
    );
  } finally {
    IDBObjectStore.prototype.put = put;
  }
  const stored = await persistence.getWorkspace(workspace.id);
  assert.equal(stored?.files.length, 2);
  assert.deepEqual(stored?.files[0], source);
});

test("converted tables and anchors render without enabling arbitrary HTML", () => {
  const source =
    '| A | B |\n| --- | --- |\n| one<br>two | value |\n\n<a id="target"></a>\n\n<script>alert(1)</script>\n\n<img src="https://example.com/tracker" onerror="alert(1)">';
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      remarkPlugins: [remarkGfm, [remarkConvertedHtml, { prefix: "safe-" }]] as never,
      children: source,
    }),
  );
  assert.match(html, /one<br\/>two/);
  assert.match(html, /id="safe-target"/);
  assert.doesNotMatch(html, /<script>|<img /);
});

test("footnotes and explicit anchors remain addressable on paginated copies", () => {
  const body =
    '# First\nText[^1].\n\n# Second\n<a id="detail"></a>\n\n[^1]: Note body\n    continued.\n\n```\n[^2]: not a footnote\n```';
  const notes = convertedFootnotes(body);
  assert.match(notes, /Note body\n {4}continued/);
  assert.doesNotMatch(notes, /not a footnote/);
  const html = renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: [remarkGfm], children: "Text[^1].\n\n" + notes }),
  );
  assert.match(html, /data-footnote-ref/);
  assert.match(html, /Note body/);
  assert.deepEqual(
    convertedAnchorMap([{ id: "second", content: '<a id="detail"></a>' }], "safe-"),
    {
      owners: { "safe-detail": "second" },
      targets: { detail: "safe-detail" },
    },
  );
});

test("latest copy selection follows conversion time, not file order", () => {
  const derivedFrom = {
    sourceFileId: "s",
    sourceName: "file.pdf",
    converter: "anydoc" as const,
    converterVersion: "0.2.4",
    inputHash: "a".repeat(64),
    convertedAt: 1,
  };
  const old = { id: "old", name: "file.md", content: "", derivedFrom };
  const recent = { ...old, id: "new", derivedFrom: { ...derivedFrom, convertedAt: 2 } };
  assert.equal(latestMarkdownCopies([recent, old]).get("s")?.id, "new");
  assert.equal(latestMarkdownCopies([old, { ...recent, deletedAt: 3 }]).get("s")?.id, "old");
});

test("conversion commits reject another tab's revision instead of overwriting it", async () => {
  const workspace = newWorkspaceRecord("Concurrent");
  workspace.files = [{ id: "original", name: "source.csv", content: "A,B\n1,2" }];
  await persistence.putWorkspace(workspace);
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("localdox");
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("workspaces", "readwrite");
      const store = tx.objectStore("workspaces");
      const request = store.get(workspace.id);
      request.onsuccess = () =>
        store.put({ ...request.result, name: "Another tab", revision: "remote-revision" });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => reject(tx.error);
    };
  });
  await assert.rejects(
    persistence.putWorkspace(
      {
        ...workspace,
        files: [...workspace.files, { id: "derivative", name: "source.md", content: "Converted" }],
      },
      { rejectStale: true },
    ),
    /another tab/,
  );
  const stored = await persistence.getWorkspace(workspace.id);
  assert.equal(stored?.name, "Another tab");
  assert.deepEqual(stored?.files, workspace.files);
});
