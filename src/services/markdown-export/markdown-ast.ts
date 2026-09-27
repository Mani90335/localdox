/**
 * Markdown → a flat list of export blocks.
 *
 * The viewer renders markdown through remark/rehype into React. Neither DOCX
 * nor print can consume that: one needs OOXML paragraphs, the other needs a
 * self-contained HTML document with no app chrome, no lazy loading and no
 * virtualised diagrams. Both need the *same* reading of the source, or the two
 * downloads of one document disagree with each other.
 *
 * So the parse lives here, once, and produces a format neither renderer has an
 * opinion about: an ordered list of blocks, each already resolved to the thing
 * that will be written out. Mermaid fences are the reason this matters — they
 * are not code in either target, they are pictures, and they have to be
 * recognised before either writer starts.
 *
 * This is a deliberately small block grammar rather than a general markdown
 * parser. It covers what documents in this app actually contain; anything it
 * does not recognise falls through to a paragraph rather than being dropped,
 * so an unsupported construct degrades to its own text instead of vanishing
 * from the export.
 */

export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  /** Present on a link run; the text is the label. */
  href?: string;
}

export type ExportBlock =
  | { type: "heading"; level: number; runs: InlineRun[] }
  | { type: "paragraph"; runs: InlineRun[] }
  | { type: "list"; ordered: boolean; items: ListItem[] }
  | { type: "code"; language: string; text: string }
  | { type: "mermaid"; code: string }
  | { type: "quote"; blocks: ExportBlock[] }
  | { type: "table"; header: InlineRun[][]; rows: InlineRun[][][] }
  | { type: "rule" }
  | { type: "image"; src: string; alt: string }
  | { type: "math"; tex: string };

export interface ListItem {
  runs: InlineRun[];
  /** Nesting depth, 0 for a top-level item. */
  depth: number;
  /** `- [x]` / `- [ ]`; absent when the item is not a task. */
  checked?: boolean;
  /**
   * This item's own marker, which need not match the list's.
   *
   * Numbered steps with bulleted detail under them are the common shape, and a
   * list carrying one `ordered` flag renders that detail as "a., b." — turning
   * an aside into a sub-procedure. Each item states what it is.
   */
  ordered: boolean;
}

/** Fence languages that mean "this is a diagram", not "this is source code". */
const MERMAID_LANGS = new Set(["mermaid", "mmd"]);

const FENCE_RE = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/;
const ATX_RE = /^(#{1,6})\s+(.*)$/;
const RULE_RE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const UL_RE = /^(\s*)([-*+])\s+(.*)$/;
const OL_RE = /^(\s*)(\d+)[.)]\s+(.*)$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const TABLE_DIVIDER_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;
const IMAGE_ONLY_RE = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/;
const SETEXT_H1_RE = /^\s{0,3}={2,}\s*$/;
const SETEXT_H2_RE = /^\s{0,3}-{2,}\s*$/;

/**
 * Strip a leading YAML front-matter block.
 *
 * Front matter is metadata for the app, not a table the reader asked to print.
 * Left in, it rendered as a stray `---` rule followed by a paragraph of key:
 * value lines at the top of every exported document.
 */
function stripFrontMatter(src: string): string {
  if (!/^---\r?\n/.test(src)) return src;
  const end = src.indexOf("\n---", 4);
  if (end < 0) return src;
  const after = src.indexOf("\n", end + 1);
  return after < 0 ? "" : src.slice(after + 1);
}

/** Split a table row on unescaped pipes, dropping the outer delimiters. */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      current += "|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  // A row written `| a | b |` yields an empty cell at each end; one written
  // `a | b` yields none. Trimming both ends when they are empty handles both.
  if (cells.length && cells[0].trim() === "") cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

/**
 * Inline markdown → styled runs.
 *
 * Hand-written rather than delegated to remark because the output shape is
 * different: remark gives a tree, and both writers want a flat run list with
 * the formatting already accumulated. Walking the string once and carrying the
 * active marks in a small state object produces that directly.
 *
 * Code spans win over everything else: inside a backtick span, `*` and `_` are
 * literal characters, so the scan for them has to stop at the span boundary.
 */
export function parseInline(src: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let text = "";
  const marks = { bold: false, italic: false, strike: false };

  const flush = () => {
    if (!text) return;
    runs.push({
      text,
      ...(marks.bold ? { bold: true } : {}),
      ...(marks.italic ? { italic: true } : {}),
      ...(marks.strike ? { strike: true } : {}),
    });
    text = "";
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    // Escapes: a backslash makes the next character literal.
    if (ch === "\\" && i + 1 < src.length && /[\\`*_[\]()#+\-!>|~]/.test(src[i + 1])) {
      text += src[i + 1];
      i += 2;
      continue;
    }

    // Code span. Match the opening run of backticks with a closing run of the
    // same length, so ``a ` b`` keeps its inner backtick.
    if (ch === "`") {
      const open = /^`+/.exec(src.slice(i))![0];
      const close = src.indexOf(open, i + open.length);
      if (close > 0) {
        flush();
        runs.push({ text: src.slice(i + open.length, close).trim(), code: true });
        i = close + open.length;
        continue;
      }
    }

    // Image — inline, so it can only be carried as its alt text here. A block
    // that is nothing but an image is caught earlier and becomes a real image.
    if (ch === "!" && src[i + 1] === "[") {
      const m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(src.slice(i));
      if (m) {
        flush();
        if (m[1]) runs.push({ text: m[1], italic: true });
        i += m[0].length;
        continue;
      }
    }

    // Link.
    if (ch === "[") {
      const m = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(src.slice(i));
      if (m) {
        flush();
        runs.push({ text: m[1] || m[2], href: m[2] });
        i += m[0].length;
        continue;
      }
    }

    // Bare autolink: <https://…>
    if (ch === "<") {
      const m = /^<((?:https?|mailto):[^>\s]+)>/.exec(src.slice(i));
      if (m) {
        flush();
        runs.push({ text: m[1].replace(/^mailto:/, ""), href: m[1] });
        i += m[0].length;
        continue;
      }
    }

    if (ch === "~" && src[i + 1] === "~") {
      flush();
      marks.strike = !marks.strike;
      i += 2;
      continue;
    }

    // Emphasis. `**`/`__` is bold, a single marker is italic. An underscore
    // inside a word (snake_case, a file name) is not emphasis, so `_` only
    // toggles at a word boundary.
    if (ch === "*" || ch === "_") {
      const double = src[i + 1] === ch;
      const wordInternal =
        ch === "_" && /\w/.test(src[i - 1] ?? "") && /\w/.test(src[i + (double ? 2 : 1)] ?? "");
      if (!wordInternal) {
        flush();
        if (double) marks.bold = !marks.bold;
        else marks.italic = !marks.italic;
        i += double ? 2 : 1;
        continue;
      }
    }

    text += ch;
    i++;
  }

  flush();
  return runs.filter((r) => r.text !== "");
}

/** Everything the parser needs to know that is not in the source text. */
interface ParseState {
  lines: string[];
  index: number;
}

function peek(state: ParseState, offset = 0): string | undefined {
  return state.lines[state.index + offset];
}

/**
 * Collect a list, including nested items.
 *
 * Indentation is converted to a depth rather than kept as a character count:
 * both writers indent by level, and normalising here means a document mixing
 * two-space and four-space nesting exports as one consistent hierarchy.
 */
function parseList(state: ParseState, ordered: boolean): ExportBlock {
  const items: ListItem[] = [];
  const indents: number[] = [];

  while (state.index < state.lines.length) {
    const line = state.lines[state.index];
    const match = ordered ? OL_RE.exec(line) : UL_RE.exec(line);
    const other = ordered ? UL_RE.exec(line) : OL_RE.exec(line);

    // A blank line inside a list is a loose-list separator, not a terminator —
    // but two in a row end it.
    if (!match && !other && line.trim() === "") {
      if (peek(state, 1)?.trim() === "" || !peek(state, 1)) break;
      const next = peek(state, 1) ?? "";
      if (!UL_RE.test(next) && !OL_RE.test(next)) break;
      state.index++;
      continue;
    }

    // A differently-marked list at depth 0 is a new list, not this one.
    const active = match ?? other;
    if (!active) break;
    const indent = active[1].replace(/\t/g, "  ").length;
    if (!match && indent === 0) break;

    let depth = indents.findIndex((width) => width === indent);
    if (depth < 0) {
      // Deeper than anything seen: push a level. Shallower but unseen: snap to
      // the nearest known level so a stray odd indent does not open a new one.
      const deeper = indents.length === 0 || indent > indents[indents.length - 1];
      if (deeper) {
        indents.push(indent);
        depth = indents.length - 1;
      } else {
        depth = indents.reduce(
          (best, width, level) =>
            Math.abs(width - indent) < Math.abs(indents[best] - indent) ? level : best,
          0,
        );
        indents.length = depth + 1;
      }
    }

    let content = active[3];
    let checked: boolean | undefined;
    const task = /^\[([ xX])\]\s+(.*)$/.exec(content);
    if (task) {
      checked = task[1].toLowerCase() === "x";
      content = task[2];
    }

    // Continuation lines: an unmarked, indented line belongs to the item above.
    state.index++;
    while (state.index < state.lines.length) {
      const cont = state.lines[state.index];
      if (cont.trim() === "" || UL_RE.test(cont) || OL_RE.test(cont)) break;
      if (!/^\s{2,}/.test(cont)) break;
      content += ` ${cont.trim()}`;
      state.index++;
    }

    items.push({
      runs: parseInline(content),
      depth,
      // The item's own marker, read from the line rather than inherited from
      // the list — a `1.` nested inside a bullet list is a numbered sub-step.
      ordered: OL_RE.test(line),
      ...(checked === undefined ? {} : { checked }),
    });
  }

  return { type: "list", ordered, items };
}

function parseTable(state: ParseState): ExportBlock {
  const header = splitRow(state.lines[state.index]).map(parseInline);
  state.index += 2; // header + divider
  const rows: InlineRun[][][] = [];
  while (state.index < state.lines.length) {
    const line = state.lines[state.index];
    if (line.trim() === "" || !line.includes("|")) break;
    const cells = splitRow(line).map(parseInline);
    // Pad or trim to the header width so every writer gets a rectangular grid
    // and does not have to guard each cell lookup.
    while (cells.length < header.length) cells.push([]);
    rows.push(cells.slice(0, header.length));
    state.index++;
  }
  return { type: "table", header, rows };
}

function parseQuote(state: ParseState): ExportBlock {
  const inner: string[] = [];
  while (state.index < state.lines.length) {
    const m = QUOTE_RE.exec(state.lines[state.index]);
    if (!m) break;
    inner.push(m[1]);
    state.index++;
  }
  return { type: "quote", blocks: parseMarkdownBlocks(inner.join("\n")) };
}

/**
 * Parse a markdown document into export blocks.
 *
 * Both exporters call this and nothing else, so DOCX and PDF cannot drift in
 * how they read a document — only in how they draw one.
 */
export function parseMarkdownBlocks(source: string): ExportBlock[] {
  const state: ParseState = { lines: stripFrontMatter(source).split(/\r?\n/), index: 0 };
  const blocks: ExportBlock[] = [];

  while (state.index < state.lines.length) {
    const line = state.lines[state.index];

    if (line.trim() === "") {
      state.index++;
      continue;
    }

    // Fenced block: code, a diagram, or display math.
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[2];
      const language = fence[3].toLowerCase();
      state.index++;
      const body: string[] = [];
      while (state.index < state.lines.length) {
        const current = state.lines[state.index];
        if (current.trimStart().startsWith(marker)) {
          state.index++;
          break;
        }
        body.push(current);
        state.index++;
      }
      const text = body.join("\n");
      if (MERMAID_LANGS.has(language)) blocks.push({ type: "mermaid", code: text });
      else if (language === "math" || language === "latex" || language === "tex")
        blocks.push({ type: "math", tex: text });
      else blocks.push({ type: "code", language, text });
      continue;
    }

    // Display math written `$$ … $$` on its own lines.
    if (line.trim() === "$$") {
      state.index++;
      const body: string[] = [];
      while (state.index < state.lines.length && state.lines[state.index].trim() !== "$$") {
        body.push(state.lines[state.index]);
        state.index++;
      }
      state.index++;
      blocks.push({ type: "math", tex: body.join("\n") });
      continue;
    }

    const atx = ATX_RE.exec(line);
    if (atx) {
      blocks.push({
        type: "heading",
        level: atx[1].length,
        // Trailing `###` on a closed ATX heading is punctuation, not text.
        runs: parseInline(atx[2].replace(/\s+#+\s*$/, "")),
      });
      state.index++;
      continue;
    }

    // Setext headings — checked before the thematic-break rule, because
    // `---` under a line of text underlines it rather than drawing a rule.
    const next = peek(state, 1);
    if (next && line.trim() !== "" && !RULE_RE.test(line)) {
      if (SETEXT_H1_RE.test(next)) {
        blocks.push({ type: "heading", level: 1, runs: parseInline(line.trim()) });
        state.index += 2;
        continue;
      }
      if (SETEXT_H2_RE.test(next) && !UL_RE.test(line)) {
        blocks.push({ type: "heading", level: 2, runs: parseInline(line.trim()) });
        state.index += 2;
        continue;
      }
    }

    if (RULE_RE.test(line)) {
      blocks.push({ type: "rule" });
      state.index++;
      continue;
    }

    const imageOnly = IMAGE_ONLY_RE.exec(line);
    if (imageOnly) {
      blocks.push({ type: "image", src: imageOnly[2], alt: imageOnly[1] });
      state.index++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      blocks.push(parseQuote(state));
      continue;
    }

    if (line.includes("|") && next && TABLE_DIVIDER_RE.test(next)) {
      blocks.push(parseTable(state));
      continue;
    }

    if (UL_RE.test(line)) {
      blocks.push(parseList(state, false));
      continue;
    }
    if (OL_RE.test(line)) {
      blocks.push(parseList(state, true));
      continue;
    }

    // Paragraph: everything up to the next blank line or block opener.
    const paragraph: string[] = [];
    while (state.index < state.lines.length) {
      const current = state.lines[state.index];
      if (
        current.trim() === "" ||
        ATX_RE.test(current) ||
        FENCE_RE.test(current) ||
        RULE_RE.test(current) ||
        QUOTE_RE.test(current) ||
        UL_RE.test(current) ||
        OL_RE.test(current)
      )
        break;
      paragraph.push(current.trim());
      state.index++;
    }
    if (paragraph.length)
      blocks.push({ type: "paragraph", runs: parseInline(paragraph.join(" ")) });
  }

  return blocks;
}

/** Plain text of a run list — for alt text, bookmarks and outline entries. */
export function runsToText(runs: InlineRun[]): string {
  return runs.map((r) => r.text).join("");
}

/**
 * How much width one table column wants, in characters.
 *
 * Shared by both writers so a table is proportioned the same in the `.docx` and
 * the PDF — a reader comparing the two downloads of one document should not
 * find the columns rearranged between them.
 *
 * Two things decide it, and a column needs both:
 *
 *  - The longest unbreakable token, because a column narrower than that forces
 *    a mid-word break however many lines it is given.
 *  - Some of the total length, because a column of sentences and a column of
 *    single words can share a longest word and still need very different room.
 *    Weighted by a square root rather than taken whole: a 60-character note
 *    should be wider than a 10-character one, but not six times wider, or one
 *    prose column takes the entire table.
 *
 * Both are read at the 90th percentile over the column's cells, so a single
 * outlier row cannot claim the width that nine ordinary ones need.
 */
export function columnWidthDemand(header: InlineRun[], cells: InlineRun[][]): number {
  const longestWord = (runs: InlineRun[]) =>
    runsToText(runs)
      .split(/\s+/)
      .reduce((max, word) => Math.max(max, word.length), 0);

  const percentile = (values: number[]): number => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    // `ceil(n * 0.9) - 1` rather than `floor(n * 0.9)`: the latter indexes the
    // last element for every n that is a multiple of ten, which makes the
    // "90th percentile" the maximum and lets a single outlier row set the
    // column's width after all — the thing this is here to prevent.
    return sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)];
  };

  const headerText = runsToText(header);
  const token = Math.max(longestWord(header), percentile(cells.map(longestWord)));
  const bulk = Math.max(headerText.length, percentile(cells.map((c) => runsToText(c).length)));

  // A header is read on every page of a long table, so it is worth a little
  // more than a value read once.
  return Math.max(4, token, headerText.length * 0.9, Math.sqrt(bulk) * 2.2);
}
