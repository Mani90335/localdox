import { useCallback, useEffect, useRef, useState } from "react";
import { getDocumentKind } from "@/lib/markdown/document-utils";
import type { SpreadsheetClient } from "@/lib/spreadsheet/client";
import type {
  RowWindow,
  SheetLayout,
  SheetSort,
  SpreadsheetSource,
  ViewInfo,
} from "@/lib/spreadsheet/engine";
import { blocksFor, COLUMN_BLOCK, ROW_BLOCK, type Span } from "@/lib/spreadsheet/grid-window";
import type { MdFile } from "@/lib/markdown/markdown-utils";

/** Blocks kept on this thread. The worker holds the sheet; this is the view. */
const KEPT_BLOCKS = 48;

export type SpreadsheetStatus =
  | { state: "loading" }
  | { state: "ready" }
  | { state: "error"; message: string }
  /** The worker died (usually out of memory); Try again starts a new one. */
  | { state: "crashed" };

export interface SheetView extends ViewInfo {
  query: string;
  sort: SheetSort;
}

const blockKey = (viewId: number, rowBlock: number, columnBlock: number) =>
  `${viewId}:${rowBlock}:${columnBlock}`;

function sourceOf(file: MdFile): SpreadsheetSource | null {
  const kind = file.kind ?? getDocumentKind(file.name, file.mimeType);
  if (kind === "csv") return { format: "text", text: file.content };
  return typeof file.data === "string" ? { format: "binary", dataUrl: file.data }
    : file.data ? { format: "blob", blob: file.data.blob } : null;
}

/**
 * Drives the spreadsheet engine for one file: opens it, keeps the active
 * sheet's layout, recomputes the view when the filter or sort changes, and
 * fetches the blocks of rows the grid needs. A new view is only shown once
 * its first rows have arrived, so filtering never flashes an empty table.
 */
export function useSpreadsheet(
  file: MdFile,
  active: number,
  query: string,
  sort: SheetSort,
  visibleRows: number,
) {
  const [status, setStatus] = useState<SpreadsheetStatus>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [sheets, setSheets] = useState<string[]>([]);
  const [layouts, setLayouts] = useState<Map<number, SheetLayout>>(new Map());
  const [view, setView] = useState<SheetView | null>(null);
  const [, setBlockVersion] = useState(0);
  const clientRef = useRef<SpreadsheetClient | null>(null);
  const blocks = useRef(new Map<string, RowWindow>());
  const inflight = useRef(new Set<string>());
  const columnSpan = useRef<Span>({ first: 0, last: COLUMN_BLOCK });
  const viewSeq = useRef(0);
  const shownSheet = useRef<number | null>(null);

  const source = sourceOf(file);
  // The payload itself is the dependency: the same string compares by
  // reference, and a new file body is a new string.
  const payload = file.kind === "csv" ? file.content : file.data;

  useEffect(() => {
    let alive = true;
    setStatus({ state: "loading" });
    setSheets([]);
    setLayouts(new Map());
    setView(null);
    shownSheet.current = null;
    blocks.current.clear();
    inflight.current.clear();
    const current = sourceOf(file);
    if (!current) {
      setStatus({ state: "error", message: "This spreadsheet could not be read." });
      return;
    }
    let client: SpreadsheetClient | null = null;
    void (async () => {
      let connect: typeof import("@/lib/spreadsheet/connect");
      try {
        connect = await import("@/lib/spreadsheet/connect");
      } catch {
        if (alive)
          setStatus({ state: "error", message: "The spreadsheet viewer couldn't be loaded." });
        return;
      }
      if (!alive) return;
      client = connect.connectSpreadsheet(() => {
        if (alive) setStatus({ state: "crashed" });
      });
      clientRef.current = client;
      try {
        const names = await client.open(current);
        if (alive) setSheets(names);
      } catch {
        // A crash has already been reported by the failure callback.
        if (alive && !client.closed)
          setStatus({ state: "error", message: "This spreadsheet could not be read." });
      }
    })();
    return () => {
      alive = false;
      client?.close();
      if (clientRef.current === client) clientRef.current = null;
    };
    // The payload stands in for the file; other file fields don't change what
    // is parsed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.format, payload, attempt]);

  /** Fetches the missing blocks. Resolves, once all have settled, with
   *  whether any arrived. */
  const fetchBlocks = useCallback(
    (viewId: number, rowBlocks: number[], columnBlocks: number[]): Promise<boolean> => {
      const client = clientRef.current;
      if (!client) return Promise.resolve(false);
      let arrived = false;
      const waits: Promise<void>[] = [];
      for (const rb of rowBlocks) {
        for (const cb of columnBlocks) {
          const key = blockKey(viewId, rb, cb);
          if (blocks.current.has(key) || inflight.current.has(key)) continue;
          inflight.current.add(key);
          waits.push(
            client
              .rows(
                viewId,
                rb * ROW_BLOCK,
                (rb + 1) * ROW_BLOCK,
                cb * COLUMN_BLOCK,
                (cb + 1) * COLUMN_BLOCK,
              )
              .then(
                (window) => {
                  inflight.current.delete(key);
                  if (window && !client.closed) {
                    blocks.current.set(key, window);
                    arrived = true;
                  }
                },
                () => {
                  inflight.current.delete(key);
                },
              ),
          );
        }
      }
      return Promise.all(waits).then(() => arrived);
    },
    [],
  );

  const sheetsReady = sheets.length > 0;
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !sheetsReady) return;
    const seq = ++viewSeq.current;
    const stale = () => seq !== viewSeq.current || client.closed;
    void (async () => {
      try {
        if (!layouts.has(active)) {
          const layout = await client.layout(active);
          if (stale()) return;
          setLayouts((previous) => new Map(previous).set(active, layout));
          // The layout effect run re-enters with the layout present.
          return;
        }
        const next = await client.view(active, query, sort);
        if (!next || stale()) return;
        // The new view opens at the top, so its first screen is fetched
        // before it replaces the old one. A different sheet opens at its
        // left edge; so does one whose columns haven't been laid out yet.
        const span = columnSpan.current;
        const columns =
          shownSheet.current === next.sheet && span.last > span.first
            ? span
            : { first: 0, last: 1 };
        await fetchBlocks(
          next.viewId,
          blocksFor({ first: 0, last: Math.min(next.count, visibleRows) }, ROW_BLOCK),
          blocksFor(columns, COLUMN_BLOCK),
        );
        if (stale()) return;
        for (const key of blocks.current.keys()) {
          if (!key.startsWith(`${next.viewId}:`)) blocks.current.delete(key);
        }
        shownSheet.current = next.sheet;
        setView({ ...next, query, sort });
        setStatus({ state: "ready" });
      } catch {
        if (!stale()) setStatus({ state: "error", message: "This spreadsheet could not be read." });
      }
    })();
    // visibleRows only sizes the first fetch; a resize must not rerun the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetsReady, active, layouts, query, sort?.column, sort?.direction, fetchBlocks]);

  /** Makes sure the blocks behind a rendered window are present or on their way. */
  const request = useCallback(
    (rows: Span, columns: Span) => {
      columnSpan.current = columns;
      if (!view) return;
      const rowBlocks = blocksFor(rows, ROW_BLOCK);
      const columnBlocks = blocksFor(columns, COLUMN_BLOCK);
      // Recently used blocks move to the end; the oldest are dropped.
      for (const rb of rowBlocks) {
        for (const cb of columnBlocks) {
          const key = blockKey(view.viewId, rb, cb);
          const block = blocks.current.get(key);
          if (block) {
            blocks.current.delete(key);
            blocks.current.set(key, block);
          }
        }
      }
      while (blocks.current.size > KEPT_BLOCKS) {
        blocks.current.delete(blocks.current.keys().next().value!);
      }
      void fetchBlocks(view.viewId, rowBlocks, columnBlocks).then((arrived) => {
        if (arrived) setBlockVersion((v) => v + 1);
      });
    },
    [view, fetchBlocks],
  );

  /** The cell at a view position, or undefined while its block is loading. */
  const cell = useCallback(
    (position: number, column: number): string | undefined => {
      if (!view) return undefined;
      const block = blocks.current.get(
        blockKey(view.viewId, Math.floor(position / ROW_BLOCK), Math.floor(column / COLUMN_BLOCK)),
      );
      return (
        block?.rows[position - block.start]?.[column - block.columnStart] ??
        (block ? "" : undefined)
      );
    },
    [view],
  );

  /** The sheet row number shown in the # column. */
  const sourceRow = useCallback(
    (position: number, columnBlock: number): number | undefined => {
      if (!view) return undefined;
      const rb = Math.floor(position / ROW_BLOCK);
      const block =
        blocks.current.get(blockKey(view.viewId, rb, columnBlock)) ??
        blocks.current.get(blockKey(view.viewId, rb, 0));
      return block?.sourceRows[position - block.start];
    },
    [view],
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    status,
    sheets,
    layout: layouts.get(active) ?? null,
    view: view && view.sheet === active ? view : null,
    request,
    cell,
    sourceRow,
    retry,
  };
}
