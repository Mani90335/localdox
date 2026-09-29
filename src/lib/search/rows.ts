import GithubSlugger from "github-slugger";

// Splits a markdown file into the rows search matches against: one per source
// line, holding the text a reader actually sees on that line. Kept free of
// DOM and worker dependencies so the search worker (which finds hits) and the
// viewer (which lands on them) read a document identically.

export interface SearchRow {
  /** The line's visible text: markdown syntax stripped, code kept verbatim. */
  text: string;
  /** Nearest heading at or above this line, "" before the first one. */
  headingId: string;
  headingText: string;
  isHeading: boolean;
  /** 0-based line number in the source file. */
  lineIndex: number;
  /**
   * False for fenced blocks the viewer draws as something other than their
   * source (a diagram, a mind map, an embedded app), so the rendered page
   * need not contain this text.
   */
  rendered: boolean;
}

/** Fence languages the viewer replaces with a rendering of their source. */
const DRAWN_FENCES = new Set([
  "mermaid",
  "mindmap",
  "interactive-html",
  "interactive-react",
  "json",
]);

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  "#39": "'",
};

/** Inline markdown reduced to the characters it renders as. */
export function visibleInline(line: string): string {
  let text = line;
  // Code spans keep their content verbatim; pull them out first so nothing
  // below rewrites what is inside them.
  const spans: string[] = [];
  text = text.replace(/(`+)(.+?)\1/g, (_, _ticks, code: string) => {
    spans.push(
      code.length > 2 && code.startsWith(" ") && code.endsWith(" ") ? code.slice(1, -1) : code,
    );
    return `\uE000${spans.length - 1}\uE000`;
  });
  text = text
    // Images and links show their alt text / label, not the URL.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    // Footnote references render as their label.
    .replace(/\[\^([^\]]+)\]/g, "$1")
    // Autolinks show the address itself.
    .replace(/<([a-z][a-z\d+.-]{1,31}:[^\s<>]*)>/gi, "$1")
    .replace(/<([^\s<>@]+@[^\s<>]+)>/g, "$1")
    // HTML tags vanish; their text content stays.
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    // Emphasis and strikethrough markers. `_` only at word edges, so
    // snake_case identifiers survive.
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, "$1")
    .replace(/(?<![\p{L}\p{N}_])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, "$1")
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "$1")
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(/&(#39|[a-z]+);/gi, (entity, name: string) => ENTITIES[name.toLowerCase()] ?? entity);
  return text.replace(/\uE000(\d+)\uE000/g, (_, i: string) => spans[Number(i)]);
}

/** Block syntax at the start of a line: quotes, list bullets, task boxes. */
function stripBlockPrefix(line: string): string {
  return line
    .replace(/^\s*(?:>\s?)+/, "")
    .replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+/, "")
    .replace(/^\[[ xX]\]\s+/, "");
}

const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const THEMATIC_BREAK = /^\s{0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const SETEXT_UNDERLINE = /^\s{0,3}(?:=+|-+)\s*$/;
const LINK_DEFINITION = /^\s{0,3}\[(?!\^)[^\]]+\]:\s*\S/;
const HTML_COMMENT = /^\s*<!--.*-->\s*$/;

export function parseRows(content: string): SearchRow[] {
  const rows: SearchRow[] = [];
  const slugger = new GithubSlugger();
  let heading: { id: string; text: string } | undefined;
  let fence: { marker: string; length: number; rendered: boolean } | undefined;
  const lines = content.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].replace(/\r$/, "");
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) {
        const lang = fenceMatch[2].trim().split(/\s+/)[0]?.toLowerCase() ?? "";
        fence = { marker, length: fenceMatch[1].length, rendered: !DRAWN_FENCES.has(lang) };
        continue;
      }
      if (
        marker === fence.marker &&
        fenceMatch[1].length >= fence.length &&
        !fenceMatch[2].trim()
      ) {
        fence = undefined;
        continue;
      }
    }
    const base = {
      headingId: heading?.id ?? "",
      headingText: heading?.text ?? "",
      lineIndex,
    };
    if (fence) {
      // Code renders verbatim, so it is searched verbatim.
      if (line.trim())
        rows.push({ ...base, text: line, isHeading: false, rendered: fence.rendered });
      continue;
    }
    if (
      !line.trim() ||
      THEMATIC_BREAK.test(line) ||
      SETEXT_UNDERLINE.test(line) ||
      TABLE_DIVIDER.test(line) ||
      LINK_DEFINITION.test(line) ||
      HTML_COMMENT.test(line)
    )
      continue;

    const hm = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (hm) {
      const raw = hm[2].trim();
      heading = { id: slugger.slug(raw || "section"), text: visibleInline(raw).trim() };
      rows.push({
        text: heading.text,
        headingId: heading.id,
        headingText: heading.text,
        isHeading: true,
        lineIndex,
        rendered: true,
      });
      continue;
    }

    let text = line;
    if (/^\s*\|.*\|\s*$/.test(text)) {
      // A table row: its cells, separated by a tab so that — as on the
      // page, where each is its own box — no query matches across two.
      text = text
        .trim()
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) => visibleInline(cell.trim()))
        .join("\t");
    } else {
      text = visibleInline(stripBlockPrefix(text).replace(/^\s*\[\^[^\]]+\]:\s*/, "")).trim();
    }
    if (text) rows.push({ ...base, text, isHeading: false, rendered: true });
  }
  return rows;
}

/**
 * The pattern every search surface matches a query with: literal and
 * case-insensitive. Matching the original string (rather than lowercasing
 * it) keeps offsets valid for characters whose lowercase has another length.
 */
export function queryPattern(query: string): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
}

/**
 * Where occurrence `occurrence` of `query` on row `lineIndex` falls among all
 * of the query's occurrences in `rows`, counting only rows the viewer renders
 * as written. `null` when that hit is not on such a row.
 */
export function occurrenceOrdinal(
  rows: SearchRow[],
  query: string,
  lineIndex: number,
  occurrence: number,
): { ordinal: number; total: number } | null {
  const pattern = queryPattern(query.trim());
  let total = 0;
  let ordinal: number | null = null;
  for (const row of rows) {
    if (!row.rendered) continue;
    pattern.lastIndex = 0;
    let n = 0;
    while (pattern.exec(row.text)) {
      if (row.lineIndex === lineIndex && n === occurrence) ordinal = total;
      n++;
      total++;
    }
  }
  return ordinal === null ? null : { ordinal, total };
}
