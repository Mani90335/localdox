// Markdown formatting actions for the source editor's toolbar.
//
// Every action is a pure function from the current text plus selection to the
// next text plus selection. The textarea is the only thing that touches the
// DOM; keeping the transforms pure means the toolbar button and the keyboard
// shortcut run exactly the same code, and each one is testable without a
// browser.
//
// Two rules hold across all of them:
//
//  - The reader's existing text is never rewritten beyond the span being
//    formatted. No reflowing, no normalising, no trimming elsewhere.
//  - The selection is always placed somewhere useful afterwards: over the text
//    that was just wrapped, or inside the empty markers so typing continues
//    where the reader expects.

/** A textarea's value and selection, in and out of every action. */
export interface EditState {
  text: string;
  start: number;
  end: number;
}

/** What a toolbar button does to the document. */
export type FormatAction = (state: EditState) => EditState;

/** Expand an empty selection to the word under the caret.
 *
 *  Pressing Bold with nothing selected but the caret inside a word almost
 *  always means "bold this word" — every other editor behaves that way, and
 *  the alternative (inserting empty `****` mid-word) is never what was meant. */
function expandToWord(state: EditState): EditState {
  const { text, start, end } = state;
  if (start !== end) return state;
  const isWord = (c: string) => /[\w'-]/.test(c);
  if (!(isWord(text[start - 1] ?? "") || isWord(text[start] ?? ""))) return state;
  let from = start;
  let to = end;
  while (from > 0 && isWord(text[from - 1])) from--;
  while (to < text.length && isWord(text[to])) to++;
  return { text, start: from, end: to };
}

/**
 * Wrap the selection in `marker`, or unwrap it when it is already wrapped.
 *
 * The toggle checks *outside* the selection as well as inside it, so a reader
 * who selects the word inside `**bold**` — rather than the markers too — still
 * gets un-bolded instead of `****bold****`.
 */
function toggleWrap(marker: string, expand = true): FormatAction {
  return (input) => {
    const state = expand ? expandToWord(input) : input;
    const { text, start, end } = state;
    const selected = text.slice(start, end);
    const len = marker.length;

    // Markers sit inside the selection: `**bold**` selected whole.
    if (selected.length >= len * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
      const inner = selected.slice(len, -len);
      return {
        text: text.slice(0, start) + inner + text.slice(end),
        start,
        end: start + inner.length,
      };
    }

    // Markers sit just outside it: `bold` selected within `**bold**`.
    if (text.slice(start - len, start) === marker && text.slice(end, end + len) === marker) {
      return {
        text: text.slice(0, start - len) + selected + text.slice(end + len),
        start: start - len,
        end: end - len,
      };
    }

    return {
      text: text.slice(0, start) + marker + selected + marker + text.slice(end),
      start: start + len,
      end: end + len,
    };
  };
}

/** Start of the line containing `index`. */
function lineStart(text: string, index: number): number {
  return text.lastIndexOf("\n", index - 1) + 1;
}

/** End of the line containing `index`, not counting the newline itself. */
function lineEnd(text: string, index: number): number {
  const next = text.indexOf("\n", index);
  return next === -1 ? text.length : next;
}

/**
 * Rewrite every line the selection touches.
 *
 * Line-based actions (lists, quotes, headings) all work this way: take the full
 * lines the selection covers, map each one, and re-select the result so the
 * reader can keep pressing the button. Partial selections are widened to whole
 * lines, because half a list item is not a thing you can prefix.
 */
function mapLines(fn: (line: string, index: number, lines: string[]) => string): FormatAction {
  return ({ text, start, end }) => {
    const from = lineStart(text, start);
    const to = lineEnd(text, end);
    const lines = text.slice(from, to).split("\n");
    const next = lines.map(fn).join("\n");
    return {
      text: text.slice(0, from) + next + text.slice(to),
      start: from,
      end: from + next.length,
    };
  };
}

/** Everything a line prefix action has to strip before applying its own. */
const ANY_LINE_PREFIX = /^(\s*)(?:#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+|>\s?)?/;

/** Replace whatever block prefix a line carries with `make`, or remove it when
 *  the line already has exactly that one — every prefix control is a toggle. */
function togglePrefix(
  make: (index: number) => string,
  matches: (line: string) => boolean,
): FormatAction {
  return mapLines((line, index) => {
    const [, indent = ""] = ANY_LINE_PREFIX.exec(line) ?? [];
    const body = line.replace(ANY_LINE_PREFIX, "");
    // An empty line inside a multi-line selection is left alone: prefixing it
    // would produce a stray bullet the reader never asked for.
    if (!body && line.trim() === "") return line;
    return matches(line) ? indent + body : indent + make(index) + body;
  });
}

export const bold = toggleWrap("**");
export const italic = toggleWrap("*");
export const strikethrough = toggleWrap("~~");
export const inlineCode = toggleWrap("`");

/** Heading level 1–3. Re-applying the same level clears it back to body text. */
export function heading(level: 1 | 2 | 3): FormatAction {
  const hashes = "#".repeat(level);
  return togglePrefix(
    () => `${hashes} `,
    (line) => new RegExp(`^\\s*${hashes}\\s+`).test(line),
  );
}

export const bulletList = togglePrefix(
  () => "- ",
  (line) => /^\s*[-*+]\s+(?!\[[ xX]\])/.test(line),
);

/** Numbered list. Numbering restarts at 1 for the selection and counts up, so
 *  turning five lines into a list gives 1–5 rather than five 1s. */
export const numberedList = togglePrefix(
  (index) => `${index + 1}. `,
  (line) => /^\s*\d+\.\s+/.test(line),
);

export const checklist = togglePrefix(
  () => "- [ ] ",
  (line) => /^\s*[-*+]\s+\[[ xX]\]\s+/.test(line),
);

export const blockquote = togglePrefix(
  () => "> ",
  (line) => /^\s*>\s?/.test(line),
);

/**
 * Insert `text` as its own block, with blank lines around it.
 *
 * Only as many newlines as the surroundings are missing — pushing a fenced
 * block into a document should not leave a growing stack of blank lines behind
 * each time.
 */
function insertBlock(body: string, caretOffset: number, selectLength = 0): FormatAction {
  return ({ text, start, end }) => {
    const before = text.slice(0, start);
    const after = text.slice(end);
    const lead =
      before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const tail =
      after === "" || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    const inserted = lead + body + tail;
    const caret = start + lead.length + caretOffset;
    return { text: before + inserted + after, start: caret, end: caret + selectLength };
  };
}

/** Fenced code block. A selection becomes the block's contents. */
export const codeBlock: FormatAction = (state) => {
  const { text, start, end } = state;
  const selected = text.slice(start, end);
  if (!selected) return insertBlock("```\n\n```", 4)(state);
  return insertBlock("```\n" + selected + "\n```", 4, selected.length)(state);
};

export const horizontalRule: FormatAction = insertBlock("---", 3);

/**
 * Wrap the selection in a ```mermaid fence, or drop an empty one at the caret.
 *
 * Separate from `codeBlock` because a diagram is not a language tag the reader
 * types after the fact: the fence and its `mermaid` info string are what make
 * the viewer draw the block at all, so the whole thing is one action.
 */
export const mermaidBlock: FormatAction = (state) => {
  const { text, start, end } = state;
  const selected = text.slice(start, end);
  // Fences have to start their own line, or the surrounding paragraph swallows
  // them. Only add the separating newlines that aren't already there.
  const before = start === 0 || text[start - 1] === "\n" ? "" : "\n";
  const after = end === text.length || text[end] === "\n" ? "" : "\n";
  const body = selected || "graph TD\n  A[Start] --> B[End]";
  const block = `${before}\`\`\`mermaid\n${body}\n\`\`\`${after}`;
  const bodyStart = start + before.length + "```mermaid\n".length;
  return {
    text: text.slice(0, start) + block + text.slice(end),
    start: bodyStart,
    end: bodyStart + body.length,
  };
};

/**
 * Link and image share a shape: `[text](url)` and `![alt](url)`.
 *
 * A selection that looks like a URL becomes the target and the caret lands on
 * the label; anything else becomes the label and the caret lands on the URL.
 * Either way the reader types the missing half immediately, with no cursor
 * work of their own.
 */
function linkLike(prefix: string, placeholder: string): FormatAction {
  return (input) => {
    const state = prefix === "" ? expandToWord(input) : input;
    const { text, start, end } = state;
    const selected = text.slice(start, end);
    const isUrl = /^(https?:\/\/|\/|\.{1,2}\/|mailto:|#)\S*$/i.test(selected);

    const label = isUrl ? placeholder : selected;
    const url = isUrl ? selected : "";
    const body = `${prefix}[${label}](${url})`;
    // Caret onto whichever half is still empty or a placeholder.
    const caret = isUrl ? start + prefix.length + 1 : start + prefix.length + label.length + 3;
    const length = isUrl ? label.length : url.length;
    return {
      text: text.slice(0, start) + body + text.slice(end),
      start: caret,
      end: caret + length,
    };
  };
}

export const link = linkLike("", "link text");
export const image = linkLike("!", "alt text");
