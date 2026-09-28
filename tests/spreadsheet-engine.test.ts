import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import {
  compareCells,
  measureColumns,
  SpreadsheetEngine,
  StaleViewError,
  ViewSupersededError,
  type SheetSort,
  type Xlsx,
} from "../src/lib/spreadsheet/engine.ts";

// R04: the spreadsheet viewer parses, filters and sorts in a worker. These
// tests pin the engine to the behaviour the viewer had when all of this ran
// on the main thread, and check that workbooks are parsed a sheet at a time.

function workbookDataUrl(sheets: Record<string, unknown[][]>): string {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets))
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  const base64 = XLSX.write(book, { type: "base64", bookType: "xlsx" }) as string;
  return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;
}

/** Real SheetJS, with every read() call's options recorded. */
function recordingXlsx() {
  const reads: Record<string, unknown>[] = [];
  const xlsx: Xlsx = {
    utils: XLSX.utils,
    read: ((data: unknown, options: Record<string, unknown>) => {
      reads.push(options);
      return XLSX.read(data, options);
    }) as Xlsx["read"],
  };
  return { xlsx, reads };
}

async function allRows(engine: SpreadsheetEngine, viewId: number, count: number, columns = 50) {
  return engine.rows(viewId, 0, count, 0, columns);
}

/** The pre-worker viewer's filter and sort, verbatim in behaviour. */
function reference(rows: string[][], query: string, sort: SheetSort): string[][] {
  const needle = query.trim().toLowerCase();
  let source = rows.slice(1);
  if (needle)
    source = source.filter((row) => row.some((cell) => cell.toLowerCase().includes(needle)));
  if (!sort) return source;
  return source
    .slice()
    .sort((a, b) => compareCells(a[sort.column] ?? "", b[sort.column] ?? "") * sort.direction);
}

test("a CSV opens as one sheet with its heading, blank rows and sheet row numbers", async () => {
  const engine = new SpreadsheetEngine(XLSX);
  const { sheets } = engine.open({
    format: "text",
    text: "Product,Revenue\nApples,42\n\nPears,8\n",
  });
  assert.deepEqual(sheets, ["Sheet1"]);
  const layout = engine.layout(0);
  assert.equal(layout.rowCount, 3);
  assert.equal(layout.columnCount, 2);
  assert.deepEqual(layout.headers, ["Product", "Revenue"]);
  assert.deepEqual(layout.numeric, [false, true]);
  const view = await engine.view(0, "", null);
  assert.equal(view.count, 3);
  const window = await allRows(engine, view.viewId, view.count);
  // A blank row stays in place (and keeps the numbering), with no cells.
  assert.deepEqual(window.rows, [["Apples", "42"], [], ["Pears", "8"]]);
  assert.deepEqual(window.sourceRows, [2, 3, 4]);
});

test("a workbook reads only its sheet names up front and parses each sheet once, when shown", async () => {
  const { xlsx, reads } = recordingXlsx();
  const engine = new SpreadsheetEngine(xlsx);
  const { sheets } = engine.open({
    format: "binary",
    dataUrl: workbookDataUrl({
      Sales: [["Product", "Revenue"], ["Apples", 42], [], ["Pears", 8]],
      Notes: [["Note"], ["Quarter complete"]],
      Empty: [],
    }),
  });
  assert.deepEqual(sheets, ["Sales", "Notes", "Empty"]);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].bookSheets, true);

  const notes = engine.layout(1);
  assert.deepEqual(notes.headers, ["Note"]);
  assert.equal(notes.rowCount, 1);
  assert.equal(reads.length, 2);
  assert.deepEqual(reads[1].sheets, ["Notes"]);
  assert.equal(reads[1].cellStyles, false);

  engine.layout(1);
  const view = await engine.view(1, "", null);
  assert.deepEqual((await allRows(engine, view.viewId, 1)).rows, [["Quarter complete"]]);
  assert.equal(reads.length, 2, "a parsed sheet is not parsed again");

  const sales = await engine.view(0, "pears", null);
  assert.deepEqual((await allRows(engine, sales.viewId, sales.count)).sourceRows, [4]);
  assert.deepEqual(reads[2].sheets, ["Sales"]);

  const empty = engine.layout(2);
  assert.equal(empty.rowCount, 0);
  assert.equal(empty.columnCount, 0);
  assert.equal((await engine.view(2, "", null)).count, 0);
  assert.throws(() => engine.layout(3), RangeError);
});

test("an unreadable workbook throws rather than showing an empty sheet", () => {
  const engine = new SpreadsheetEngine(XLSX);
  assert.throws(() =>
    engine.open({ format: "binary", dataUrl: "data:application/zip;base64,UEsDBAoAAAAAA" }),
  );
});

test("filtering matches within one cell, ignores case and surrounding spaces", async () => {
  const engine = new SpreadsheetEngine(XLSX);
  engine.open({
    format: "text",
    text: "A,B\nfoo,bar\nFOOBAR,x\nfo,obar\n",
  });
  const view = await engine.view(0, "  OoB ", null);
  const window = await allRows(engine, view.viewId, view.count);
  assert.deepEqual(window.sourceRows, [3], "a needle spanning two cells does not match");
});

// Deterministic pseudo-random sheets, so a failure reproduces.
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
function randomSheet(seed: number, rows: number): string[][] {
  const next = random(seed);
  const pick = (options: string[]) => options[Math.floor(next() * options.length)];
  const sheet = [["Name", "Amount", "Mixed", "Short"]];
  for (let r = 0; r < rows; r++) {
    sheet.push([
      pick(["alpha", "Alpha", "beta", "gamma", "delta", "Émile", "zeta", ""]) +
        (next() < 0.5 ? ` ${Math.floor(next() * 20)}` : ""),
      pick(["1", "2", "10", "-3", "2.5", "1e3", "", "007"]),
      pick(["10", "9", "x", "X", "", "1.0", "abc", "Infinity"]),
      ...(next() < 0.2 ? [] : [pick(["a", "b", "c"])]),
    ]);
  }
  return sheet;
}

test("filter and sort results match the previous main-thread viewer exactly", async () => {
  for (let seed = 1; seed <= 12; seed++) {
    const sheet = randomSheet(seed, 400);
    const engine = new SpreadsheetEngine(XLSX);
    engine.open({ format: "text", text: XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(sheet)) });
    // SheetJS pads short rows with "", which the old viewer also saw.
    const parsed = [...(await allRows(engine, (await engine.view(0, "", null)).viewId, 1000)).rows];
    const rows = [engine.layout(0).headers, ...parsed];
    const queries = ["", "al", "alp", "1", "ph", " A ", "é", "zzz"];
    const sorts: SheetSort[] = [
      null,
      ...[0, 1, 2, 3, 7].flatMap((column) => [
        { column, direction: 1 as const },
        { column, direction: -1 as const },
      ]),
    ];
    for (const query of queries) {
      for (const sort of sorts) {
        const view = await engine.view(0, query, sort);
        const got = (await allRows(engine, view.viewId, view.count)).rows;
        const expected = reference(rows, query, sort);
        assert.equal(
          view.count,
          expected.length,
          `seed ${seed} "${query}" ${JSON.stringify(sort)}`,
        );
        assert.deepEqual(got, expected, `seed ${seed} "${query}" ${JSON.stringify(sort)}`);
      }
    }
  }
});

test("a narrowing query reuses the previous matches and still gives the full answer", async () => {
  const sheet = randomSheet(99, 2000);
  const csv = XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(sheet));
  const typed = new SpreadsheetEngine(XLSX);
  typed.open({ format: "text", text: csv });
  for (const query of ["a", "al", "alp", "alph", "al", "beta 1", "b"]) {
    const fresh = new SpreadsheetEngine(XLSX);
    fresh.open({ format: "text", text: csv });
    const a = await typed.view(0, query, { column: 1, direction: -1 });
    const b = await fresh.view(0, query, { column: 1, direction: -1 });
    assert.deepEqual(
      (await allRows(typed, a.viewId, a.count)).sourceRows,
      (await allRows(fresh, b.viewId, b.count)).sourceRows,
      query,
    );
  }
});

test("rows are windowed by position and column range", async () => {
  const engine = new SpreadsheetEngine(XLSX);
  engine.open({ format: "text", text: "a,b,c,d\n1,2,3,4\n5,6,7,8\n9,10,11,12\n" });
  const view = await engine.view(0, "", { column: 0, direction: -1 });
  const window = engine.rows(view.viewId, 1, 10, 1, 3);
  assert.equal(window.start, 1);
  assert.equal(window.columnStart, 1);
  assert.deepEqual(window.rows, [
    ["6", "7"],
    ["2", "3"],
  ]);
  assert.deepEqual(window.sourceRows, [3, 2]);
  assert.deepEqual(engine.rows(view.viewId, 5, 9, 0, 4).rows, []);
});

test("only the latest two views answer row requests", async () => {
  const engine = new SpreadsheetEngine(XLSX);
  engine.open({ format: "text", text: "a\n1\n2\n" });
  const first = await engine.view(0, "", null);
  const second = await engine.view(0, "1", null);
  engine.rows(first.viewId, 0, 1, 0, 1);
  const third = await engine.view(0, "2", null);
  assert.throws(() => engine.rows(first.viewId, 0, 1, 0, 1), StaleViewError);
  assert.deepEqual(engine.rows(second.viewId, 0, 5, 0, 1).rows, [["1"]]);
  assert.deepEqual(engine.rows(third.viewId, 0, 5, 0, 1).rows, [["2"]]);
});

test("a newer view request stops the one still running", async () => {
  const csv = XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(randomSheet(5, 5000)));
  function counting() {
    let clock = 0;
    const counter = { yields: 0 };
    const engine = new SpreadsheetEngine(XLSX, {
      // Every checkpoint is past its slice, so each one yields.
      now: () => (clock += 20),
      yieldToEvents: () => {
        counter.yields++;
        return new Promise((resolve) => setTimeout(resolve, 0));
      },
    });
    engine.open({ format: "text", text: csv });
    return { engine, counter };
  }
  const alone = counting();
  await alone.engine.view(0, "b", { column: 1, direction: 1 });
  const olderAlone = counting();
  await olderAlone.engine.view(0, "a", null);
  assert.ok(olderAlone.counter.yields > 3);

  const { engine, counter } = counting();
  const older = engine.view(0, "a", null);
  const newer = engine.view(0, "b", { column: 1, direction: 1 });
  await assert.rejects(older, ViewSupersededError);
  const result = await newer;
  assert.ok(result.count > 0);
  // The older filter stopped at its first checkpoint instead of scanning on.
  assert.ok(counter.yields <= alone.counter.yields + 1, `${counter.yields} yields`);
  // A superseded filter leaves no partial matches behind for a later,
  // narrower query to start from.
  const fresh = new SpreadsheetEngine(XLSX);
  fresh.open({ format: "text", text: csv });
  assert.equal((await engine.view(0, "ab", null)).count, (await fresh.view(0, "ab", null)).count);
});

test("sorted orders are cached per column and direction", async () => {
  const engine = new SpreadsheetEngine(XLSX);
  engine.open({
    format: "text",
    text: XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(randomSheet(7, 300))),
  });
  const a = await engine.view(0, "", { column: 1, direction: 1 });
  const orderA = (await allRows(engine, a.viewId, a.count)).sourceRows;
  await engine.view(0, "", { column: 2, direction: -1 });
  const b = await engine.view(0, "", { column: 1, direction: 1 });
  assert.deepEqual((await allRows(engine, b.viewId, b.count)).sourceRows, orderA);
});

test("a column is as wide as its longest cell anywhere in the sheet, not just the first rows", async () => {
  const rows = [["Id", "Name"], ...Array.from({ length: 500 }, (_, i) => [i + 1, "x"])];
  rows.push([123456789, "a much longer name down at the bottom"]);
  const engine = new SpreadsheetEngine(XLSX);
  engine.open({ format: "text", text: XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(rows)) });
  const [id, name] = engine.layout(0).widths;
  assert.ok(id >= 9 * 8.2 + 26, `id ${id}`);
  assert.ok(name >= 36 * 7.6 + 26, `name ${name}`);
});

test("column measurement: figures, headings and width bounds", () => {
  const rows = [
    ["Revenue", "Name", "Mixed", "Blank", "A very long heading that goes on and on and on and on"],
    ["$1,200.50", "Short", "12", "", "x"],
    ["12%", "", "n/a", "", "y"],
    ["", "Lorem ipsum dolor sit amet ".repeat(8), "3", "", "z"],
    ["-7", "", "", "", ""],
  ];
  const { numeric, widths } = measureColumns(rows, 6);
  assert.deepEqual(numeric, [true, false, false, false, false, false]);
  assert.ok(widths.every((width) => width >= 64 && width <= 360));
  assert.equal(widths[1], 360, "long text is capped");
  assert.equal(widths[4], 360, "a long heading is capped too");
  assert.ok(widths[3] >= 64 && widths[3] < 120, "an empty column still fits its label");
  const wide = measureColumns([["名前"], ["東京都千代田区"]], 1).widths[0];
  const narrow = measureColumns([["Name"], ["Tokyo-to Chi"]], 1).widths[0];
  assert.ok(wide > narrow, "wide characters count double");
});
