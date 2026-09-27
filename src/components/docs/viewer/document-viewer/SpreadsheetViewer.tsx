import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { dataUrlToArrayBuffer, getDocumentKind } from "@/lib/markdown/document-utils";
import { ErrorState, Loading, ViewerFrame, ViewerMasthead } from "./shared";
import type { Props } from "./shared";

type SheetData = { name: string; rows: string[][] };

const ROW_HEIGHT = 36;
const OVERSCAN = 12;

/**
 * Numeric-aware cell compare. `localeCompare` with `numeric: true` builds a
 * fresh Intl collator per call, which dominates the profile when sorting tens
 * of thousands of rows; comparing numbers directly and falling back to a single
 * shared collator is around two orders of magnitude cheaper.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
function compareCells(a: string, b: string): number {
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

export function SpreadsheetViewer({
  file,
  embedded,
  viewerAction,
  isBookmarked,
  onToggleBookmark,
  prevFile,
  nextFile,
  onNavFile,
  onOpenPalette,
}: Props) {
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const [deferredQuery, setDeferredQuery] = useState("");
  const [sort, setSort] = useState<{ column: number; direction: 1 | -1 } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 600 });
  // Typing is decoupled from filtering: the input stays responsive while the
  // scan over every cell runs once the user pauses, instead of on each keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDeferredQuery(query), 140);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setError("");
    setQuery("");
    setDeferredQuery("");
    setSort(null);
    void (async () => {
      try {
        const XLSX = await import("xlsx");
        if (!alive) return;
        const kind = file.kind ?? getDocumentKind(file.name, file.mimeType);
        const workbook =
          kind === "csv"
            ? XLSX.read(file.content, { type: "string", dense: true, raw: true })
            : XLSX.read(dataUrlToArrayBuffer(file.data), {
                type: "array",
                dense: true,
                // Styles, formula text and volatile metadata are never rendered
                // here, and parsing them is a large share of the cost on a big
                // workbook.
                cellStyles: false,
                cellFormula: false,
                cellHTML: false,
              });
        const next = workbook.SheetNames.map((name) => {
          const raw = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
            header: 1,
            defval: "",
            blankrows: true,
          }) as unknown[][];
          // Stringified in place. Mapping into a second matrix doubles peak
          // memory for a sheet that can already be hundreds of megabytes.
          for (let r = 0; r < raw.length; r++) {
            const row = raw[r];
            for (let c = 0; c < row.length; c++) {
              const value = row[c];
              if (typeof value !== "string") row[c] = value == null ? "" : String(value);
            }
          }
          return { name, rows: raw as string[][] };
        });
        if (!alive) return;
        setLoaded(true);
        setSheets(next);
        setActive(0);
        setError("");
      } catch {
        if (alive) setError("This spreadsheet could not be read.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [file.content, file.data, file.kind, file.mimeType, file.name]);
  const sheet = sheets[active];
  const headers = useMemo(() => {
    const width = sheet?.rows.reduce((max, row) => Math.max(max, row.length), 0) ?? 0;
    return Array.from({ length: width }, (_, column) => sheet?.rows[0]?.[column] ?? "");
  }, [sheet]);
  const sourceRowNumbers = useMemo(
    () => new Map(sheet?.rows.map((row, index) => [row, index + 1])),
    [sheet],
  );
  const rows = useMemo(() => {
    const body = sheet?.rows;
    if (!body || body.length < 2) return [] as string[][];
    const needle = deferredQuery.trim().toLowerCase();
    let source: string[][];
    if (needle) {
      source = [];
      // Hand-rolled loops: the needle is lowercased once rather than per cell,
      // and no intermediate array is allocated for the rows that are filtered out.
      for (let r = 1; r < body.length; r++) {
        const row = body[r];
        for (let c = 0; c < row.length; c++) {
          if (row[c].toLowerCase().includes(needle)) {
            source.push(row);
            break;
          }
        }
      }
    } else {
      source = body.slice(1);
    }
    if (!sort) return source;
    const { column, direction } = sort;
    // slice() only when the array is still the parsed one, so a filtered result
    // is sorted in place instead of copied again.
    const sorted = source === body ? source.slice() : source;
    sorted.sort((a, b) => compareCells(a[column] ?? "", b[column] ?? "") * direction);
    return sorted;
  }, [sheet, deferredQuery, sort]);

  /*
   * Which columns hold figures.
   *
   * Decided per column from the body rather than per cell, so one stray "n/a"
   * in a revenue column does not left-align that one number and break the
   * column's right edge. A column counts as numeric when it has at least one
   * number in it and nothing that is clearly not one — empties are ignored,
   * since a blank tells you nothing about the column's type.
   *
   * Sampled from the head of the sheet: a hundred rows settle the question, and
   * the alternative is walking a 50,000-row export on every render.
   */
  const numericColumns = useMemo(() => {
    const body = sheet?.rows;
    if (!body || body.length < 2) return [] as boolean[];
    const width = body[0]?.length ?? 0;
    const limit = Math.min(body.length, 101);
    const result: boolean[] = [];
    for (let c = 0; c < width; c++) {
      let seen = 0;
      let numeric = true;
      for (let r = 1; r < limit; r++) {
        const cell = body[r]?.[c]?.trim();
        if (!cell) continue;
        seen++;
        // Currency, thousands separators and a trailing percent still describe
        // a quantity, so they are stripped before the test rather than
        // disqualifying the column.
        if (!/^[-+]?[$£€]?\d[\d,\s]*(\.\d+)?%?$/.test(cell)) {
          numeric = false;
          break;
        }
      }
      result.push(numeric && seen > 0);
    }
    return result;
  }, [sheet]);

  // Only the rows overlapping the scroll window are turned into DOM. Rendering
  // every row of a large export is what made these files unusable: the cost is
  // now bounded by viewport height, not by row count.
  const total = rows.length;
  const first = Math.max(0, Math.floor(viewport.scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(
    total,
    Math.ceil((viewport.scrollTop + viewport.height) / ROW_HEIGHT) + OVERSCAN,
  );
  const visible = rows.slice(first, last);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const measure = () => setViewport({ scrollTop: node.scrollTop, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [sheet]);

  // Scrolling back to the top on a new sheet or filter keeps the window aligned
  // with what is actually being shown.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = 0;
    setViewport((prev) => ({ ...prev, scrollTop: 0 }));
  }, [active, deferredQuery, sort]);
  return (
    <ViewerFrame
      file={file}
      embedded={embedded}
      action={viewerAction}
      isBookmarked={isBookmarked}
      onToggleBookmark={onToggleBookmark}
      prevFile={prevFile}
      nextFile={nextFile}
      onNavFile={onNavFile}
      onOpenPalette={onOpenPalette}
    >
      {error ? (
        <ErrorState message={error} />
      ) : !loaded ? (
        <Loading label="Loading spreadsheet" />
      ) : (
        <div className="mx-auto max-w-7xl p-4 md:p-7">
          <ViewerMasthead
            file={file}
            kindLabel={/\.csv$/i.test(file.name) ? "CSV" : "Spreadsheet"}
            meta={
              <>
                {Math.max(0, (sheet?.rows.length ?? 0) - 1).toLocaleString()} rows ·{" "}
                {headers.length} {headers.length === 1 ? "column" : "columns"}
              </>
            }
          />
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-(--shadow-1)">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2.5">
              <div className="relative w-full sm:w-64">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter rows…"
                  aria-label="Filter rows"
                  className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Clear filter"
                    onClick={() => setQuery("")}
                    className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <span role="status" className="text-xs text-muted-foreground">
                {deferredQuery.trim()
                  ? `${rows.length.toLocaleString()} matching rows`
                  : "Select a column heading to sort"}
              </span>
            </div>
            <div
              ref={scrollRef}
              onScroll={(e) =>
                setViewport({
                  scrollTop: e.currentTarget.scrollTop,
                  height: e.currentTarget.clientHeight,
                })
              }
              className="max-h-[calc(100dvh-18rem)] min-h-40 overflow-auto"
              role="region"
              aria-label="Spreadsheet data"
              tabIndex={0}
            >
              <table
                aria-label={sheet?.name ?? file.name}
                className="spreadsheet-table w-full border-collapse text-left text-sm"
              >
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-20 w-12 bg-muted px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                      #
                    </th>
                    {headers.map((header, column) => (
                      <th
                        key={`${header}-${column}`}
                        aria-sort={
                          sort?.column === column
                            ? sort.direction === 1
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                        /* A numeric column's heading follows its figures to the
                           right edge. A heading that sits left of the column it
                           labels reads as belonging to the column beside it. */
                        className={`sticky top-0 z-10 cursor-pointer select-none whitespace-nowrap bg-muted px-3 text-xs font-semibold text-foreground transition-colors hover:bg-accent ${
                          numericColumns[column] ? "text-right" : "text-left"
                        }`}
                      >
                        <button
                          type="button"
                          className={`inline-flex w-full items-center gap-1 py-2 focus-visible:outline-2 focus-visible:outline-primary ${numericColumns[column] ? "justify-end" : "justify-start"}`}
                          onClick={() =>
                            setSort((previous) =>
                              previous?.column === column
                                ? { column, direction: previous.direction === 1 ? -1 : 1 }
                                : { column, direction: 1 },
                            )
                          }
                        >
                          {header || `Column ${column + 1}`}
                          {/* The caret holds its space whether or not the column
                            is the sorted one, so clicking through the headings
                            does not shunt every other column sideways. */}
                          <span
                            aria-hidden
                            className={`ml-1 inline-block w-2 ${sort?.column === column ? "text-primary" : "text-transparent"}`}
                          >
                            {sort?.column === column && sort.direction === -1 ? "↓" : "↑"}
                          </span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {total === 0 && (
                    <tr>
                      <td
                        colSpan={headers.length + 1}
                        className="px-4 py-16 text-center text-sm text-muted-foreground"
                      >
                        {deferredQuery.trim()
                          ? "No rows match your filter."
                          : "This sheet has no data rows."}
                      </td>
                    </tr>
                  )}
                  {/* Spacers stand in for the rows outside the window so the
                      scrollbar still reflects the full sheet. */}
                  {first > 0 ? (
                    <tr style={{ height: first * ROW_HEIGHT }} aria-hidden>
                      <td colSpan={headers.length + 1} className="p-0" />
                    </tr>
                  ) : null}
                  {visible.map((row, offset) => {
                    const rowIndex = first + offset;
                    return (
                      <tr key={rowIndex} style={{ height: ROW_HEIGHT }}>
                        <td className="sticky left-0 z-10 bg-card px-3 py-0 text-right text-xs text-muted-foreground">
                          {sourceRowNumbers.get(row)}
                        </td>
                        {headers.map((_, column) => (
                          <td
                            key={column}
                            /* Figures are set right-aligned and tabular, so
                               digits line up in columns and the eye can compare
                               magnitudes down the column without reading a
                               single number. Left-aligned proportional figures
                               — what this was — make 2840000 and 412 look the
                               same length. Text stays left. */
                            className={`whitespace-nowrap border-t border-hairline px-3 py-0 text-foreground/85 ${
                              numericColumns[column]
                                ? "text-right font-medium tabular-nums"
                                : "text-left"
                            }`}
                          >
                            {row[column]}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {last < total ? (
                    <tr style={{ height: (total - last) * ROW_HEIGHT }} aria-hidden>
                      <td colSpan={headers.length + 1} className="p-0" />
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {sheets.length > 1 && (
              <div className="flex gap-1 overflow-x-auto border-t border-border bg-muted/20 px-2">
                {sheets.map((item, index) => (
                  <button
                    type="button"
                    aria-pressed={active === index}
                    key={item.name}
                    onClick={() => {
                      setActive(index);
                      setSort(null);
                      setQuery("");
                      setDeferredQuery("");
                    }}
                    className={`shrink-0 border-b-2 px-3 py-2 text-xs font-semibold ${active === index ? "border-primary bg-primary/5 text-primary" : "border-transparent text-muted-foreground hover:bg-accent"}`}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </ViewerFrame>
  );
}
