/*
 * The spreadsheet viewer's data side: parsing, filtering, sorting and handing
 * out windows of rows. It runs in a worker (spreadsheet.worker.ts), so none of
 * this touches the main thread; the viewer only ever holds the rows on screen.
 *
 * Workbooks are parsed one sheet at a time, when that sheet is first shown.
 * A six-sheet workbook no longer pays for five sheets nobody opened.
 */
import type * as XLSXModule from "xlsx";

export type Xlsx = Pick<typeof XLSXModule, "read" | "utils">;

export type SpreadsheetSource =
  { format: "text"; text: string } | { format: "binary"; dataUrl: string } | { format: "buffer"; buffer: ArrayBuffer } | { format: "blob"; blob: Blob };

export type SheetSort = { column: number; direction: 1 | -1 } | null;

export interface SheetLayout {
  sheet: number;
  name: string;
  /** Data rows, not counting the heading row. */
  rowCount: number;
  columnCount: number;
  headers: string[];
  /** Columns whose sampled cells are all figures; they are set right-aligned. */
  numeric: boolean[];
  /** Natural column widths in CSS px, estimated from the heading and a sample. */
  widths: number[];
}

export interface ViewInfo {
  viewId: number;
  sheet: number;
  /** Rows in the view after filtering. */
  count: number;
}

export interface RowWindow {
  viewId: number;
  start: number;
  columnStart: number;
  /** Cells [columnStart, columnEnd) of each row; shorter rows stay short. */
  rows: string[][];
  /** 1-based row numbers in the sheet (the heading is row 1). */
  sourceRows: number[];
}

/** A view request was overtaken by a newer one before it finished. */
export class ViewSupersededError extends Error {
  constructor() {
    super("View superseded");
    this.name = "ViewSupersededError";
  }
}

/** The view a row request names has been replaced and dropped. */
export class StaleViewError extends Error {
  constructor() {
    super("View no longer exists");
    this.name = "StaleViewError";
  }
}

/**
 * Numeric-aware cell compare. `localeCompare` with `numeric: true` builds a
 * fresh Intl collator per call, which dominates the profile when sorting tens
 * of thousands of rows; comparing numbers directly and falling back to a single
 * shared collator is around two orders of magnitude cheaper.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export function compareCells(a: string, b: string): number {
  if (a === b) return 0;
  const na = Number(a);
  const nb = Number(b);
  const aNumeric = a !== "" && !Number.isNaN(na);
  const bNumeric = b !== "" && !Number.isNaN(nb);
  if (aNumeric && bNumeric) return na - nb;
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return collator.compare(a, b);
}

// Currency, thousands separators and a trailing percent still describe a
// quantity, so they are allowed rather than disqualifying the column.
const FIGURE = /^[-+]?[$£€]?\d[\d,\s]*(\.\d+)?%?$/;
const SAMPLE_ROWS = 200;
const MIN_COLUMN = 64;
const MAX_COLUMN = 360;

/** Rough rendered width of a string: wide (CJK, emoji) code points count twice. */
function textUnits(text: string): number {
  let units = 0;
  for (let i = 0; i < text.length && units < 80; i++) units += text.charCodeAt(i) >= 0x2e80 ? 2 : 1;
  return units;
}

/**
 * Which columns hold figures, and how wide each wants to be.
 *
 * Decided per column from the body rather than per cell, so one stray "n/a"
 * in a revenue column does not left-align that one number and break the
 * column's right edge. A column counts as numeric when it has at least one
 * number in it and nothing that is clearly not one — empties are ignored,
 * since a blank tells you nothing about the column's type.
 *
 * The type is sampled from the head of the sheet: a couple of hundred rows
 * settle it. Width comes from `longest`, every cell's length per column, when
 * the caller has it (sorting brings any row to the top, so a sample is not
 * enough), with wide characters counted from the sample.
 */
export function measureColumns(
  rows: string[][],
  columnCount: number,
  longest?: readonly number[],
): Pick<SheetLayout, "numeric" | "widths"> {
  const limit = Math.min(rows.length, SAMPLE_ROWS + 1);
  const numeric: boolean[] = [];
  const widths: number[] = [];
  for (let c = 0; c < columnCount; c++) {
    let seen = 0;
    let figures = true;
    let units = Math.min(80, longest?.[c] ?? 0);
    for (let r = 1; r < limit; r++) {
      const raw = rows[r]?.[c] ?? "";
      units = Math.max(units, textUnits(raw));
      const cell = raw.trim();
      if (!cell) continue;
      seen++;
      if (figures && !FIGURE.test(cell)) figures = false;
    }
    const isNumeric = figures && seen > 0;
    // Headings are 12px semibold with a sort caret; cells are 14px, and
    // tabular figures run a little wider than average text.
    const heading = textUnits(rows[0]?.[c] || `Column ${c + 1}`) * 7.2 + 44;
    const body = units * (isNumeric ? 8.2 : 7.6) + 26;
    numeric.push(isNumeric);
    widths.push(Math.round(Math.min(MAX_COLUMN, Math.max(MIN_COLUMN, heading, body))));
  }
  return { numeric, widths };
}

function decodeDataUrl(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

type Sheet = { rows: string[][]; layout: SheetLayout };
type View = { id: number; sheet: number; order: Int32Array | null };
type Mask = { sheet: number; needle: string; matches: Int32Array };

const READ_OPTIONS = {
  dense: true,
  // Styles, formula text and volatile metadata are never rendered here, and
  // parsing them is a large share of the cost on a big workbook.
  cellStyles: false,
  cellFormula: false,
  cellHTML: false,
} as const;

/** How long a filter or sort runs before letting newer requests in. */
const SLICE_MS = 12;
/** Views kept alive for row requests: the current one and the one before it. */
const KEPT_VIEWS = 2;
/** Sorted orders cached per sheet, keyed by column and direction. */
const KEPT_ORDERS = 4;

export interface EngineOptions {
  /** Lets queued messages run between slices; a worker macrotask by default. */
  yieldToEvents?: () => Promise<void>;
  now?: () => number;
}

export class SpreadsheetEngine {
  private readonly xlsx: Xlsx;
  private readonly yieldToEvents: () => Promise<void>;
  private readonly now: () => number;
  private names: string[] = [];
  private bytes: Uint8Array | null = null;
  private readonly sheets = new Map<number, Sheet>();
  private views: View[] = [];
  private nextViewId = 0;
  /** Bumped by every view request; a running view that sees it move stops. */
  private viewTicket = 0;
  private lastMask: Mask | null = null;
  private readonly orders = new Map<string, Int32Array>();

  constructor(xlsx: Xlsx, options: EngineOptions = {}) {
    this.xlsx = xlsx;
    this.yieldToEvents =
      options.yieldToEvents ?? (() => new Promise((resolve) => setTimeout(resolve, 0)));
    this.now = options.now ?? (() => performance.now());
  }

  /** Reads the sheet list. Sheet contents are parsed later, when shown. */
  open(source: SpreadsheetSource): { sheets: string[] } {
    this.sheets.clear();
    this.views = [];
    this.orders.clear();
    this.lastMask = null;
    if (source.format === "text") {
      this.bytes = null;
      // Delimited text is one sheet; there is nothing to defer.
      const book = this.xlsx.read(source.text, { type: "string", dense: true, raw: true });
      this.names = book.SheetNames.slice(0, 1);
      if (this.names.length) this.materialize(0, book.Sheets[this.names[0]]);
      else this.names = ["Sheet1"];
    } else {
      if (source.format === "blob") throw new Error("Blob must be read before parsing");
      this.bytes = source.format === "buffer" ? new Uint8Array(source.buffer) : decodeDataUrl(source.dataUrl);
      this.names = this.xlsx.read(this.bytes, { type: "array", bookSheets: true }).SheetNames;
    }
    return { sheets: [...this.names] };
  }

  /** The sheet's shape, parsing it on first use. */
  layout(index: number): SheetLayout {
    return this.sheet(index).layout;
  }

  private sheet(index: number): Sheet {
    const cached = this.sheets.get(index);
    if (cached) return cached;
    if (index < 0 || index >= this.names.length) throw new RangeError(`No sheet ${index}`);
    const name = this.names[index];
    // Delimited text was materialized by open(); only workbooks get here.
    const worksheet = this.bytes
      ? this.xlsx.read(this.bytes, { type: "array", ...READ_OPTIONS, sheets: [name] }).Sheets[name]
      : undefined;
    return this.materialize(index, worksheet);
  }

  private materialize(index: number, worksheet: XLSXModule.WorkSheet | undefined): Sheet {
    const raw = worksheet
      ? (this.xlsx.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: "",
          blankrows: true,
        }) as unknown[][])
      : [];
    // Stringified in place. Mapping into a second matrix doubles peak memory
    // for a sheet that can already be hundreds of megabytes.
    // The same pass records each column's longest body cell, for its width.
    let columnCount = 0;
    const longest: number[] = [];
    for (let r = 0; r < raw.length; r++) {
      const row = raw[r];
      if (row.length > columnCount) columnCount = row.length;
      for (let c = 0; c < row.length; c++) {
        const value = row[c];
        const text = typeof value === "string" ? value : value == null ? "" : String(value);
        if (text !== value) row[c] = text;
        if (r > 0 && !(text.length <= (longest[c] ?? 0))) longest[c] = text.length;
      }
    }
    const rows = raw as string[][];
    const headers = Array.from({ length: columnCount }, (_, c) => rows[0]?.[c] ?? "");
    const layout: SheetLayout = {
      sheet: index,
      name: this.names[index],
      rowCount: Math.max(0, rows.length - 1),
      columnCount,
      headers,
      ...measureColumns(rows, columnCount, longest),
    };
    const sheet = { rows, layout };
    this.sheets.set(index, sheet);
    return sheet;
  }

  /**
   * Filters and sorts a sheet into a new view. Runs in slices; if another view
   * is requested meanwhile, this one rejects with ViewSupersededError.
   */
  async view(index: number, query: string, sort: SheetSort): Promise<ViewInfo> {
    const ticket = ++this.viewTicket;
    const { rows } = this.sheet(index);
    const needle = query.trim().toLowerCase();
    let deadline = this.now() + SLICE_MS;
    const checkpoint = async () => {
      if (this.now() < deadline) return;
      await this.yieldToEvents();
      if (ticket !== this.viewTicket) throw new ViewSupersededError();
      deadline = this.now() + SLICE_MS;
    };

    let matches: Int32Array | null = null;
    if (needle) matches = await this.filter(index, rows, needle, checkpoint);
    let order: Int32Array | null = matches;
    if (sort && sort.column >= 0 && rows.length > 1) {
      const sorted = await this.sorted(index, rows, sort, checkpoint);
      if (matches) {
        // Walking the cached full order keeps sort work independent of typing.
        const keep = new Uint8Array(rows.length);
        for (let i = 0; i < matches.length; i++) keep[matches[i]] = 1;
        const picked = new Int32Array(matches.length);
        let n = 0;
        for (let i = 0; i < sorted.length; i++) {
          if (keep[sorted[i]]) picked[n++] = sorted[i];
          if ((i & 0x3fff) === 0) await checkpoint();
        }
        order = picked;
      } else {
        order = sorted;
      }
    }
    if (ticket !== this.viewTicket) throw new ViewSupersededError();
    const view: View = { id: ++this.nextViewId, sheet: index, order };
    this.views = [...this.views.slice(-(KEPT_VIEWS - 1)), view];
    return {
      viewId: view.id,
      sheet: index,
      count: order ? order.length : Math.max(0, rows.length - 1),
    };
  }

  /**
   * Source row indices whose cells contain the needle. Typing only extends a
   * query, so a needle that contains the previous one re-checks only the rows
   * that matched it.
   */
  private async filter(
    index: number,
    rows: string[][],
    needle: string,
    checkpoint: () => Promise<void>,
  ): Promise<Int32Array> {
    const previous = this.lastMask;
    const narrowing =
      previous && previous.sheet === index && needle.includes(previous.needle)
        ? previous.matches
        : null;
    const total = narrowing ? narrowing.length : rows.length - 1;
    const found = new Int32Array(Math.max(0, total));
    let n = 0;
    for (let i = 0; i < total; i++) {
      const r = narrowing ? narrowing[i] : i + 1;
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        if (row[c].toLowerCase().includes(needle)) {
          found[n++] = r;
          break;
        }
      }
      if ((i & 0x3ff) === 0) await checkpoint();
    }
    const matches = found.slice(0, n);
    this.lastMask = { sheet: index, needle, matches };
    return matches;
  }

  /** Every data row in sort order, cached per sheet, column and direction. */
  private async sorted(
    index: number,
    rows: string[][],
    sort: NonNullable<SheetSort>,
    checkpoint: () => Promise<void>,
  ): Promise<Int32Array> {
    const key = `${index}:${sort.column}:${sort.direction}`;
    const cached = this.orders.get(key);
    if (cached) {
      this.orders.delete(key);
      this.orders.set(key, cached);
      return cached;
    }
    const count = rows.length - 1;
    const { column, direction } = sort;
    // Keys are read once per row, not once per comparison.
    const text: string[] = new Array(count);
    const figures = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const value = rows[i + 1][column] ?? "";
      text[i] = value;
      const number = Number(value);
      figures[i] = value !== "" && !Number.isNaN(number) ? number : NaN;
      if ((i & 0x3fff) === 0) await checkpoint();
    }
    const positions = new Array<number>(count);
    for (let i = 0; i < count; i++) positions[i] = i;
    // One synchronous sort: Array#sort can't be paused. Ties keep sheet order
    // in both directions, as a stable sort over the sheet would.
    positions.sort((a, b) => {
      const ta = text[a];
      const tb = text[b];
      let result = 0;
      if (ta !== tb) {
        const na = figures[a];
        const nb = figures[b];
        const aNumeric = na === na;
        const bNumeric = nb === nb;
        if (aNumeric && bNumeric) result = na - nb;
        else if (aNumeric) result = -1;
        else if (bNumeric) result = 1;
        else result = collator.compare(ta, tb);
      }
      return result * direction || a - b;
    });
    await checkpoint();
    const order = new Int32Array(count);
    for (let i = 0; i < count; i++) order[i] = positions[i] + 1;
    this.orders.set(key, order);
    while (this.orders.size > KEPT_ORDERS) this.orders.delete(this.orders.keys().next().value!);
    return order;
  }

  /** A block of a view's rows, limited to the requested columns. */
  rows(viewId: number, start: number, end: number, columnStart: number, columnEnd: number) {
    const view = this.views.find((candidate) => candidate.id === viewId);
    if (!view) throw new StaleViewError();
    const { rows } = this.sheet(view.sheet);
    const count = view.order ? view.order.length : Math.max(0, rows.length - 1);
    const from = Math.max(0, Math.min(start, count));
    const to = Math.max(from, Math.min(end, count));
    const window: RowWindow = { viewId, start: from, columnStart, rows: [], sourceRows: [] };
    for (let position = from; position < to; position++) {
      const r = view.order ? view.order[position] : position + 1;
      window.rows.push(rows[r].slice(columnStart, columnEnd));
      window.sourceRows.push(r + 1);
    }
    return window;
  }
}
