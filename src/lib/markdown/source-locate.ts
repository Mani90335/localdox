// Map rendered text back to its position in the markdown source — the
// "Inspect" half of the reader. The CSS Custom Highlight API gives us offsets
// into the *rendered* DOM (see text-offsets.ts), but the editor is a textarea
// over the raw markdown, where `**bold**`, `[text](url)` and heading markers
// all shift the offsets. So we project the source down to the plain text a
// reader actually sees, keeping a per-character index back into the source,
// then search that projection for the selected text.

export interface SourceSpan {
  start: number;
  end: number;
}

interface Projection {
  /** Plain text as the reader sees it. */
  text: string;
  /** map[i] = index in the original source of text[i]. */
  map: number[];
}

const BLOCK_LEAD = /^(?:\s*(?:>\s?)*)(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/;
const TABLE_SEPARATOR = /^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/;

const isWordChar = (c: string | undefined) => !!c && /[A-Za-z0-9]/.test(c);

/** Index of the `]` that closes the `[` at `open`, or -1. */
function matchBracket(line: string, open: number): number {
  let depth = 0;
  for (let i = open; i < line.length; i++) {
    if (line[i] === "\\") {
      i++;
      continue;
    }
    if (line[i] === "[") depth++;
    else if (line[i] === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Strip markdown syntax from `src`, recording where every surviving character
 * came from. Inline code and fenced blocks keep their contents (they render as
 * text); images, link targets and emphasis markers are dropped.
 */
function project(src: string): Projection {
  const chars: string[] = [];
  const map: number[] = [];
  const push = (ch: string, idx: number) => {
    chars.push(ch);
    map.push(idx);
  };

  const inline = (line: string, from: number, to: number, base: number) => {
    let k = from;
    while (k < to) {
      const ch = line[k];
      const idx = base + k;

      if (ch === "\\" && k + 1 < to) {
        push(line[k + 1], base + k + 1);
        k += 2;
        continue;
      }

      // `code` — contents render, backticks don't.
      if (ch === "`") {
        const close = line.indexOf("`", k + 1);
        if (close !== -1 && close < to) {
          for (let m = k + 1; m < close; m++) push(line[m], base + m);
          k = close + 1;
          continue;
        }
        k++;
        continue;
      }

      // ![alt](url) renders as an image — no text at all.
      if (ch === "!" && line[k + 1] === "[") {
        const close = matchBracket(line, k + 1);
        const paren = close !== -1 && line[close + 1] === "(" ? line.indexOf(")", close + 1) : -1;
        if (paren !== -1) {
          k = paren + 1;
          continue;
        }
        k++;
        continue;
      }

      // [text](url) / [text][ref] — keep the text, drop the target.
      if (ch === "[") {
        const close = matchBracket(line, k);
        if (close !== -1 && close < to) {
          const after = line[close + 1];
          let skipTo = close + 1;
          if (after === "(") {
            const paren = line.indexOf(")", close + 1);
            if (paren !== -1) skipTo = paren + 1;
          } else if (after === "[") {
            const ref = line.indexOf("]", close + 2);
            if (ref !== -1) skipTo = ref + 1;
          }
          inline(line, k + 1, close, base);
          k = skipTo;
          continue;
        }
        k++;
        continue;
      }

      // Emphasis / strikethrough delimiters.
      if (ch === "*" || ch === "~") {
        k++;
        continue;
      }
      // `_` is only a delimiter at a word boundary — snake_case must survive.
      if (ch === "_") {
        if (isWordChar(line[k - 1]) && isWordChar(line[k + 1])) push("_", idx);
        k++;
        continue;
      }
      // Table cell walls read as a gap between cells.
      if (ch === "|") {
        push(" ", idx);
        k++;
        continue;
      }

      push(ch, idx);
      k++;
    }
  };

  let pos = 0;
  let inFence = false;
  for (const line of src.split("\n")) {
    const base = pos;
    pos += line.length + 1;

    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      push("\n", base + line.length);
      continue;
    }
    if (inFence) {
      for (let m = 0; m < line.length; m++) push(line[m], base + m);
      push("\n", base + line.length);
      continue;
    }
    if (TABLE_SEPARATOR.test(line)) {
      push("\n", base + line.length);
      continue;
    }

    const lead = BLOCK_LEAD.exec(line);
    inline(line, lead ? lead[0].length : 0, line.length, base);
    push("\n", base + line.length);
  }

  return { text: chars.join(""), map };
}

/** Whitespace-collapsed copy of `text`, with a map back into `text`. */
function compact(text: string): Projection {
  const chars: string[] = [];
  const map: number[] = [];
  let space = true; // leading whitespace is dropped
  for (let i = 0; i < text.length; i++) {
    const ws = /\s/.test(text[i]);
    if (ws) {
      if (!space) {
        chars.push(" ");
        map.push(i);
        space = true;
      }
      continue;
    }
    chars.push(text[i]);
    map.push(i);
    space = false;
  }
  while (chars.length && chars[chars.length - 1] === " ") {
    chars.pop();
    map.pop();
  }
  return { text: chars.join(""), map };
}

// Projecting the whole document on every right-click is wasteful; readers
// inspect the same document many times in a row.
let cacheKey: string | null = null;
let cacheValue: { proj: Projection; flat: Projection } | null = null;

function projectionOf(src: string) {
  if (cacheKey === src && cacheValue) return cacheValue;
  const proj = project(src);
  cacheValue = { proj, flat: compact(proj.text) };
  cacheKey = src;
  return cacheValue;
}

/**
 * Find `selection` (text copied out of the rendered document) in the markdown
 * `source`. `prefer` narrows the search to a source range first — the section
 * currently on screen — so a phrase repeated across the document resolves to
 * the copy the reader is actually looking at.
 */
export function locateInSource(
  source: string,
  selection: string,
  prefer?: { from: number; to: number },
): SourceSpan | null {
  const needle = compact(selection).text;
  if (!needle) return null;

  const { proj, flat } = projectionOf(source);

  // Flat index -> source index, and back, so `prefer` can be applied.
  const toSource = (flatIdx: number) => proj.map[flat.map[flatIdx]];
  const spanFor = (flatStart: number, len: number): SourceSpan => {
    const start = toSource(flatStart);
    // The end is taken from where the *next* character begins, not from the
    // last one plus one. `compact` maps a collapsed run of whitespace to the
    // first space in that run, so a match ending right before a space would
    // otherwise reach past the word and select the space with it.
    const lastFlat = flatStart + len - 1;
    const afterIdx = lastFlat + 1 < flat.map.length ? toSource(lastFlat + 1) : null;
    const end = afterIdx !== null ? afterIdx : toSource(lastFlat) + 1;
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    // Trailing whitespace is never part of what the reader pointed at.
    let trimmed = hi;
    while (trimmed > lo && /\s/.test(source[trimmed - 1])) trimmed--;
    return { start: lo, end: trimmed > lo ? trimmed : hi };
  };

  const search = (hay: string): number => {
    if (prefer) {
      let lo = -1;
      let hi = -1;
      for (let i = 0; i < flat.map.length; i++) {
        const s = toSource(i);
        if (s >= prefer.from && s < prefer.to) {
          if (lo === -1) lo = i;
          hi = i;
        }
      }
      if (lo !== -1) {
        const local = flat.text.slice(lo, hi + 1).indexOf(hay);
        if (local !== -1) return lo + local;
      }
    }
    return flat.text.indexOf(hay);
  };

  const exact = search(needle);
  if (exact !== -1) return spanFor(exact, needle.length);

  // Selections that cross a rendered boundary we didn't model (a table row, a
  // stripped heading) won't match whole. Anchor on the longest prefix that does
  // — the reader still lands on the right line.
  for (let len = Math.min(needle.length, 120); len >= 12; len = Math.floor(len * 0.7)) {
    const partial = needle.slice(0, len);
    const at = search(partial);
    if (at !== -1) return spanFor(at, partial.length);
  }

  // Last resort: a *rare* word from the selection, matched on a whole-word
  // boundary.
  //
  // This step used to take the first word of four or more characters and jump
  // to its first occurrence anywhere in the document. That is what made Inspect
  // land on the wrong text: the first long word of a sentence is usually a
  // common one ("which", "there", "value"), its first occurrence is rarely the
  // copy the reader clicked, and a bare `indexOf` also matches inside longer
  // words. Preferring the word that occurs least often — and requiring it to
  // stand alone — picks the distinctive token instead, and a word that appears
  // all over the document is no longer treated as an anchor at all.
  const words = needle.split(" ").filter((w) => w.length >= 4);
  let best: { at: number; len: number; count: number } | null = null;
  for (const word of words) {
    const at = searchWord(word);
    if (at === -1) continue;
    const count = countWord(flat.text, word);
    if (count === 0) continue;
    if (!best || count < best.count) best = { at, len: word.length, count };
    if (count === 1) break;
  }
  // A token that appears more than a couple of times says nothing about where
  // the reader was looking, so there is nothing to anchor to: opening the
  // editor at the section start (what the caller does with `null`) is more
  // honest than a confident wrong jump.
  //
  // The ceiling is deliberately low. An earlier draft allowed up to eight
  // occurrences, which in practice never rejected anything — an ordinary word
  // like "value" appears five or six times in a short document and would still
  // be treated as a landmark, which is the exact failure this step exists to
  // avoid. Two occurrences is the most that can still be called distinctive,
  // and only when the reader's section (`prefer`) does not already own one.
  const ANCHOR_MAX_OCCURRENCES = 2;
  if (best && best.count <= ANCHOR_MAX_OCCURRENCES) return spanFor(best.at, best.len);
  return null;

  /** `search`, restricted to matches that aren't inside a longer word. */
  function searchWord(word: string): number {
    const isBoundary = (index: number) => {
      const before = index > 0 ? flat.text[index - 1] : " ";
      const after = index + word.length < flat.text.length ? flat.text[index + word.length] : " ";
      return !/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after);
    };
    // Inside `prefer` first, for the same reason `search` does: the section on
    // screen owns the match when it has one.
    if (prefer) {
      let lo = -1;
      let hi = -1;
      for (let i = 0; i < flat.map.length; i++) {
        const s = toSource(i);
        if (s >= prefer.from && s < prefer.to) {
          if (lo === -1) lo = i;
          hi = i;
        }
      }
      if (lo !== -1) {
        const scoped = flat.text.slice(lo, hi + 1);
        let local = scoped.indexOf(word);
        while (local !== -1) {
          if (isBoundary(lo + local)) return lo + local;
          local = scoped.indexOf(word, local + 1);
        }
      }
    }
    let at = flat.text.indexOf(word);
    while (at !== -1) {
      if (isBoundary(at)) return at;
      at = flat.text.indexOf(word, at + 1);
    }
    return -1;
  }
}

/**
 * The source code behind a rendered selection.
 *
 * A located span starts and ends on visible characters, which is right for
 * placing the editor caret but would drop surrounding Markdown markers (and
 * can leave JSON punctuation behind). Copying the complete source lines keeps
 * the snippet valid and preserves the representation the author actually
 * wrote. Returns `null` when the rendered text can no longer be located.
 */
export function sourceLinesForSelection(
  source: string,
  selection: string,
  prefer?: { from: number; to: number },
): string | null {
  const span = locateInSource(source, selection, prefer);
  if (!span) return null;

  const start = source.lastIndexOf("\n", Math.max(0, span.start - 1)) + 1;
  const nextLine = source.indexOf("\n", span.end);
  const end = nextLine === -1 ? source.length : nextLine;
  const snippet = source.slice(start, end);
  return snippet.endsWith("\r") ? snippet.slice(0, -1) : snippet;
}

/** Whole-word occurrences of `word` in `hay`, capped — only rarity matters. */
function countWord(hay: string, word: string, cap = 32): number {
  let count = 0;
  let at = hay.indexOf(word);
  while (at !== -1 && count < cap) {
    const before = at > 0 ? hay[at - 1] : " ";
    const after = at + word.length < hay.length ? hay[at + word.length] : " ";
    if (!/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after)) count++;
    at = hay.indexOf(word, at + 1);
  }
  return count;
}

/**
 * Pixel offset of `index` inside a textarea, measured by mirroring its text in
 * a hidden div with the same box metrics. Line-height arithmetic is wrong the
 * moment a line wraps, which markdown paragraphs always do.
 */
export function caretTop(ta: HTMLTextAreaElement, index: number): number {
  const cs = getComputedStyle(ta);
  const mirror = document.createElement("div");
  const marker = document.createElement("span");

  for (const prop of [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "lineHeight",
    "textTransform",
    "wordSpacing",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "boxSizing",
    "tabSize",
  ] as const) {
    mirror.style[prop] = cs[prop];
  }
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.width = `${ta.clientWidth}px`;
  mirror.style.top = "0";
  mirror.style.left = "-9999px";

  mirror.textContent = ta.value.slice(0, index);
  marker.textContent = ta.value.slice(index, index + 1) || ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  document.body.removeChild(mirror);
  return top;
}
