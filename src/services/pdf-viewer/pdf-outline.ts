// The PDF outline (table of contents) as the sidebar sees it, plus the lazy
// destination resolver behind it. Pure: no pdf.js import, so it is unit
// tested directly and stays out of anything reachable during SSR.
//
// The reader used to resolve every outline entry's destination up front,
// recursively and all in parallel (one or two worker round trips each), and
// then render the whole tree expanded. A book with thousands of entries sent
// thousands of requests before the Contents tab appeared and mounted a row
// for every entry. Now destinations resolve only for rows on screen or
// clicked, each at most once, a few at a time; a large tree opens collapsed
// to a bounded number of rows; and a long visible list is windowed.

import type { PdfOutlineDest, PdfOutlineNode } from "./types";

/** Rows the initially expanded tree may show. Past this, deeper levels start collapsed. */
export const OUTLINE_INITIAL_ROWS = 200;
/** Visible rows above which the list is windowed rather than fully mounted. */
export const OUTLINE_VIRTUALIZE_ROWS = 300;
/** Destination look-ups in flight at once. */
export const OUTLINE_RESOLVE_CONCURRENCY = 4;

/** The fields read from each pdf.js `getOutline()` entry. */
export interface RawOutlineEntry {
  title?: string | null;
  dest?: PdfOutlineDest;
  count?: number;
  items?: RawOutlineEntry[] | null;
}

/**
 * Maps pdf.js's outline into ids and plain fields, without resolving
 * anything. Iterative, so a pathologically deep outline can't overflow the
 * stack. The id is the entry's index path (`"3.0.12"`), stable for the
 * lifetime of one document.
 */
export function buildOutline(raw: readonly RawOutlineEntry[]): PdfOutlineNode[] {
  const roots: PdfOutlineNode[] = [];
  const stack: { entries: readonly RawOutlineEntry[]; into: PdfOutlineNode[]; prefix: string }[] = [
    { entries: raw, into: roots, prefix: "" },
  ];
  while (stack.length > 0) {
    const { entries, into, prefix } = stack.pop()!;
    entries.forEach((entry, i) => {
      const id = prefix + i;
      const node: PdfOutlineNode = {
        id,
        title: typeof entry.title === "string" ? entry.title : "",
        dest: entry.dest ?? null,
        // PDF: a negative count means the entry is closed by default.
        closed: typeof entry.count === "number" && entry.count < 0,
        items: [],
      };
      into.push(node);
      if (entry.items?.length)
        stack.push({ entries: entry.items, into: node.items, prefix: id + "." });
    });
  }
  return roots;
}

/**
 * The entries expanded when the Contents tab first opens. Honors each
 * entry's open/closed flag, breadth first, and stops expanding once another
 * level would push the visible rows past `maxRows`. A small outline opens
 * exactly as its author set it; a huge one opens as its top levels.
 */
export function initialExpanded(
  roots: readonly PdfOutlineNode[],
  maxRows = OUTLINE_INITIAL_ROWS,
): Set<string> {
  const expanded = new Set<string>();
  let visible = roots.length;
  let level: readonly PdfOutlineNode[] = roots;
  while (level.length > 0) {
    const next: PdfOutlineNode[] = [];
    for (const node of level) {
      if (node.items.length === 0 || node.closed) continue;
      if (visible + node.items.length > maxRows) return expanded;
      visible += node.items.length;
      expanded.add(node.id);
      next.push(...node.items);
    }
    level = next;
  }
  return expanded;
}

export interface OutlineRow {
  node: PdfOutlineNode;
  /** 1-based, as `aria-level` wants it. */
  level: number;
  /** 1-based position among its siblings, and their count (`aria-posinset`/`aria-setsize`). */
  posInSet: number;
  setSize: number;
  parentId: string | null;
}

/** The rows currently visible: every root, plus the children of each expanded entry, in reading order. */
export function flattenOutline(
  roots: readonly PdfOutlineNode[],
  expanded: ReadonlySet<string>,
): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const stack: {
    siblings: readonly PdfOutlineNode[];
    index: number;
    level: number;
    parentId: string | null;
  }[] = [{ siblings: roots, index: 0, level: 1, parentId: null }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.siblings.length) {
      stack.pop();
      continue;
    }
    const node = frame.siblings[frame.index++];
    rows.push({
      node,
      level: frame.level,
      posInSet: frame.index,
      setSize: frame.siblings.length,
      parentId: frame.parentId,
    });
    if (node.items.length > 0 && expanded.has(node.id))
      stack.push({ siblings: node.items, index: 0, level: frame.level + 1, parentId: node.id });
  }
  return rows;
}

/** The first and last row index to mount for a scroll position, with `overscan` rows either side. */
export function windowRange(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan: number,
): { first: number; last: number } {
  if (total === 0) return { first: 0, last: -1 };
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(total - 1, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
  return { first: Math.min(first, last), last };
}

/** What the resolver needs from a pdf.js document. */
export interface OutlineDestSource {
  getDestination(name: string): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
}

/** Resolved page number, `null` for a destination that doesn't resolve, `undefined` while unknown. */
export type OutlinePage = number | null | undefined;

interface Job {
  key: string;
  /** Someone clicked it: never dropped by `prefetch`. */
  urgent: boolean;
  run: () => Promise<number | null>;
}

/**
 * Resolves outline destinations to 1-based page numbers on demand, caching
 * each by its named destination or page reference. `prefetch` queues the
 * rows on screen and drops queued rows that have since scrolled away;
 * `resolve` (a click) jumps the queue. At most `concurrency` look-ups run at
 * once. A destination that fails to resolve becomes `null`, an inert entry.
 */
export class PdfOutlineResolver {
  private readonly source: OutlineDestSource;
  private readonly concurrency: number;
  private readonly pages = new Map<string, number | null>();
  private readonly pending = new Map<string, Promise<number | null>>();
  private readonly settle = new Map<string, (page: number | null) => void>();
  private readonly names = new Map<string, Promise<unknown[] | null>>();
  private queue: Job[] = [];
  private running = 0;
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  /** Look-ups started, for tests and measurement. */
  lookups = 0;

  constructor(source: OutlineDestSource, concurrency = OUTLINE_RESOLVE_CONCURRENCY) {
    this.source = source;
    this.concurrency = concurrency;
  }

  /** The cached page for `dest`, without starting a look-up. */
  peek(dest: PdfOutlineDest): OutlinePage {
    if (dest == null) return null;
    const key = destKey(dest);
    if (key === null) return null;
    return this.pages.has(key) ? this.pages.get(key) : undefined;
  }

  /** Resolves `dest` ahead of anything queued by `prefetch`. */
  resolve(dest: PdfOutlineDest): Promise<number | null> {
    return this.request(dest, true);
  }

  /**
   * Queues `dests` behind any click, replacing queued destinations that
   * aren't in this list (rows that scrolled away). Look-ups already running
   * finish either way.
   */
  prefetch(dests: readonly PdfOutlineDest[]): void {
    const wanted = new Set<string>();
    for (const dest of dests) {
      const key = dest == null ? null : destKey(dest);
      if (key !== null) wanted.add(key);
    }
    const keep = (job: Job) => job.urgent || wanted.has(job.key);
    const dropped = this.queue.filter((job) => !keep(job));
    this.queue = this.queue.filter(keep);
    for (const job of dropped) this.forget(job.key);
    for (const dest of dests) void this.request(dest, false);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Drops the queue and stops notifying; later calls resolve to `null`. */
  dispose(): void {
    this.disposed = true;
    const queued = this.queue;
    this.queue = [];
    for (const job of queued) this.forget(job.key);
    this.listeners.clear();
  }

  private request(dest: PdfOutlineDest, urgent: boolean): Promise<number | null> {
    if (dest == null || this.disposed) return Promise.resolve(null);
    const key = destKey(dest);
    if (key === null) return Promise.resolve(null);
    if (this.pages.has(key)) return Promise.resolve(this.pages.get(key)!);
    const existing = this.pending.get(key);
    if (existing) {
      if (urgent) this.promote(key);
      return existing;
    }
    const promise = new Promise<number | null>((settle) => this.settle.set(key, settle));
    this.pending.set(key, promise);
    const job: Job = { key, urgent, run: () => this.lookup(dest) };
    if (urgent) this.queue.unshift(job);
    else this.queue.push(job);
    this.pump();
    return promise;
  }

  private promote(key: string): void {
    const index = this.queue.findIndex((job) => job.key === key);
    if (index < 0) return;
    const [job] = this.queue.splice(index, 1);
    job.urgent = true;
    this.queue.unshift(job);
  }

  /** A queued look-up that was dropped: its waiters get `null` but nothing is cached, so it can be asked for again. */
  private forget(key: string): void {
    const settle = this.settle.get(key);
    this.settle.delete(key);
    this.pending.delete(key);
    settle?.(null);
  }

  private pump(): void {
    while (!this.disposed && this.running < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.running++;
      this.lookups++;
      void job
        .run()
        .catch(() => null)
        .then((page) => {
          this.running--;
          const settle = this.settle.get(job.key);
          this.settle.delete(job.key);
          this.pending.delete(job.key);
          if (!this.disposed) this.pages.set(job.key, page);
          settle?.(this.disposed ? null : page);
          if (!this.disposed) for (const listener of this.listeners) listener();
          this.pump();
        });
    }
  }

  private async lookup(dest: NonNullable<PdfOutlineDest>): Promise<number | null> {
    const explicit = typeof dest === "string" ? await this.namedDestination(dest) : dest;
    const target = explicit?.[0];
    // pdf.js's own link service: an integer is already a 0-based page index.
    if (typeof target === "number")
      return Number.isInteger(target) && target >= 0 ? target + 1 : null;
    if (!target || typeof target !== "object") return null;
    return (await this.source.getPageIndex(target)) + 1;
  }

  private namedDestination(name: string): Promise<unknown[] | null> {
    let promise = this.names.get(name);
    if (!promise) {
      promise = this.source.getDestination(name).catch(() => null);
      this.names.set(name, promise);
    }
    return promise;
  }
}

/** A cache key per destination: its name, or the page it points at. `null` when it points nowhere usable. */
export function destKey(dest: NonNullable<PdfOutlineDest>): string | null {
  if (typeof dest === "string") return "name:" + dest;
  const target = dest[0];
  if (typeof target === "number") return "index:" + target;
  if (target && typeof target === "object") {
    const { num, gen } = target as { num?: unknown; gen?: unknown };
    if (typeof num === "number") return `ref:${num}R${typeof gen === "number" ? gen : 0}`;
  }
  return null;
}
