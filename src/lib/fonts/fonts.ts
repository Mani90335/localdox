// On-demand webfont loading.
//
// Every reading face used to be imported from `styles.css`, which made the app's
// only stylesheet render-blocking at ~212 kB and pulled 95 woff2 subsets into
// the first load — the great majority for typefaces a given reader never picks.
// Each family is a separate dynamic import here instead, so it becomes its own
// CSS chunk that is fetched only when something actually needs it.
//
// Every `--font-*` variable in styles.css declares a system fallback stack, so
// text is readable (and correctly laid out) before any of this resolves. All
// faces are `font-display: swap` upstream, so the swap is the only visible step.

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

/** Inter — `--font-ui`, used by the app chrome, tables and controls. */
export function loadUiFont(): void {
  once("inter", () =>
    Promise.all([
      import("@fontsource/inter/400.css"),
      import("@fontsource/inter/500.css"),
      import("@fontsource/inter/600.css"),
      import("@fontsource/inter/700.css"),
    ]),
  );
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

/**
 * Warm the two faces the app chrome itself uses. Called after first paint from
 * an idle callback, so it never competes with the initial render.
 */
export function warmAppFonts(): void {
  const start = () => loadUiFont();
  if (typeof requestIdleCallback === "function") requestIdleCallback(start, { timeout: 2000 });
  else setTimeout(start, 400);
}
