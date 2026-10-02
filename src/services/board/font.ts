// The board's text face, Atkinson Hyperlegible, loaded through the app's own
// font loader — the same stylesheet and font files the reader uses, so a board
// never downloads a second copy, and usually downloads nothing at all because
// Atkinson is the default reading face.
//
// Only the Latin 400 binary is actually fetched for typical boards: the
// stylesheet just declares faces, and the browser requests a file only for the
// weight and unicode-range that text on screen uses.

import { loadReadingFont } from "@/lib/fonts/fonts";
import { HYPERLEGIBLE_FAMILY } from "./model";

let ready: Promise<void> | null = null;

/** Resolves once the face can be drawn on a canvas (or once loading gave up). */
export function loadBoardFont(): Promise<void> {
  ready ??= loadReadingFont("hyperlegible").then(async () => {
    try {
      // Declaring a face doesn't download it, and a canvas won't wait for it:
      // ask for it explicitly so the first measurement can be the real one.
      await document.fonts?.load(`400 20px "${HYPERLEGIBLE_FAMILY}"`, "Aa");
    } catch {
      // The system sans is already drawing; it simply stays.
    }
  });
  return ready;
}
