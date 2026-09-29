// On-demand webfont loading.
//
// Family/weight stylesheets load only when selected or needed by a document.
// Declaring a face does not download its binary: the browser requests only
// the weights and unicode-range subsets used by rendered text.
//
// Every `--font-*` variable in styles.css declares a system fallback stack, so
// text stays readable before any of this resolves. The upstream faces use
// `font-display: swap`; their metrics can differ from the system fallback.

import type { ReadingFont } from "../workspace/persistence";

/** Families already requested, so repeated calls don't re-import. */
const loaded = new Set<string>();

function once(key: string, load: () => Promise<unknown>): void {
  if (loaded.has(key)) return;
  loaded.add(key);
  // A font that fails to load is not an error worth surfacing: the fallback
  // stack is already on screen and stays there.
  void load().catch(() => loaded.delete(key));
}

/** JetBrains Mono — `--font-mono`. Requested when a document renders code. */
export function loadMonoFont(): void {
  once("jetbrains-mono", () =>
    Promise.all([
      import("@fontsource/jetbrains-mono/400.css"),
      import("@fontsource/jetbrains-mono/500.css"),
    ]),
  );
}

/** The reader's chosen body/heading face. "custom" is an uploaded file, served
 *  from IndexedDB and registered by custom-font.ts — nothing to fetch here. */
export function loadReadingFont(font: ReadingFont): void {
  switch (font) {
    case "hyperlegible":
      once("atkinson-hyperlegible", () =>
        Promise.all([
          import("@fontsource/atkinson-hyperlegible/400.css"),
          import("@fontsource/atkinson-hyperlegible/700.css"),
        ]),
      );
      break;
    case "custom":
      break;
  }
}

/**
 * KaTeX's stylesheet (~23 kB plus its own faces). Math is rare enough that
 * paying for it on every document is the wrong default — the viewer calls this
 * only once it has seen math in the source.
 */
export function loadKatexStyles(): void {
  once("katex-css", () => import("katex/dist/katex.min.css"));
}
