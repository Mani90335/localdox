// A selection in the reader, as clean Markdown.
//
// `Selection.toString()` is the wrong thing to keep: it flattens a table into
// tab-separated text, drops list markers and code fences, and spells an
// equation out three times (KaTeX's visual spans, its MathML, and the LaTeX
// annotation). The rendered DOM also carries the reader's own chrome — copy
// buttons, heading-fold toggles, stars, equation numbers — which is not part of
// the document at all.
//
// So the selection is converted in two steps:
//
//  1. `capture` walks the live DOM between the selection's two boundary points
//     and builds a small tree of just what was selected, clipping text at the
//     ends, dropping viewer chrome, and replacing any equation the selection
//     touches with its LaTeX source.
//  2. `render` turns that tree into Markdown: paragraphs, headings, lists (with
//     task boxes), GFM tables, fenced code with its language, blockquotes and
//     callouts, inline emphasis, code, links and math.
//
// Both steps read the DOM through a minimal structural interface (no `Node`
// globals, no `Range` methods), so the whole conversion runs — and is tested —
// outside a browser.

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** The parts of a DOM node this module reads. A real `Node` satisfies it. */
export interface DomNodeLike {
  nodeType: number;
  nodeName: string;
  childNodes: ArrayLike<DomNodeLike>;
  parentNode: DomNodeLike | null;
  textContent: string | null;
  getAttribute?(name: string): string | null;
  /** `HTMLInputElement.checked` — React sets the property, not the attribute. */
  checked?: boolean;
}

/** A selection's boundary points, as a `Range` carries them. */
export interface SelectionBounds {
  startContainer: DomNodeLike;
  startOffset: number;
  endContainer: DomNodeLike;
  endOffset: number;
  commonAncestorContainer: DomNodeLike;
}

/**
 * The fenced source of a diagram drawn at `node`, if one is — supplied by the
 * caller (the reader registers its diagrams; see diagram-sources.ts).
 */
export type DiagramLookup = (node: DomNodeLike) => { lang: string; source: string } | undefined;

type Piece =
  | { kind: "text"; text: string }
  | { kind: "math"; latex: string; display: boolean }
  | { kind: "fence"; lang: string; text: string }
  | { kind: "el"; tag: string; attrs: Record<string, string>; children: Piece[] };

type Element = Extract<Piece, { kind: "el" }>;

const tagOf = (node: DomNodeLike) => node.nodeName.toLowerCase();
const attr = (node: DomNodeLike, name: string) => node.getAttribute?.(name) ?? null;
const classes = (node: DomNodeLike) => ` ${attr(node, "class") ?? ""} `;
const hasClass = (node: DomNodeLike, name: string) => classes(node).includes(` ${name} `);

// ---- what the reader added to the page ------------------------------------

/** Controls and decoration the viewer draws around the document. */
const CHROME_TAGS = new Set([
  "button",
  "svg",
  "script",
  "style",
  "noscript",
  "template",
  "textarea",
  "select",
  "iframe",
  "canvas",
  "video",
  "audio",
]);

const CHROME_CLASSES = ["docs-callout-mark", "docs-callout-label", "docs-math-number"];

function isChrome(node: DomNodeLike): boolean {
  const tag = tagOf(node);
  if (CHROME_TAGS.has(tag)) return true;
  // A task list's box is content; any other input is a control.
  if (tag === "input") return attr(node, "type") !== "checkbox";
  if (attr(node, "data-viewer-ui") !== null) return true;
  if (attr(node, "aria-hidden") === "true") return true;
  return CHROME_CLASSES.some((name) => hasClass(node, name));
}

// ---- equations --------------------------------------------------------------

/** The element wrapping one typeset equation (see services/math/MathNode). */
function isMath(node: DomNodeLike): boolean {
  if (node.nodeType !== ELEMENT_NODE) return false;
  const tag = tagOf(node);
  if (tag === "math" || tag === "mjx-container") return true;
  const cls = classes(node);
  return / docs-math-(?:inline|block|pending|pending-block|error|error-inline) /.test(cls);
}

function isDisplayMath(node: DomNodeLike): boolean {
  const cls = classes(node);
  if (/ docs-math-(?:block|pending-block|error) /.test(cls)) return true;
  return attr(node, "display") === "block" || attr(node, "display") === "true";
}

function find(node: DomNodeLike, test: (n: DomNodeLike) => boolean): DomNodeLike | null {
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType !== ELEMENT_NODE) continue;
    if (test(child)) return child;
    const deeper = find(child, test);
    if (deeper) return deeper;
  }
  return null;
}

/**
 * The LaTeX an equation was typeset from.
 *
 * KaTeX and Temml both embed the source as a MathML `<annotation>` (unwrapped
 * to plain text by the sanitizer — see below); an equation still typesetting,
 * or one that failed, shows its source as text.
 * MathJax keeps no source in the DOM, so its MathML text is the best left.
 */
function latexOf(node: DomNodeLike): string {
  const annotation = find(
    node,
    (n) => tagOf(n) === "annotation" && attr(n, "encoding") === "application/x-tex",
  );
  if (annotation) return (annotation.textContent ?? "").trim();
  if (hasClass(node, "docs-math-error")) {
    const source = find(node, (n) => hasClass(n, "docs-math-source"));
    if (source) return (source.textContent ?? "").trim();
  }
  const math = tagOf(node) === "math" ? node : find(node, (n) => tagOf(n) === "math");
  const alt = math && attr(math, "alttext");
  if (alt) return alt.trim();
  // The app's sanitizer (services/math/sanitize.ts) unwraps <semantics> and
  // <annotation> but keeps their text, which leaves the LaTeX as a bare text
  // node directly inside <math>, beside the presentation markup.
  if (math) {
    let own = "";
    for (let i = 0; i < math.childNodes.length; i++) {
      const child = math.childNodes[i];
      if (child.nodeType === TEXT_NODE) own += child.textContent ?? "";
    }
    if (own.trim()) return own.trim();
  }
  return ((math ?? node).textContent ?? "").replace(/\s+/g, " ").trim();
}

// ---- step 1: capture what was selected --------------------------------------

/** Element attributes the Markdown needs; everything else is presentation. */
const KEPT_ATTRS = ["href", "src", "alt", "class", "start", "type"];

const VOID_TAGS = new Set(["img", "br", "hr", "input"]);

/**
 * Copy the part of `root` between the selection's boundary points.
 *
 * A boundary point is (container, offset): a character offset when the
 * container is a text node, a child index when it is an element — the same
 * convention `Range` uses. The walk runs in document order and switches
 * "inside" on at the start point and off at the end point, so it needs nothing
 * from the DOM beyond children and parents. Without `bounds`, all of `root` is
 * captured.
 */
function capture(
  root: DomNodeLike,
  bounds?: SelectionBounds,
  diagramOf?: DiagramLookup,
): Piece | null {
  let state: "before" | "inside" | "after" = bounds ? "before" : "inside";

  const visit = (node: DomNodeLike): Piece | null => {
    if (node.nodeType === TEXT_NODE) {
      const data = node.textContent ?? "";
      let from = 0;
      let to = data.length;
      let on = state === "inside";
      if (bounds && node === bounds.startContainer) {
        from = bounds.startOffset;
        on = true;
        state = "inside";
      }
      if (bounds && node === bounds.endContainer) {
        to = bounds.endOffset;
        state = "after";
      }
      const text = on ? data.slice(from, Math.max(from, to)) : "";
      return text ? { kind: "text", text } : null;
    }
    if (node.nodeType !== ELEMENT_NODE) return null;

    const entry = state;
    const children: Piece[] = [];
    const count = node.childNodes.length;
    for (let i = 0; i <= count; i++) {
      if (bounds && node === bounds.startContainer && i === bounds.startOffset) state = "inside";
      if (bounds && node === bounds.endContainer && i === bounds.endOffset) state = "after";
      if (i === count) break;
      const piece = visit(node.childNodes[i]);
      if (piece) children.push(piece);
    }

    // Likewise a diagram: its SVG text is node labels and Mermaid's stylesheet,
    // so any part of it copies as the source it was drawn from.
    const diagram = diagramOf?.(node);
    if (diagram) {
      const touched = entry === "inside" || children.length > 0 || state !== entry;
      return touched ? { kind: "fence", lang: diagram.lang, text: diagram.source } : null;
    }
    // Selecting any part of an equation selects the equation: half of a KaTeX
    // span tree is not math anyone can use.
    if (isMath(node)) {
      const touched = entry === "inside" || children.length > 0 || state !== entry;
      return touched ? { kind: "math", latex: latexOf(node), display: isDisplayMath(node) } : null;
    }
    // Chrome is walked (a boundary may sit inside it) but never kept.
    if (isChrome(node)) return null;

    const tag = tagOf(node);
    const keep = VOID_TAGS.has(tag)
      ? entry === "inside"
      : children.length > 0 || ((tag === "td" || tag === "th") && entry === "inside");
    if (!keep) return null;

    const attrs: Record<string, string> = {};
    for (const name of KEPT_ATTRS) {
      const value = attr(node, name);
      if (value !== null) attrs[name] = value;
    }
    if (tag === "input" && (node.checked ?? attr(node, "checked") !== null)) attrs.checked = "";
    // A callout's label ("Note", "Warning") is dropped as chrome; its type is
    // what the Markdown needs, so it is read off before the label goes.
    if (tag === "aside" && hasClass(node, "docs-callout")) {
      const label = find(node, (n) => hasClass(n, "docs-callout-label"));
      if (label?.textContent) attrs.callout = label.textContent.trim().toUpperCase();
    }
    return { kind: "el", tag, attrs, children };
  };

  return visit(root);
}

// ---- step 2: render Markdown -------------------------------------------------

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "section",
  "article",
  "aside",
  "main",
  "header",
  "footer",
  "nav",
  "figure",
  "figcaption",
  "blockquote",
  "details",
  "summary",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "pre",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
]);

const isBlock = (piece: Piece) =>
  piece.kind === "fence" ||
  (piece.kind === "math" ? piece.display : piece.kind === "el" && BLOCK_TAGS.has(piece.tag));

const isElement = (piece: Piece | undefined, ...tags: string[]): piece is Element =>
  piece?.kind === "el" && (tags.length === 0 || tags.includes(piece.tag));

/** Text exactly as selected — for code, where whitespace is content. */
function rawText(piece: Piece): string {
  if (piece.kind === "text") return piece.text;
  if (piece.kind === "math") return piece.latex;
  if (piece.kind === "fence") return piece.text;
  if (piece.tag === "br") return "\n";
  return piece.children.map(rawText).join("");
}

/** A delimiter run that cannot collide with any run inside `text`. */
function fenceFor(text: string, char: "`", min: number): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return char.repeat(Math.max(min, longest + 1));
}

/** Wrap inline text in a delimiter, keeping edge whitespace outside it. */
function wrap(inner: string, mark: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return match[2] ? `${match[1]}${mark}${match[2]}${mark}${match[3]}` : inner;
}

function inline(pieces: Piece[]): string {
  return pieces.map(inlinePiece).join("");
}

function inlinePiece(piece: Piece): string {
  if (piece.kind === "text") return piece.text.replace(/\s+/g, " ");
  if (piece.kind === "math") return piece.display ? ` $$${piece.latex}$$ ` : `$${piece.latex}$`;
  if (piece.kind === "fence") return ` ${piece.text.replace(/\s+/g, " ")} `;
  const inner = () => inline(piece.children);
  switch (piece.tag) {
    case "strong":
    case "b":
      return wrap(inner(), "**");
    case "em":
    case "i":
      return wrap(inner(), "*");
    case "del":
    case "s":
    case "strike":
      return wrap(inner(), "~~");
    case "code": {
      const code = rawText(piece).replace(/\s*\n\s*/g, " ");
      const ticks = fenceFor(code, "`", 1);
      const pad = code.startsWith("`") || code.endsWith("`") ? " " : "";
      return `${ticks}${pad}${code}${pad}${ticks}`;
    }
    case "a": {
      const text = inner();
      const href = piece.attrs.href ?? "";
      // In-page anchors and footnote references only mean something inside
      // the document they came from.
      if (!href || href.startsWith("#") || !text.trim()) return text;
      const target = /[\s()<>]/.test(href) ? `<${href}>` : href;
      return `[${text.trim()}](${target})`;
    }
    case "img": {
      const alt = (piece.attrs.alt ?? "").trim();
      const src = piece.attrs.src ?? "";
      // Local attachments render from blob: URLs that die with the page.
      return /^https?:/i.test(src) ? `![${alt}](${src})` : alt;
    }
    case "br":
      return "\n";
    case "input":
      return "";
    default:
      // A block caught inside inline content (a list inside a table cell)
      // keeps its words, on one line.
      return isBlock(piece) ? ` ${render(piece).replace(/\s*\n+\s*/g, " ")} ` : inner();
  }
}

/** Inline text tidied for a block: no stray spaces around line breaks. */
const tidy = (text: string) => text.replace(/ *\n */g, "\n").trim();

/** Children as a list of Markdown blocks, inline runs grouped into paragraphs. */
function blocks(pieces: Piece[]): string[] {
  const out: string[] = [];
  let run: Piece[] = [];
  const flush = () => {
    const text = tidy(inline(run));
    if (text) out.push(text);
    run = [];
  };
  for (const piece of pieces) {
    if (!isBlock(piece)) {
      run.push(piece);
      continue;
    }
    flush();
    const text = render(piece);
    if (text.trim()) out.push(text);
  }
  flush();
  return out;
}

const indent = (text: string, by: string) =>
  text
    .split("\n")
    .map((line, i) => (i === 0 || !line ? line : by + line))
    .join("\n");

const quote = (text: string) =>
  text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");

/** Remove a leading task-list checkbox, reporting whether it was ticked. */
function takeTaskBox(pieces: Piece[]): { box: string; rest: Piece[] } {
  const first = pieces.findIndex((p) => !(p.kind === "text" && !p.text.trim()));
  const head = pieces[first];
  if (head?.kind !== "el") return { box: "", rest: pieces };
  if (head.tag === "input") {
    return {
      box: "checked" in head.attrs ? "[x] " : "[ ] ",
      rest: pieces.filter((_, i) => i !== first),
    };
  }
  // A loose list puts the box inside the item's first paragraph.
  if (head.tag === "p") {
    const inner = takeTaskBox(head.children);
    if (inner.box)
      return {
        box: inner.box,
        rest: pieces.map((p, i) => (i === first ? { ...head, children: inner.rest } : p)),
      };
  }
  return { box: "", rest: pieces };
}

function list(el: Element): string {
  const ordered = el.tag === "ol";
  let n = Number.parseInt(el.attrs.start ?? "1", 10);
  if (!Number.isFinite(n)) n = 1;
  return el.children
    .filter((child): child is Element => isElement(child, "li"))
    .map((item) => {
      const marker = ordered ? `${n++}. ` : "- ";
      const { box, rest } = takeTaskBox(item.children);
      // A tight item keeps its nested list on the next line; a loose one (its
      // text in paragraphs) keeps blank lines between its blocks.
      const loose = rest.some((child) => isElement(child, "p"));
      const body = blocks(rest).join(loose ? "\n\n" : "\n");
      return marker + box + indent(body, " ".repeat(marker.length));
    })
    .join("\n");
}

function table(el: Element): string {
  const rows: Element[] = [];
  const collect = (piece: Piece) => {
    if (!isElement(piece)) return;
    if (piece.tag === "tr") rows.push(piece);
    else if (["thead", "tbody", "tfoot", "table"].includes(piece.tag))
      piece.children.forEach(collect);
  };
  collect(el);
  const cells = rows
    .map((row) =>
      row.children
        .filter((cell): cell is Element => isElement(cell, "td", "th"))
        .map((cell) => tidy(inline(cell.children)).replace(/\n+/g, " ").replace(/\|/g, "\\|")),
    )
    .filter((row) => row.length > 0);
  if (!cells.length) return "";
  const width = Math.max(...cells.map((row) => row.length));
  const line = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
  return [line(cells[0]), line(Array(width).fill("---")), ...cells.slice(1).map(line)].join("\n");
}

function fence(language: string, text: string): string {
  const marks = fenceFor(text, "`", 3);
  return `${marks}${language}\n${text}\n${marks}`;
}

function codeBlock(el: Element): string {
  const code = el.children.find((child) => isElement(child, "code"));
  const language = isElement(code)
    ? (/(?:^|\s)language-([\w+#.-]+)/.exec(code.attrs.class ?? "")?.[1]?.split("--")[0] ?? "")
    : "";
  return fence(language, rawText(el).replace(/\n$/, ""));
}

function render(piece: Piece): string {
  if (piece.kind === "text") return tidy(inlinePiece(piece));
  if (piece.kind === "math") return piece.display ? `$$\n${piece.latex}\n$$` : `$${piece.latex}$`;
  if (piece.kind === "fence") return fence(piece.lang, piece.text.replace(/\n$/, ""));
  const tag = piece.tag;
  if (/^h[1-6]$/.test(tag)) {
    const text = tidy(inline(piece.children)).replace(/\n+/g, " ");
    return text ? `${"#".repeat(Number(tag[1]))} ${text}` : "";
  }
  switch (tag) {
    case "ul":
    case "ol":
      return list(piece);
    case "li":
      return list({ kind: "el", tag: "ul", attrs: {}, children: [piece] });
    case "table":
    case "thead":
    case "tbody":
    case "tfoot":
    case "tr":
      return table(piece);
    case "pre":
      return codeBlock(piece);
    case "blockquote":
      return quote(blocks(piece.children).join("\n\n"));
    case "aside":
      if (piece.attrs.callout) {
        const body = blocks(piece.children).join("\n\n");
        return quote(`[!${piece.attrs.callout}]${body ? `\n${body}` : ""}`);
      }
      return blocks(piece.children).join("\n\n");
    case "hr":
      return "---";
    default:
      return isBlock(piece) ? blocks(piece.children).join("\n\n") : tidy(inlinePiece(piece));
  }
}

// ---- entry points ------------------------------------------------------------

/** Elements whose own markup a selection *inside* them should not repeat. */
const TEXT_BLOCKS = new Set(["p", "li", "td", "th", "dt", "dd", "figcaption", "summary"]);

/**
 * The selected content as Markdown, or "" when nothing convertible was
 * selected (an embed, an image with no alt text).
 *
 * `boundary` is the rendered document's container: context is never looked
 * for above it. `diagramOf` recovers a diagram's source; without it, diagrams
 * copy as nothing.
 */
export function selectionToMarkdown(
  bounds: SelectionBounds,
  boundary?: DomNodeLike,
  diagramOf?: DiagramLookup,
): string {
  let root: DomNodeLike | null = bounds.commonAncestorContainer;
  if (root.nodeType === TEXT_NODE) root = root.parentNode;
  if (!root) return "";

  // Some structure has to come with the selection for the result to mean
  // anything: a code block is a fence even when a single token is selected,
  // and any part of an equation or diagram is the whole of it. Climb to the
  // outermost such ancestor inside the document.
  let target = root;
  for (let node: DomNodeLike | null = root; node && node !== boundary; node = node.parentNode) {
    if (
      node.nodeType === ELEMENT_NODE &&
      (isMath(node) || tagOf(node) === "pre" || diagramOf?.(node))
    )
      target = node;
  }
  // Cells from more than one row, or a whole row, are a table — and a table
  // reads with its header, even when the selection started below it.
  let header: Piece | null = null;
  if (target === root && ["tr", "thead", "tbody", "tfoot"].includes(tagOf(root))) {
    let table: DomNodeLike | null = root;
    while (table && tagOf(table) !== "table" && table !== boundary) table = table.parentNode;
    if (table && tagOf(table) === "table") {
      target = table;
      const thead = find(table, (n) => tagOf(n) === "thead");
      if (thead) header = capture(thead);
    }
  }

  const piece = capture(target, bounds, diagramOf);
  if (!piece) return "";
  if (piece.kind !== "el") return render(piece).trim();
  if (header && piece.tag === "table" && !piece.children.some((c) => isElement(c, "thead")))
    piece.children.unshift(header);

  // A selection inside one paragraph, item or cell is that text — not a new
  // one-item list or a one-cell table.
  if (TEXT_BLOCKS.has(piece.tag) || /^h[1-6]$/.test(piece.tag)) {
    return blocks(piece.children).join("\n\n").trim();
  }
  return (isBlock(piece) ? render(piece) : tidy(inlinePiece(piece))).trim();
}
