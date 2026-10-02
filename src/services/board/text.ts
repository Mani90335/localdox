// Text measurement and layout for board text and shape labels.
//
// Canvas `measureText` is the source of truth, because the canvas is what
// draws the text. Widths are cached per font and string: layout runs on every
// keystroke of an edit and for every label after a resize.

import { fontStack, isLinear, LINE_HEIGHT, type BoardElement } from "./model.ts";

type MeasureContext = { font: string; measureText(text: string): { width: number } };

let context: MeasureContext | null | undefined;

function measureContext(): MeasureContext | null {
  if (context !== undefined) return context;
  if (typeof OffscreenCanvas !== "undefined") {
    context = new OffscreenCanvas(1, 1).getContext("2d");
  } else if (typeof document !== "undefined") {
    context = document.createElement("canvas").getContext("2d");
  } else {
    context = null;
  }
  return context;
}

const widthCache = new Map<string, number>();

export function fontString(size: number, family: number | undefined) {
  return `${size}px ${fontStack(family)}`;
}

export function measureWidth(text: string, size: number, family: number | undefined) {
  const key = `${size}|${family}|${text}`;
  let width = widthCache.get(key);
  if (width !== undefined) return width;
  const ctx = measureContext();
  if (ctx) {
    ctx.font = fontString(size, family);
    width = ctx.measureText(text).width;
  } else {
    // No canvas (tests, server): a fixed-advance estimate keeps layout total.
    width = text.length * size * 0.56;
  }
  if (widthCache.size > 20_000) widthCache.clear();
  widthCache.set(key, width);
  return width;
}

/** Webfonts that finish loading change widths, so cached ones must go. */
export function clearTextMetrics() {
  widthCache.clear();
}

/** Word-wraps to `maxWidth`, breaking a single over-long word by characters. */
export function wrapText(text: string, size: number, family: number | undefined, maxWidth: number) {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      out.push("");
      continue;
    }
    let line = "";
    for (const token of paragraph.split(/(\s+)/)) {
      if (!token) continue;
      if (measureWidth(line + token, size, family) <= maxWidth) {
        line += token;
        continue;
      }
      if (line.trim()) out.push(line.trimEnd());
      line = "";
      if (!token.trim()) continue;
      if (measureWidth(token, size, family) <= maxWidth) {
        line = token;
        continue;
      }
      // A single word wider than the line: break it by characters.
      for (const char of token) {
        if (line && measureWidth(line + char, size, family) > maxWidth) {
          out.push(line);
          line = "";
        }
        line += char;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

export const CONTAINER_PADDING = 10;

/** The area inside a shape that its label may occupy, relative to the shape's x/y. */
export function labelArea(container: BoardElement) {
  const w = container.width;
  const h = container.height;
  // An ellipse's largest inscribed rectangle is w/√2 × h/√2; a diamond's is w/2 × h/2.
  const ratio =
    container.type === "ellipse" ? Math.SQRT1_2 : container.type === "diamond" ? 0.5 : 1;
  const innerW = Math.max(w * ratio - CONTAINER_PADDING * 2, 8);
  const innerH = Math.max(h * ratio - CONTAINER_PADDING * 2, 8);
  return { x: (w - innerW) / 2, y: (h - innerH) / 2, width: innerW, height: innerH };
}

export interface TextLayout {
  lines: string[];
  width: number;
  height: number;
  lineHeightPx: number;
}

export function layoutText(text: BoardElement, container?: BoardElement | null): TextLayout {
  const size = text.fontSize ?? 20;
  const family = text.fontFamily;
  const lineHeightPx = size * (text.lineHeight ?? LINE_HEIGHT);
  const content = text.text ?? "";
  let lines: string[];
  if (container && !isLinear(container)) {
    lines = wrapText(content, size, family, labelArea(container).width);
  } else if (!container && text.autoResize === false && text.width > 0) {
    lines = wrapText(content, size, family, text.width);
  } else {
    lines = content.split("\n");
  }
  let width = 0;
  for (const line of lines) width = Math.max(width, measureWidth(line, size, family));
  return { lines, width, height: Math.max(lines.length, 1) * lineHeightPx, lineHeightPx };
}
