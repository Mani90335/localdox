import GithubSlugger from "github-slugger";
import {
  create,
  insertMultiple,
  removeMultiple,
  search as oramaSearch,
  type AnyOrama,
} from "@orama/orama";
import {
  rowSchema,
  SEARCH_RESULT_LIMIT,
  type SearchFile,
  type SearchHit,
  type SearchRowDoc,
} from "./schema.ts";

interface ParsedRow {
  text: string;
  headingId: string;
  headingText: string;
  isHeading: boolean;
  lineIndex: number;
}

/** Splits a file's content into matchable rows: one per non-fenced line,
 *  tracking the nearest enclosing heading. Ported from the previous
 *  substring engine — fence/heading detection stays regex-based because
 *  Orama has no opinion on markdown structure. */
function parseRows(content: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const slugger = new GithubSlugger();
  let heading: { id: string; text: string } | undefined;
  let fence: { marker: string; length: number } | undefined;
  let lineIndex = 0;
  for (const match of content.matchAll(/[^\n]+/g)) {
    const line = match[0].replace(/\r$/, "");
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = { marker, length: fenceMatch[1].length };
      else if (
        marker === fence.marker &&
        fenceMatch[1].length >= fence.length &&
        !fenceMatch[2].trim()
      )
        fence = undefined;
      lineIndex++;
      continue;
    }
    if (fence) {
      lineIndex++;
      continue;
    }
    const hm = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    const text = hm ? hm[2].trim() : line;
    if (hm) heading = { id: slugger.slug(text || "section"), text };
    rows.push({
      text,
      headingId: heading?.id ?? "",
      headingText: heading?.text ?? "",
      isHeading: !!hm,
      lineIndex,
    });
    lineIndex++;
  }
  return rows;
}

function rowDoc(
  workspaceId: string,
  file: SearchFile,
  row: ParsedRow,
): SearchRowDoc & { id: string } {
  return {
    id: `${workspaceId}\u0000${file.id}\u0000${row.lineIndex}`,
    workspaceId,
    fileId: file.id,
    fileName: file.name,
    text: row.text,
    headingText: row.headingText,
    headingOwnText: row.isHeading ? row.text : "",
    headingId: row.headingId,
    lineIndex: row.lineIndex,
    isHeading: row.isHeading,
  };
}

function filenameDoc(workspaceId: string, file: SearchFile): SearchRowDoc & { id: string } {
  return {
    id: `${workspaceId}\u0000${file.id}\u0000-1`,
    workspaceId,
    fileId: file.id,
    fileName: file.name,
    text: file.name,
    headingText: "",
    headingOwnText: "",
    headingId: "",
    lineIndex: -1,
    isHeading: false,
  };
}

async function yieldToMainThread(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** How many files' worth of rows to insert before yielding to the event
 *  loop — matters only for a large batch (a lazily-fetched other workspace
 *  indexed on the main thread when the worker is unavailable); the common
 *  case of re-indexing a handful of changed files never hits this. */
const FILES_PER_INSERT_BATCH = 15;

interface FileCacheEntry {
  content: string;
  rowIds: string[];
}

/** Owns one shared Orama index across every currently-synced workspace.
 *  One shared index (rather than one per workspace) is what makes BM25
 *  ranking comparable across workspaces when cross-workspace search is on —
 *  scores from separate indexes can't be merged meaningfully, but scores
 *  within one index, filtered by `where`, can. */
export class DocumentIndex {
  private db: AnyOrama = create({
    schema: rowSchema,
    components: { tokenizer: { language: "english", stemming: true } },
  });
  private cache = new Map<string, Map<string, FileCacheEntry>>();

  async syncWorkspace(workspaceId: string, files: SearchFile[]): Promise<void> {
    let workspaceCache = this.cache.get(workspaceId);
    if (!workspaceCache) {
      workspaceCache = new Map();
      this.cache.set(workspaceId, workspaceCache);
    }

    const seen = new Set(files.map((file) => file.id));
    const staleIds: string[] = [];
    for (const [fileId, entry] of workspaceCache) {
      if (!seen.has(fileId)) {
        staleIds.push(...entry.rowIds);
        workspaceCache.delete(fileId);
      }
    }
    if (staleIds.length) await removeMultiple(this.db, staleIds);

    const changed = files.filter((file) => workspaceCache!.get(file.id)?.content !== file.content);
    for (let i = 0; i < changed.length; i += FILES_PER_INSERT_BATCH) {
      const batch = changed.slice(i, i + FILES_PER_INSERT_BATCH);
      const toRemove = batch.flatMap((file) => workspaceCache!.get(file.id)?.rowIds ?? []);
      if (toRemove.length) await removeMultiple(this.db, toRemove);

      const rowsByFile = batch.map((file) => parseRows(file.content));
      const docs = batch.flatMap((file, i) => [
        filenameDoc(workspaceId, file),
        ...rowsByFile[i].map((row) => rowDoc(workspaceId, file, row)),
      ]);
      const ids = docs.length ? await insertMultiple(this.db, docs) : [];

      let cursor = 0;
      for (let i = 0; i < batch.length; i++) {
        const rowCount = 1 + rowsByFile[i].length;
        workspaceCache.set(batch[i].id, {
          content: batch[i].content,
          rowIds: ids.slice(cursor, cursor + rowCount),
        });
        cursor += rowCount;
      }
      if (i + FILES_PER_INSERT_BATCH < changed.length) await yieldToMainThread();
    }
  }

  async dropWorkspace(workspaceId: string): Promise<void> {
    const workspaceCache = this.cache.get(workspaceId);
    if (!workspaceCache) return;
    const ids = [...workspaceCache.values()].flatMap((entry) => entry.rowIds);
    if (ids.length) await removeMultiple(this.db, ids);
    this.cache.delete(workspaceId);
  }

  async search(
    query: string,
    workspaceIds: string[],
    limit = SEARCH_RESULT_LIMIT,
  ): Promise<SearchHit[]> {
    const term = query.trim();
    if (!term || !workspaceIds.length) return [];
    const results = await oramaSearch(this.db, {
      term,
      properties: ["headingOwnText", "headingText", "fileName", "text"],
      boost: { headingOwnText: 3, headingText: 1.4, fileName: 1.6, text: 1 },
      tolerance: 1,
      limit,
      where: { workspaceId: { in: workspaceIds } },
    });
    const hits: SearchHit[] = [];
    for (const { document, score } of results.hits) {
      const row = document as unknown as SearchRowDoc;
      const base = {
        workspaceId: row.workspaceId,
        fileId: row.fileId,
        fileName: row.fileName,
        headingId: row.headingId || undefined,
        headingText: row.headingText || undefined,
        lineIndex: row.lineIndex,
        score,
      };
      if (row.lineIndex < 0) {
        hits.push({ ...base, snippet: row.fileName, line: "", occurrence: 0 });
        continue;
      }
      // A line is one row, but the query can occur in it more than once — each
      // occurrence gets its own hit, so the sidebar lists (and can jump to)
      // every one of them rather than just the line as a whole.
      const at = literalOccurrences(row.text, term);
      if (!at.length) {
        hits.push({ ...base, snippet: headSnippet(row.text), line: row.text, occurrence: 0 });
        continue;
      }
      at.forEach((start, occurrence) => {
        hits.push({
          ...base,
          snippet: snippetAt(row.text, start, term.length),
          line: row.text,
          occurrence,
        });
      });
    }
    return hits;
  }
}

/** Every case-insensitive occurrence of `term` in `text`, left to right. */
function literalOccurrences(text: string, term: string): number[] {
  const lowerText = text.toLowerCase();
  const lowerTerm = term.toLowerCase();
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = lowerText.indexOf(lowerTerm, from);
    if (at < 0) return out;
    out.push(at);
    from = at + lowerTerm.length;
  }
}

/** Truncates around one located occurrence of the query. */
function snippetAt(text: string, at: number, termLength: number): string {
  const start = Math.max(0, at - 40);
  const end = Math.min(text.length, at + termLength + 60);
  return (start ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

/** A stemmed or fuzzy/typo match may have no literal occurrence in the row
 *  (query "run" hitting stored "running") — falls back to a head-truncated
 *  snippet, same as VS Code's own fuzzy mode does. */
function headSnippet(text: string): string {
  return text.length > 100 ? `${text.slice(0, 100)}…` : text;
}
