import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { SheetSort } from "@/lib/spreadsheet/engine";
import {
  COLUMN_BLOCK,
  columnOffsets,
  columnWindow,
  fitColumns,
  OVERSCAN_ROWS,
  PREFETCH_ROWS,
  ROW_HEIGHT,
  rowNumberWidth,
  rowWindow,
} from "@/lib/spreadsheet/grid-window";
import { ErrorState, Loading, ViewerFrame, ViewerMasthead } from "./shared";
import type { Props } from "./shared";
import { useSpreadsheet } from "./use-spreadsheet";

/** Whether a value is likely wider than its column, so it gets a tooltip. */
const overflows = (value: string, width: number) => value.length * 7.6 + 26 > width;

/*
 * Parsing, filtering and sorting run in a worker (see use-spreadsheet.ts);
 * this component holds only the rows and columns on screen. Rows have a fixed
 * height and columns a fixed width, so a sheet 100,000 rows tall or 300
 * columns wide mounts the same few hundred cells as a small one.
 */
export function SpreadsheetViewer({
  file,
  embedded,
  isBookmarked,
  onToggleBookmark,
  prevFile,
  nextFile,
  onNavFile,
  onOpenPalette,
}: Props) {
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const [deferredQuery, setDeferredQuery] = useState("");
  const [sort, setSort] = useState<SheetSort>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({
    scrollTop: 0,
    scrollLeft: 0,
    height: 600,
    width: 1200,
  });
  // Typing is decoupled from filtering: the input stays responsive while the
  // scan over every cell runs once the user pauses, instead of on each keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDeferredQuery(query), 140);
    return () => clearTimeout(timer);
  }, [query]);

  // A different file (or an edited one) starts again from its first sheet.
  useEffect(() => {
    setActive(0);
    setQuery("");
    setDeferredQuery("");
    setSort(null);
  }, [file.content, file.data]);

  const needle = deferredQuery.trim();
  const firstScreen = Math.ceil(viewport.height / ROW_HEIGHT) + OVERSCAN_ROWS + PREFETCH_ROWS;
  const data = useSpreadsheet(file, active, needle, sort, firstScreen);
  const { layout, view, sheets, status } = data;
  const ready = status.state === "ready";

  const columnCount = layout?.columnCount ?? 0;
  const numberWidth = rowNumberWidth(layout?.rowCount ?? 0);
  const widths = useMemo(
    () => (layout ? fitColumns(layout.widths, Math.max(0, viewport.width - numberWidth)) : []),
    [layout, viewport.width, numberWidth],
  );
  const offsets = useMemo(() => columnOffsets(widths), [widths]);
  const columns = columnWindow(offsets, viewport.scrollLeft, viewport.width, numberWidth);
  const total = view?.count ?? 0;
  const { first, last } = rowWindow(viewport.scrollTop, viewport.height, total);

  const { request } = data;
  useEffect(() => {
    request(
      { first: Math.max(0, first - PREFETCH_ROWS), last: Math.min(total, last + PREFETCH_ROWS) },
      columns,
    );
  }, [request, first, last, total, columns.first, columns.last]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const measure = () =>
      setViewport({
        scrollTop: node.scrollTop,
        scrollLeft: node.scrollLeft,
        height: node.clientHeight,
        width: node.clientWidth,
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ready]);

  // A new filter, sort or sheet opens at the top once its rows are in, so the
  // window lines up with what is actually being shown.
  const shown = useRef<{ sheet: number; query: string; sort: SheetSort } | null>(null);
  useEffect(() => {
    if (!view) return;
    const previous = shown.current;
    shown.current = { sheet: view.sheet, query: view.query, sort: view.sort };
    if (
      !previous ||
      (previous.sheet === view.sheet &&
        previous.query === view.query &&
        previous.sort === view.sort)
    )
      return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = 0;
    if (previous.sheet !== view.sheet) node.scrollLeft = 0;
    setViewport((prev) => ({ ...prev, scrollTop: 0, scrollLeft: node.scrollLeft }));
  }, [view]);

  const pending = view != null && (view.query !== needle || view.sort !== sort);
  const statusText = pending
    ? view.query !== needle
      ? "Filtering…"
      : "Sorting…"
    : needle
      ? `${total.toLocaleString()} matching rows`
      : "Select a column heading to sort";

  const visibleColumns: number[] = [];
  for (let c = columns.first; c < columns.last; c++) visibleColumns.push(c);
  const leftPad = offsets[columns.first] ?? 0;
  const rightPad = (offsets[columnCount] ?? 0) - (offsets[columns.last] ?? 0);
  const span = 1 + (leftPad > 0 ? 1 : 0) + visibleColumns.length + (rightPad > 0 ? 1 : 0);
  const numberBlock = Math.floor(columns.first / COLUMN_BLOCK);
  const positions: number[] = [];
  for (let p = first; p < last; p++) positions.push(p);

  return (
    <ViewerFrame
      file={file}
      embedded={embedded}
      isBookmarked={isBookmarked}
      onToggleBookmark={onToggleBookmark}
      prevFile={prevFile}
      nextFile={nextFile}
      onNavFile={onNavFile}
      onOpenPalette={onOpenPalette}
    >
      {status.state === "error" ? (
        <ErrorState message={status.message} />
      ) : status.state === "crashed" ? (
        <div
          role="alert"
          className="flex min-h-[55vh] flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground"
        >
          <p>The spreadsheet viewer stopped. The file may be too large to open on this device.</p>
          <button
            type="button"
            onClick={data.retry}
            className="inline-flex h-9 items-center rounded-md border border-border px-3 font-medium text-foreground hover:bg-accent coarse:h-11"
          >
            Try again
          </button>
        </div>
      ) : !ready ? (
        <Loading label="Loading spreadsheet" />
      ) : (
        <div className="mx-auto max-w-7xl p-4 md:p-7">
          <ViewerMasthead
            file={file}
            kindLabel={/\.csv$/i.test(file.name) ? "CSV" : "Spreadsheet"}
            meta={
              layout ? (
                <>
                  {layout.rowCount.toLocaleString()} rows · {columnCount.toLocaleString()}{" "}
                  {columnCount === 1 ? "column" : "columns"}
                </>
              ) : null
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
                  name="spreadsheet-filter"
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
                {statusText}
              </span>
            </div>
            <div
              ref={scrollRef}
              onScroll={(e) =>
                setViewport({
                  scrollTop: e.currentTarget.scrollTop,
                  scrollLeft: e.currentTarget.scrollLeft,
                  height: e.currentTarget.clientHeight,
                  width: e.currentTarget.clientWidth,
                })
              }
              className="max-h-[calc(100dvh-18rem)] min-h-40 overflow-auto"
              role="region"
              aria-label="Spreadsheet data"
              aria-busy={pending || !view}
              tabIndex={0}
            >
              {/* Fixed layout with set column widths: the browser never
                  measures cell contents, and columns don't shift as rows
                  scroll in and out. Only the columns in view are rendered;
                  spacer columns stand in for the rest. */}
              <table
                aria-label={layout?.name ?? file.name}
                aria-rowcount={total + 1}
                aria-colcount={columnCount + 1}
                className="spreadsheet-table border-collapse text-left text-sm"
                style={{
                  tableLayout: "fixed",
                  width: columnCount ? numberWidth + (offsets[columnCount] ?? 0) : "100%",
                }}
              >
                <colgroup>
                  <col style={{ width: numberWidth }} />
                  {leftPad > 0 && <col style={{ width: leftPad }} />}
                  {visibleColumns.map((column) => (
                    <col key={column} style={{ width: widths[column] }} />
                  ))}
                  {rightPad > 0 && <col style={{ width: rightPad }} />}
                </colgroup>
                <thead>
                  <tr aria-rowindex={1}>
                    <th
                      aria-colindex={1}
                      className="sticky left-0 top-0 z-20 bg-muted px-3 py-2 text-right text-xs font-medium text-muted-foreground"
                    >
                      #
                    </th>
                    {leftPad > 0 && <th aria-hidden className="sticky top-0 z-10 bg-muted" />}
                    {visibleColumns.map((column) => {
                      const label = layout?.headers[column] || `Column ${column + 1}`;
                      const numeric = layout?.numeric[column];
                      return (
                        <th
                          key={column}
                          aria-colindex={column + 2}
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
                            numeric ? "text-right" : "text-left"
                          }`}
                        >
                          <button
                            type="button"
                            title={overflows(label, widths[column]) ? label : undefined}
                            className={`inline-flex w-full items-center gap-1 py-2 focus-visible:outline-2 focus-visible:outline-primary ${numeric ? "justify-end" : "justify-start"}`}
                            onClick={() =>
                              setSort((previous) =>
                                previous?.column === column
                                  ? { column, direction: previous.direction === 1 ? -1 : 1 }
                                  : { column, direction: 1 },
                              )
                            }
                          >
                            <span className="truncate">{label}</span>
                            {/* The caret holds its space whether or not the column
                              is the sorted one, so clicking through the headings
                              does not shunt every other column sideways. */}
                            <span
                              aria-hidden
                              className={`ml-1 inline-block w-2 shrink-0 ${sort?.column === column ? "text-primary" : "text-transparent"}`}
                            >
                              {sort?.column === column && sort.direction === -1 ? "↓" : "↑"}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                    {rightPad > 0 && <th aria-hidden className="sticky top-0 z-10 bg-muted" />}
                  </tr>
                </thead>
                <tbody>
                  {(!view || total === 0) && (
                    <tr>
                      <td
                        colSpan={span}
                        className="px-4 py-16 text-center text-sm text-muted-foreground"
                      >
                        {!view
                          ? "Loading sheet…"
                          : view.query
                            ? "No rows match your filter."
                            : "This sheet has no data rows."}
                      </td>
                    </tr>
                  )}
                  {/* Spacers stand in for the rows outside the window so the
                      scrollbar still reflects the full sheet. */}
                  {first > 0 ? (
                    <tr style={{ height: first * ROW_HEIGHT }} aria-hidden>
                      <td colSpan={span} className="p-0" />
                    </tr>
                  ) : null}
                  {positions.map((position) => (
                    <tr key={position} aria-rowindex={position + 2} style={{ height: ROW_HEIGHT }}>
                      <td
                        aria-colindex={1}
                        className="sticky left-0 z-10 bg-card px-3 py-0 text-right text-xs text-muted-foreground"
                      >
                        {data.sourceRow(position, numberBlock)}
                      </td>
                      {leftPad > 0 && <td aria-hidden className="border-t border-hairline p-0" />}
                      {visibleColumns.map((column) => {
                        const value = data.cell(position, column) ?? "";
                        return (
                          <td
                            key={column}
                            aria-colindex={column + 2}
                            title={overflows(value, widths[column]) ? value : undefined}
                            /* Figures are set right-aligned and tabular, so
                               digits line up in columns and the eye can compare
                               magnitudes down the column without reading a
                               single number. Left-aligned proportional figures
                               make 2840000 and 412 look the same length. Text
                               stays left. */
                            className={`overflow-hidden text-ellipsis whitespace-nowrap border-t border-hairline px-3 py-0 text-foreground/85 ${
                              layout?.numeric[column]
                                ? "text-right font-medium tabular-nums"
                                : "text-left"
                            }`}
                          >
                            {value}
                          </td>
                        );
                      })}
                      {rightPad > 0 && <td aria-hidden className="border-t border-hairline p-0" />}
                    </tr>
                  ))}
                  {last < total ? (
                    <tr style={{ height: (total - last) * ROW_HEIGHT }} aria-hidden>
                      <td colSpan={span} className="p-0" />
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {sheets.length > 1 && (
              <div className="flex gap-1 overflow-x-auto border-t border-border bg-muted/20 px-2">
                {sheets.map((name, index) => (
                  <button
                    type="button"
                    aria-pressed={active === index}
                    key={`${index}-${name}`}
                    onClick={() => {
                      setActive(index);
                      setSort(null);
                      setQuery("");
                      setDeferredQuery("");
                    }}
                    className={`shrink-0 border-b-2 px-3 py-2 text-xs font-semibold ${active === index ? "border-primary bg-primary/5 text-primary" : "border-transparent text-muted-foreground hover:bg-accent"}`}
                  >
                    {name}
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
