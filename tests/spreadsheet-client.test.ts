import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { SpreadsheetEngine } from "../src/lib/spreadsheet/engine.ts";
import {
  handleSpreadsheetRequest,
  type SpreadsheetRequest,
  type SpreadsheetResponse,
} from "../src/lib/spreadsheet/protocol.ts";
import {
  createLocalSpreadsheetClient,
  createWorkerSpreadsheetClient,
  SpreadsheetClosedError,
  SpreadsheetRequestError,
} from "../src/lib/spreadsheet/client.ts";
import {
  blocksFor,
  columnOffsets,
  columnWindow,
  fitColumns,
  OVERSCAN_COLUMNS,
  OVERSCAN_ROWS,
  ROW_HEIGHT,
  rowNumberWidth,
  rowWindow,
} from "../src/lib/spreadsheet/grid-window.ts";

// R04: the viewer's worker protocol settles every request, and the grid only
// renders the rows and columns in view.

const CSV = "Product,Revenue\nApples,42\nPears,8\nPlums,15\n";

/** Answers like spreadsheet.worker.ts: a handler per message, replies as tasks. */
class FakeWorker extends EventTarget {
  posted: SpreadsheetRequest[] = [];
  terminated = false;
  listeners = 0;
  hold = false;
  private readonly engine = new SpreadsheetEngine(XLSX);

  postMessage(request: SpreadsheetRequest) {
    this.posted.push(request);
    if (this.hold) return;
    void handleSpreadsheetRequest(this.engine, request).then((response) =>
      setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: response }))),
    );
  }
  terminate() {
    this.terminated = true;
  }
  override addEventListener(...args: Parameters<EventTarget["addEventListener"]>) {
    this.listeners++;
    super.addEventListener(...args);
  }
  override removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>) {
    this.listeners--;
    super.removeEventListener(...args);
  }
}

test("protocol: every request gets exactly one typed reply", async () => {
  const engine = new SpreadsheetEngine(XLSX);
  const reply = (request: SpreadsheetRequest) => handleSpreadsheetRequest(engine, request);
  assert.deepEqual(await reply({ reqId: 1, type: "open", source: { format: "text", text: CSV } }), {
    reqId: 1,
    type: "opened",
    sheets: ["Sheet1"],
  });
  const layout = (await reply({ reqId: 2, type: "layout", sheet: 0 })) as Extract<
    SpreadsheetResponse,
    { type: "layout" }
  >;
  assert.equal(layout.layout.rowCount, 3);
  const bad = await reply({ reqId: 3, type: "layout", sheet: 9 });
  assert.equal(bad.type, "error");
  assert.equal(bad.reqId, 3);
  const view = (await reply({
    reqId: 4,
    type: "view",
    sheet: 0,
    query: "pe",
    sort: null,
  })) as Extract<SpreadsheetResponse, { type: "view" }>;
  assert.equal(view.view.count, 1);
  await reply({ reqId: 5, type: "view", sheet: 0, query: "a", sort: null });
  await reply({ reqId: 6, type: "view", sheet: 0, query: "l", sort: null });
  const stale = await reply({
    reqId: 7,
    type: "rows",
    viewId: view.view.viewId,
    start: 0,
    end: 5,
    columnStart: 0,
    columnEnd: 2,
  });
  assert.deepEqual(stale, { reqId: 7, type: "stale" });
  const unknown = await reply({ reqId: 8, type: "nope" } as unknown as SpreadsheetRequest);
  assert.equal(unknown.type, "error");
  const unreadable = await reply({
    reqId: 9,
    type: "open",
    source: { format: "binary", dataUrl: "data:application/zip;base64,UEsDBAoAAAAAA" },
  });
  assert.equal(unreadable.type, "error");
});

test("protocol: an overtaken view replies superseded", async () => {
  let clock = 0;
  const engine = new SpreadsheetEngine(XLSX, { now: () => (clock += 20) });
  const rows = [["n"], ...Array.from({ length: 5000 }, (_, i) => [`row ${i}`])];
  engine.open({ format: "text", text: XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(rows)) });
  const older = handleSpreadsheetRequest(engine, {
    reqId: 1,
    type: "view",
    sheet: 0,
    query: "row",
    sort: null,
  });
  const newer = handleSpreadsheetRequest(engine, {
    reqId: 2,
    type: "view",
    sheet: 0,
    query: "row 1",
    sort: null,
  });
  assert.deepEqual(await older, { reqId: 1, type: "superseded" });
  assert.equal((await newer).type, "view");
});

test("worker client: a full round trip, with replies matched by request", async () => {
  const worker = new FakeWorker();
  const client = createWorkerSpreadsheetClient(worker, () => assert.fail("no failure"));
  assert.deepEqual(await client.open({ format: "text", text: CSV }), ["Sheet1"]);
  const layout = await client.layout(0);
  assert.deepEqual(layout.headers, ["Product", "Revenue"]);
  const [a, b] = await Promise.all([
    client.view(0, "", { column: 1, direction: -1 }),
    client.view(0, "plu", null),
  ]);
  // Both were sent back to back; the first was overtaken by the second.
  assert.equal(a, null);
  assert.ok(b);
  assert.equal(b.count, 1);
  const window = await client.rows(b.viewId, 0, 10, 0, 2);
  assert.deepEqual(window?.rows, [["Plums", "15"]]);
  const sorted = await client.view(0, "", { column: 1, direction: -1 });
  assert.deepEqual((await client.rows(sorted!.viewId, 0, 10, 1, 2))?.rows, [["42"], ["15"], ["8"]]);
  await client.view(0, "a", null);
  await client.view(0, "e", null);
  assert.equal(await client.rows(b.viewId, 0, 10, 0, 2), null, "a dropped view answers null");
  await assert.rejects(client.layout(4), SpreadsheetRequestError);
  client.close();
  assert.equal(worker.terminated, true);
  assert.equal(worker.listeners, 0);
});

test("worker client: a worker error rejects everything pending and reports once", async () => {
  const worker = new FakeWorker();
  let failures = 0;
  const client = createWorkerSpreadsheetClient(worker, () => failures++);
  await client.open({ format: "text", text: CSV });
  worker.hold = true;
  const pending = [client.layout(0), client.view(0, "", null), client.rows(1, 0, 5, 0, 1)];
  worker.dispatchEvent(new Event("error"));
  worker.dispatchEvent(new Event("messageerror"));
  for (const request of pending) await assert.rejects(request, SpreadsheetClosedError);
  assert.equal(failures, 1);
  assert.equal(worker.terminated, true);
  assert.equal(worker.listeners, 0);
  assert.equal(client.closed, true);
  await assert.rejects(client.layout(0), SpreadsheetClosedError);
});

test("worker client: close rejects requests in flight and ignores late replies", async () => {
  const worker = new FakeWorker();
  const client = createWorkerSpreadsheetClient(worker, () => assert.fail("close is not a failure"));
  worker.hold = true;
  const opening = client.open({ format: "text", text: CSV });
  client.close();
  await assert.rejects(opening, SpreadsheetClosedError);
  worker.dispatchEvent(
    new MessageEvent("message", { data: { reqId: 1, type: "opened", sheets: ["late"] } }),
  );
});

test("local client: runs the engine on this thread, loading SheetJS once", async () => {
  let loads = 0;
  const client = createLocalSpreadsheetClient(async () => {
    loads++;
    return XLSX;
  });
  assert.deepEqual(await client.open({ format: "text", text: CSV }), ["Sheet1"]);
  const view = await client.view(0, "", { column: 0, direction: 1 });
  assert.deepEqual((await client.rows(view!.viewId, 0, 3, 0, 1))?.rows, [
    ["Apples"],
    ["Pears"],
    ["Plums"],
  ]);
  assert.equal(loads, 1);
  client.close();
  await assert.rejects(client.layout(0), SpreadsheetClosedError);
});

test("grid: the row window covers the view plus overscan, clamped to the sheet", () => {
  assert.deepEqual(rowWindow(0, 360, 1000), { first: 0, last: 10 + OVERSCAN_ROWS });
  const scrolled = rowWindow(ROW_HEIGHT * 500, 360, 1000);
  assert.deepEqual(scrolled, { first: 500 - OVERSCAN_ROWS, last: 510 + OVERSCAN_ROWS });
  assert.deepEqual(rowWindow(ROW_HEIGHT * 995, 360, 1000).last, 1000);
  assert.deepEqual(rowWindow(0, 360, 0), { first: 0, last: 0 });
  // A stale scroll position past a shrunken (filtered) sheet renders nothing.
  assert.deepEqual(rowWindow(ROW_HEIGHT * 900, 360, 5), { first: 5, last: 5 });
});

test("grid: narrow sheets stretch to fill; wide ones keep natural widths", () => {
  const stretched = fitColumns([100, 50, 50], 1003);
  assert.equal(
    stretched.reduce((a, b) => a + b, 0),
    1003,
  );
  assert.ok(stretched[0] > stretched[1] * 1.9 && stretched[0] < stretched[1] * 2.1);
  assert.deepEqual(fitColumns([300, 300], 400), [300, 300]);
  assert.deepEqual(fitColumns([], 500), []);
});

test("grid: the column window follows horizontal scroll past the pinned row numbers", () => {
  const widths = Array.from({ length: 300 }, (_, c) => (c % 2 ? 100 : 150));
  const offsets = columnOffsets(widths);
  assert.equal(offsets[300], 150 * 150 + 150 * 100);
  const start = columnWindow(offsets, 0, 1000, 48);
  assert.equal(start.first, 0);
  // 952px of data: columns 0..7 are at least partly visible.
  assert.equal(start.last, 8 + OVERSCAN_COLUMNS);
  const middle = columnWindow(offsets, 12_500, 1000, 48);
  // Columns 100.. start at 12,500.
  assert.equal(middle.first, 100 - OVERSCAN_COLUMNS);
  assert.ok(middle.last - middle.first <= 8 + 2 * OVERSCAN_COLUMNS + 1);
  const end = columnWindow(offsets, offsets[300] - 952, 1000, 48);
  assert.equal(end.last, 300);
  assert.deepEqual(columnWindow(columnOffsets([]), 0, 1000, 48), { first: 0, last: 0 });
});

test("grid: row number column and block arithmetic", () => {
  assert.equal(rowNumberWidth(10), 48);
  assert.ok(rowNumberWidth(1_048_575) > 48);
  assert.deepEqual(blocksFor({ first: 0, last: 0 }, 128), []);
  assert.deepEqual(blocksFor({ first: 0, last: 128 }, 128), [0]);
  assert.deepEqual(blocksFor({ first: 120, last: 260 }, 128), [0, 1, 2]);
  assert.deepEqual(blocksFor({ first: 256, last: 257 }, 128), [2]);
});
