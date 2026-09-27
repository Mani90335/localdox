import GithubSlugger from "github-slugger";

export interface SearchFile {
  id: string;
  name: string;
  content: string;
}
export interface SearchHit {
  fileId: string;
  fileName: string;
  headingId?: string;
  headingText?: string;
  snippet: string;
  /**
   * The matched line in full, untruncated.
   *
   * `snippet` is clipped with ellipses for display, which makes it useless for
   * finding the match again in the rendered document. The reader asked to be
   * taken to *this line*; scrolling to the heading above it was as close as the
   * viewer could get, and when the heading's slug didn't survive per-page
   * rendering it fell back to the top of the page instead.
   */
  line: string;
  score: number;
}
interface SearchRow {
  text: string;
  lower: string;
  headingId?: string;
  headingText?: string;
  heading: boolean;
}
interface IndexedFile {
  content: string;
  rows: SearchRow[];
}

/** A per-palette index; discarded when search closes. No binary data is indexed. */
export class DocumentSearch {
  private index = new Map<string, IndexedFile>();

  // A generator gives both workers and the no-worker fallback cancellation and
  // regular event-loop yields, including while indexing a single large file.
  *search(files: SearchFile[], query: string): Generator<void, SearchHit[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const ids = new Set(files.map((file) => file.id));
    for (const id of this.index.keys()) if (!ids.has(id)) this.index.delete(id);
    const hits: SearchHit[] = [];
    const add = (hit: SearchHit) => {
      // Retain only the best 60 hits, even if every line matches.
      const at = hits.findIndex((previous) => previous.score < hit.score);
      if (at < 0) {
        if (hits.length < 60) hits.push(hit);
      } else {
        hits.splice(at, 0, hit);
        if (hits.length > 60) hits.pop();
      }
    };
    for (const file of files) {
      let indexed = this.index.get(file.id);
      if (!indexed || indexed.content !== file.content) {
        const rows: SearchRow[] = [];
        const slugger = new GithubSlugger();
        let heading: { id: string; text: string } | undefined;
        let fence: { marker: string; length: number } | undefined;
        let count = 0;
        // matchAll avoids allocating a second full array of document lines.
        for (const match of file.content.matchAll(/[^\n]+/g)) {
          if (++count % 256 === 0) yield;
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
            continue;
          }
          if (fence) continue;
          const hm = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
          const text = hm ? hm[2].trim() : line;
          if (hm) heading = { id: slugger.slug(text || "section"), text };
          rows.push({
            text,
            lower: text.toLowerCase(),
            headingId: heading?.id,
            headingText: heading?.text,
            heading: !!hm,
          });
        }
        indexed = { content: file.content, rows };
        this.index.set(file.id, indexed);
      }
      if (file.name.toLowerCase().includes(q))
        add({ fileId: file.id, fileName: file.name, snippet: file.name, line: "", score: 80 });
      let count = 0;
      for (const row of indexed.rows) {
        if (++count % 256 === 0) yield;
        const at = row.lower.indexOf(q);
        if (at < 0) continue;
        const start = Math.max(0, at - 40);
        const end = Math.min(row.text.length, at + q.length + 60);
        add({
          fileId: file.id,
          fileName: file.name,
          headingId: row.headingId,
          headingText: row.headingText,
          snippet: row.heading
            ? row.text
            : (start ? "…" : "") + row.text.slice(start, end) + (end < row.text.length ? "…" : ""),
          line: row.text,
          score: row.heading ? 100 + (at === 0 ? 20 : 0) : 50,
        });
      }
      yield;
    }
    return hits;
  }
}

export async function runSearch(
  index: DocumentSearch,
  files: SearchFile[],
  query: string,
  cancelled: () => boolean,
): Promise<SearchHit[] | null> {
  const work = index.search(files, query);
  while (!cancelled()) {
    const deadline = performance.now() + 6;
    do {
      const step = work.next();
      if (step.done) return step.value;
    } while (performance.now() < deadline && !cancelled());
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  work.return([]);
  return null;
}
