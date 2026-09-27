// Equation numbering, labels and cross-references.
//
// Numbering lives at the application level rather than inside an engine, and
// that is the whole point of this file. KaTeX has no `\label` at all; MathJax's
// numbering is a property of its own document object and restarts whenever the
// engine is re-initialised; Temml numbers nothing. If numbering came from the
// engine, the same document would number differently depending on which engine
// happened to render it — and switching renderers mid-document (the fallback
// path does exactly that) would renumber equations under the reader.
//
// So the registry is computed from the *markdown source* alone: same source,
// same numbers, whichever engine draws them. It is a pure function of the text,
// which also makes it cheap to memoize and trivial to test.

import {
  explicitTag,
  extractLabel,
  extractReferences,
  isNumberable,
  isNumberSuppressed,
} from "./latex.ts";

export interface EquationEntry {
  /** Stable DOM id, unique within the document. */
  domId: string;
  /** Author's `\label{…}`, if any. What `\ref`/`\eqref` resolve against. */
  label?: string;
  /** Display number, e.g. "3" or "2a". Absent when the equation is unnumbered. */
  number?: string;
  /** Original LaTeX, verbatim. */
  latex: string;
  displayMode: boolean;
  /** Position in document order, counting every math node including inline. */
  index: number;
}

export interface EquationRegistry {
  /** Every math node in the document, in source order. */
  readonly entries: readonly EquationEntry[];
  /** Look one up by its `\label`. */
  byLabel(label: string): EquationEntry | undefined;
  /** Look one up by the LaTeX/displayMode pair a renderer is holding. */
  resolve(latex: string, displayMode: boolean, occurrence?: number): EquationEntry | undefined;
  /** Labels named by a `\ref` somewhere in the document but never defined. */
  readonly danglingReferences: readonly string[];
}

/** One math node as found by the markdown parse. */
export interface MathNodeSource {
  latex: string;
  displayMode: boolean;
}

/**
 * `$…$` / `$$…$$` occurrences in document order.
 *
 * remark-math owns the real parse; this scanner exists so the registry can be
 * built from source text without standing up a unified pipeline (and so it can
 * be unit-tested). It follows the same rules that matter for numbering:
 * fenced/inline code is not math, `$$` wins over `$`, and an unterminated
 * delimiter is text rather than an error.
 */
export function scanMathNodes(source: string): MathNodeSource[] {
  const nodes: MathNodeSource[] = [];
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i];

    // Escaped delimiter: `\$` is a literal dollar sign, never a math opener.
    if (ch === "\\" && i + 1 < n) {
      i += 2;
      continue;
    }

    // Fenced code block — skip to the closing fence. Math inside a fence is
    // sample text about math, not math.
    if ((ch === "`" || ch === "~") && (i === 0 || source[i - 1] === "\n")) {
      const fence = /^(`{3,}|~{3,})/.exec(source.slice(i));
      if (fence) {
        const marker = fence[1];
        const close = source.indexOf(`\n${marker}`, i + marker.length);
        i = close === -1 ? n : close + marker.length + 1;
        continue;
      }
    }

    // Inline code span. Same reasoning.
    if (ch === "`") {
      const ticks = /^`+/.exec(source.slice(i))![0];
      const close = source.indexOf(ticks, i + ticks.length);
      i = close === -1 ? i + ticks.length : close + ticks.length;
      continue;
    }

    if (ch === "$") {
      const display = source[i + 1] === "$";
      const delimiter = display ? "$$" : "$";
      const start = i + delimiter.length;
      const end = findClosing(source, start, delimiter);
      if (end === -1) {
        i = start;
        continue;
      }
      const latex = source.slice(start, end);
      // `$ 5` and `$100` are prices, not math. remark-math applies the same
      // rule for inline math: no whitespace immediately inside the delimiters.
      const isMath = display || (latex.trim() !== "" && !/^\s|\s$/.test(latex));
      if (isMath) nodes.push({ latex: display ? latex.trim() : latex, displayMode: display });
      i = end + delimiter.length;
      continue;
    }

    i += 1;
  }

  return nodes;
}

function findClosing(source: string, from: number, delimiter: string): number {
  for (let i = from; i < source.length; i++) {
    if (source[i] === "\\") {
      i += 1;
      continue;
    }
    if (source.startsWith(delimiter, i)) return i;
  }
  return -1;
}

/**
 * Number the equations in a document and index them by label.
 *
 * `numbering: false` keeps labels and references working (a reference then
 * renders as the label text) but assigns no numbers, which is what a reader who
 * turns numbering off is asking for.
 */
export function buildEquationRegistry(
  source: string,
  options: { numbering?: boolean; prefix?: string } = {},
): EquationRegistry {
  const { numbering = true, prefix = "" } = options;
  const nodes = scanMathNodes(source);
  const entries: EquationEntry[] = [];
  const byLabel = new Map<string, EquationEntry>();
  /** How many times a given LaTeX/mode pair has been seen, for `resolve`. */
  const occurrences = new Map<string, number>();
  let counter = 0;

  nodes.forEach((node, index) => {
    const label = extractLabel(node.latex);
    const tag = explicitTag(node.latex);
    const numbered = numbering && isNumberable(node.latex, node.displayMode);
    let number: string | undefined;
    if (numbered) {
      if (tag) {
        // An explicit `\tag` does not advance the counter — that is what makes
        // `\tag{2a}` sit beside equation 2 rather than displacing equation 3.
        number = tag;
      } else {
        counter += 1;
        number = `${prefix}${counter}`;
      }
    } else if (tag && numbering) {
      number = tag;
    }

    const key = occurrenceKey(node.latex, node.displayMode);
    const seen = occurrences.get(key) ?? 0;
    occurrences.set(key, seen + 1);

    const entry: EquationEntry = {
      domId: label ? `eq-${slugLabel(label)}` : `eq-node-${index}`,
      label,
      number,
      latex: node.latex,
      displayMode: node.displayMode,
      index,
    };
    entries.push(entry);
    if (label && !byLabel.has(label)) byLabel.set(label, entry);
  });

  const defined = new Set(byLabel.keys());
  const dangling = new Set<string>();
  for (const node of nodes) {
    for (const ref of extractReferences(node.latex)) {
      if (!defined.has(ref)) dangling.add(ref);
    }
  }
  // Markdown-level references (`[](#eq:foo)` style is handled by the link
  // renderer) plus the reader-friendly `{{eq:foo}}` form are scanned from the
  // prose too, so a typo in either is reported the same way.
  for (const ref of scanProseReferences(source)) {
    if (!defined.has(ref)) dangling.add(ref);
  }

  /** Index of entries by occurrence key, so repeated equations resolve in order. */
  const byOccurrence = new Map<string, EquationEntry[]>();
  for (const entry of entries) {
    const key = occurrenceKey(entry.latex, entry.displayMode);
    const list = byOccurrence.get(key);
    if (list) list.push(entry);
    else byOccurrence.set(key, [entry]);
  }

  return {
    entries,
    byLabel: (label) => byLabel.get(label),
    resolve: (latex, displayMode, occurrence = 0) =>
      byOccurrence.get(occurrenceKey(latex, displayMode))?.[occurrence],
    danglingReferences: [...dangling],
  };
}

/**
 * The reader-friendly reference form: `{{eq:maxwell}}` in prose.
 *
 * `\eqref` only works *inside* math, which means an author wanting to refer to
 * an equation from a sentence has to open a math span to do it. This is the
 * prose equivalent, and it renders as the same clickable number.
 */
export function scanProseReferences(source: string): string[] {
  const found: string[] = [];
  const pattern = /\{\{\s*(eq:[A-Za-z0-9_:.-]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) found.push(match[1]);
  return found;
}

function occurrenceKey(latex: string, displayMode: boolean): string {
  return `${displayMode ? "d" : "i"} ${latex}`;
}

/** A label turned into something safe for an `id` attribute and a URL fragment. */
export function slugLabel(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "eq"
  );
}

/** An empty registry, for documents with no math and for the default context. */
export const EMPTY_EQUATION_REGISTRY: EquationRegistry = {
  entries: [],
  byLabel: () => undefined,
  resolve: () => undefined,
  danglingReferences: [],
};

export { isNumberSuppressed };
