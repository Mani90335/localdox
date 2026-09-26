// What a multi-file selection can be exported as.
//
// The rule these cover is that a batch offers the *intersection* of what its
// documents can do, never the union. Offering Word for a selection that is half
// spreadsheets means half the export fails and the reader finds out by counting
// the files that arrived — so a mixed selection collapses to the original bytes
// and the menu says "Download" instead of "Export All".
//
// `exportDocuments` itself drives real downloads and belongs in the browser;
// what is pure — and what decides the menu the reader sees — is here.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  availableFormats,
  canConvert,
  isBatchable,
  sharedFormats,
  type ExportFormat,
} from "../src/services/markdown-export/index.ts";

const markdown = { kind: "markdown" as const, content: "# Hi" };
const text = { kind: "text" as const, content: "plain" };
const mermaid = { kind: "mermaid" as const, content: "graph TD; A-->B;" };
/** A document the app only reads: bytes, no markdown to convert. */
const spreadsheet = {
  kind: "spreadsheet" as const,
  content: "",
  data: "data:application/vnd.ms-excel;base64,AAAA",
};
const pdf = { kind: "pdf" as const, content: "", data: "data:application/pdf;base64,AAAA" };

test("a text-bearing document can be converted", () => {
  assert.equal(canConvert(markdown), true);
  assert.equal(canConvert(text), true);
  assert.equal(canConvert(mermaid), true);
});

test("a binary the app only reads cannot be converted", () => {
  assert.equal(canConvert(spreadsheet), false);
  assert.equal(canConvert(pdf), false);
});

test("an unconvertible document offers only its original bytes", () => {
  assert.deepEqual(availableFormats(spreadsheet), ["original"]);
});

test("a convertible document offers the writers plus the original", () => {
  const formats = availableFormats(markdown);
  assert.ok(formats.includes("docx"));
  assert.ok(formats.includes("pdf"));
  assert.ok(formats.includes("original"));
});

test("an empty selection offers nothing", () => {
  assert.deepEqual(sharedFormats([]), []);
});

test("a selection of convertible documents offers the conversions", () => {
  const formats = sharedFormats([markdown, text, mermaid]);
  assert.ok(formats.includes("docx"));
  assert.ok(formats.includes("markdown"));
  assert.ok(formats.length > 1, "more than one format means the menu says Export All");
});

test("one unconvertible document collapses the whole selection to Download", () => {
  // The intersection, not the union — this is the case the rule exists for.
  assert.deepEqual(sharedFormats([markdown, text, spreadsheet]), ["original"]);
  assert.deepEqual(sharedFormats([spreadsheet, pdf]), ["original"]);
});

test("a selection of one behaves like that document alone, minus batching", () => {
  assert.deepEqual(
    sharedFormats([markdown]),
    availableFormats(markdown).filter(isBatchable),
  );
});

test("PDF is not offered for a batch", () => {
  // It hands off to the browser's modal print dialog: a batch would queue one
  // dialog per file. An item that can only ever produce an error is worse than
  // no item, so it is filtered out rather than refused on click.
  assert.ok(!sharedFormats([markdown, text]).includes("pdf"));
  assert.equal(isBatchable("pdf"), false);
});

test("every other format batches", () => {
  const batchable: ExportFormat[] = ["docx", "markdown", "html", "original"];
  for (const format of batchable) assert.equal(isBatchable(format), true, format);
});

test("the single-document menu still offers PDF", () => {
  // Only the batch drops it; exporting one document through the print dialog
  // is the normal path and must stay available.
  assert.ok(availableFormats(markdown).includes("pdf"));
});

test("a mixed selection never offers more than one format", () => {
  // What the sidebar keys off: `formats.length > 1` is how it decides between
  // "Export All" with a submenu and a plain "Download Selected".
  assert.equal(sharedFormats([markdown, spreadsheet]).length, 1);
});
