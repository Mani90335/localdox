import { parseRows, queryPattern, type SearchRow } from "./rows.ts";
import {
  SEARCH_RESULT_LIMIT,
  type SearchFile,
  type SearchHit,
  type SearchResults,
} from "./schema.ts";

/** One file as the index holds it: its rows, plus their text joined with
 *  "\n" so a query runs as a single regex pass over the whole file. */
interface IndexedFile {
  name: string;
  content: string;
  rows: SearchRow[];
  joined: string;
  /** starts[i] = offset of rows[i] within `joined`. */
  starts: number[];
}

function indexFile(file: SearchFile): IndexedFile {
  const rows = parseRows(file.content);
  const starts: number[] = [];
  let at = 0;
  for (const row of rows) {
    starts.push(at);
    at += row.text.length + 1;
  }
  return {
    name: file.name,
    content: file.content,
    rows,
    joined: rows.map((row) => row.text).join("\n"),
    starts,
  };
}

/** Index of the last row starting at or before `offset`. */
function rowAt(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** True when the match is a whole word, not part of a longer one. */
function wholeWord(text: string, start: number, end: number): boolean {
  return !WORD_CHAR.test(text[start - 1] ?? "") && !WORD_CHAR.test(text[end] ?? "");
}

/** How strongly one occurrence suggests the file is what was looked for. */
function hitScore(row: SearchRow, text: string, start: number, end: number): number {
  return (row.isHeading ? 2 : 0) + (wholeWord(text, start, end) ? 2 : 1);
}

const FILENAME_SCORE = 5;

/** Characters of context kept before a match in a result's snippet. The
 *  sidebar row truncates the end, so a short lead keeps the match visible. */
const SNIPPET_LEAD = 24;
const SNIPPET_TAIL = 80;

function snippetAround(text: string, start: number, length: number) {
  let from = Math.max(0, start - SNIPPET_LEAD);
  // Start on a word boundary when one is close, so the snippet doesn't open
  // on half a word.
  if (from > 0) {
    const space = text.indexOf(" ", from);
    if (space >= 0 && space < start) from = space + 1;
  }
  const to = Math.min(text.length, start + length + SNIPPET_TAIL);
  const lead = from > 0 ? "…" : "";
  return {
    snippet: lead + text.slice(from, to) + (to < text.length ? "…" : ""),
    matchStart: lead.length + start - from,
  };
}

interface FileResult {
  hits: SearchHit[];
  score: number;
  count: number;
}

/**
 * The search index for every currently-synced workspace: exact,
 * case-insensitive find-in-files over what each line renders as.
 *
 * A reader searching for a word expects every place that word appears and
 * nothing else — so there is no stemming, no typo tolerance and no matching
 * a line because of the heading or file it sits under. Ranking only orders
 * files (filename and heading matches, then whole-word matches, first);
 * within a file, hits stay in document order.
 *
 * Operations run one at a time, in the order they were called, so a search
 * always sees every sync and drop sent before it.
 */
export class DocumentIndex {
  private workspaces = new Map<string, Map<string, IndexedFile>>();
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;

  private exclusive<T>(operation: () => T | Promise<T>): Promise<T> {
    const run = this.queue.then(operation);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Brings the workspace's rows in line with `files`. Resolves with the
   *  index generation afterwards, which advances only when rows changed. */
  syncWorkspace(workspaceId: string, files: SearchFile[]): Promise<number> {
    return this.exclusive(() => {
      if (this.applySync(workspaceId, files)) this.generation++;
      return this.generation;
    });
  }

  private applySync(workspaceId: string, files: SearchFile[]): boolean {
    const previous = this.workspaces.get(workspaceId);
    const next = new Map<string, IndexedFile>();
    let changed = !previous || previous.size !== files.length;
    for (const file of files) {
      const cached = previous?.get(file.id);
      if (cached && cached.content === file.content && cached.name === file.name) {
        next.set(file.id, cached);
        continue;
      }
      // Built before anything is replaced, so a file that fails to parse
      // leaves the workspace exactly as it was.
      next.set(file.id, indexFile(file));
      changed = true;
    }
    this.workspaces.set(workspaceId, next);
    return changed;
  }

  /** Removes every row for the workspace. Resolves with the generation. */
  dropWorkspace(workspaceId: string): Promise<number> {
    return this.exclusive(() => {
      if (this.workspaces.delete(workspaceId)) this.generation++;
      return this.generation;
    });
  }

  /** Searches after every sync or drop called before it has applied. */
  search(
    query: string,
    workspaceIds: string[],
    limit = SEARCH_RESULT_LIMIT,
  ): Promise<SearchResults> {
    return this.exclusive(() => this.runSearch(query, workspaceIds, limit));
  }

  private runSearch(query: string, workspaceIds: string[], limit: number): SearchResults {
    const term = query.trim();
    if (!term) return { hits: [], total: 0 };
    const pattern = queryPattern(term);
    const hits: SearchHit[] = [];
    let total = 0;
    // Workspaces in the order asked for (the current one first), files by
    // relevance within each.
    for (const workspaceId of new Set(workspaceIds)) {
      const files = this.workspaces.get(workspaceId);
      if (!files) continue;
      const results: FileResult[] = [];
      for (const [fileId, file] of files) {
        const result = this.searchFile(workspaceId, fileId, file, pattern);
        if (result.count) results.push(result);
      }
      results.sort((a, b) => b.score - a.score || b.count - a.count);
      for (const result of results) {
        total += result.count;
        for (const hit of result.hits) {
          if (hits.length >= limit) break;
          hits.push(hit);
        }
      }
    }
    return { hits, total };
  }

  private searchFile(
    workspaceId: string,
    fileId: string,
    file: IndexedFile,
    pattern: RegExp,
  ): FileResult {
    const hits: SearchHit[] = [];
    let score = 0;
    const base = { workspaceId, fileId, fileName: file.name };

    pattern.lastIndex = 0;
    const nameMatch = pattern.exec(file.name);
    if (nameMatch) {
      score = FILENAME_SCORE;
      hits.push({
        ...base,
        snippet: file.name,
        matchStart: nameMatch.index,
        matchLength: nameMatch[0].length,
        line: "",
        lineIndex: -1,
        occurrence: 0,
        score: FILENAME_SCORE,
      });
    }

    pattern.lastIndex = 0;
    let lastRow = -1;
    let occurrence = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(file.joined))) {
      const index = rowAt(file.starts, match.index);
      const row = file.rows[index];
      const start = match.index - file.starts[index];
      // A query can't span two lines; one that ran past this row's end
      // matched the "\n" joining it to the next.
      if (start + match[0].length > row.text.length) {
        pattern.lastIndex = match.index + 1;
        continue;
      }
      occurrence = index === lastRow ? occurrence + 1 : 0;
      lastRow = index;
      const hitValue = hitScore(row, row.text, start, start + match[0].length);
      score = Math.max(score, hitValue);
      const { snippet, matchStart } = snippetAround(row.text, start, match[0].length);
      hits.push({
        ...base,
        headingId: row.headingId || undefined,
        headingText: row.headingText || undefined,
        snippet,
        matchStart,
        matchLength: match[0].length,
        line: row.text,
        lineIndex: row.lineIndex,
        occurrence,
        score: hitValue,
      });
    }
    return { hits, score, count: hits.length };
  }
}
