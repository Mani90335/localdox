// Persists where a reader left off in a PDF, and their single/spread layout
// preference, across sessions. Same shape as
// `src/services/diagrams/diagram-node-colors.ts`'s store: guarded
// `localStorage` access, JSON blob, fail quietly on read/write.
import type { PdfLayoutMode } from "./pdf-book-pagination";

const PAGE_KEY = "localdox:pdf-last-page";
const LAYOUT_KEY = "localdox:pdf-layout-mode";

type PageStore = Record<string /* fileId */, number>;

function readJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable — the reader just won't resume on last page */
  }
}

export function loadLastPage(fileId: string): number | null {
  return readJson<PageStore>(PAGE_KEY, {})[fileId] ?? null;
}

export function saveLastPage(fileId: string, page: number): void {
  const store = readJson<PageStore>(PAGE_KEY, {});
  writeJson(PAGE_KEY, { ...store, [fileId]: page });
}

/**
 * Layout mode is a device preference, not a per-file one — a reader who likes
 * a two-page spread almost certainly likes it for every book, and this also
 * gives the mobile-forced default (see `usePdfReaderState`) somewhere sane to
 * fall back to once a reader is back on a wide enough screen.
 */
export function loadLayoutMode(): PdfLayoutMode {
  return readJson<PdfLayoutMode>(LAYOUT_KEY, "single");
}

export function saveLayoutMode(mode: PdfLayoutMode): void {
  writeJson(LAYOUT_KEY, mode);
}
