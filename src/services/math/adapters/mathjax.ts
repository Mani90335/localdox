// MathJax 4 adapter — the high-coverage fallback.
//
// MathJax is never the default. It is ~1 MB of prebuilt engine against KaTeX's
// ~250 kB, and an order of magnitude slower per expression, so it is loaded
// only once a document actually contains something KaTeX cannot draw — and then
// only for those expressions.
//
// Loading strategy: MathJax 4 ships as a self-executing IIFE bundle that
// configures itself from `window.MathJax` and is designed for a `<script>` tag.
// Importing it as a module would pull it into a Vite chunk and run it during
// module evaluation, before its configuration could be set. So it is injected
// as a script instead, from the URL the build copies it to (see
// `vite-mathjax-asset.ts`). One tag, one time, per session.

import { macrosFor, stripRegistryCommands } from "../latex.ts";
import type { MathRendererAdapter, MathRenderRequest, RenderedMath } from "../types.ts";

/**
 * Where the build publishes MathJax and its font package. Kept in sync with
 * `vite-mathjax-asset.ts`.
 */
const VENDOR_PREFIX = "/vendor/";
export const MATHJAX_SCRIPT_URL = `${VENDOR_PREFIX}mathjax/tex-mml-chtml.js`;
/** What MathJax's `@mathjax/…` font references resolve against. */
const FONT_PACKAGE_ROOT = `${VENDOR_PREFIX}@mathjax`;

/** MathJax's own stylesheet is generated at runtime, so only the fonts are a URL. */
interface MathJaxDocument {
  /** Typesets one expression to a DOM node. */
  convert(latex: string, options: { display: boolean; em?: number; ex?: number }): Element;
  startup?: { document?: { menu?: unknown } };
}

interface MathJaxGlobal {
  tex2chtmlPromise?: (latex: string, options: { display: boolean }) => Promise<Element>;
  tex2chtml?: (latex: string, options: { display: boolean }) => Element;
  tex2mmlPromise?: (latex: string, options: { display: boolean }) => Promise<string>;
  tex2mml?: (latex: string, options: { display: boolean }) => string;
  startup?: {
    promise: Promise<void>;
    document?: MathJaxDocument;
  };
  /** Regenerates the stylesheet after new glyphs are used. */
  chtmlStylesheet?: () => HTMLStyleElement;
}

declare global {
  interface Window {
    MathJax?: MathJaxGlobal | Record<string, unknown>;
  }
}

let loadPromise: Promise<MathJaxGlobal> | null = null;

/**
 * Load and configure MathJax once.
 *
 * The configuration is assigned *before* the script tag is inserted, which is
 * how MathJax 4 expects to be configured — the bundle reads `window.MathJax`
 * during its own startup.
 */
export function loadMathJax(): Promise<MathJaxGlobal> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<MathJaxGlobal>((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("MathJax requires a browser document"));
      return;
    }

    window.MathJax = {
      tex: {
        // Delimiters are irrelevant here: expressions arrive already extracted
        // by remark-math, and `tex2chtml` is called directly. Set anyway so a
        // stray `\(` inside an expression behaves predictably.
        inlineMath: [["\\(", "\\)"]],
        displayMath: [["\\[", "\\]"]],
        macros: macrosFor("mathjax"),
        // Extends the *loaded* package set. These components ship inside the
        // bundle but are not active by default, so they are named in
        // `loader.load` below as well — naming them only here logs
        // "Package not found" and omits them, because at configuration time
        // nothing has loaded them yet.
        //
        // `mathtools` brings `multline`/`flalign` and friends — the AMS
        // environments KaTeX lacks, which are the whole reason MathJax is the
        // fallback. `physics` and `braket` cover the notation a physics
        // document is written in.
        packages: {
          "[+]": ["ams", "boldsymbol", "mathtools", "physics", "braket", "cancel", "empheq"],
        },
        // Numbering stays with the EquationRegistry so it cannot disagree with
        // KaTeX-rendered equations in the same document.
        tags: "none",
      },
      chtml: {
        // MathJax 4 keeps its fonts in a separate package and fetches them
        // lazily, by URL, as it meets glyphs — deriving the URL from the
        // `fonts` loader path below, so this is left to its default.
        // Inherit the reader's type size rather than imposing MathJax's.
        scale: 1,
        matchFontHeight: true,
        displayAlign: "center",
      },
      loader: {
        // MathJax resolves its font package as `@mathjax/…`, which it maps
        // through the `fonts` path — defaulting to the jsDelivr CDN in a
        // browser. Pointing it at the copy the build publishes keeps the reader
        // offline-capable and keeps a third-party CDN out of the request path.
        paths: { fonts: FONT_PACKAGE_ROOT },
        // The TeX packages named in `tex.packages` have to be *loaded* as well
        // as named, or MathJax logs "Package not found" and silently omits
        // them — which is what would send an `align` environment to the error
        // UI instead of to the engine that can draw it. They all ship inside
        // the bundle already, so this costs no extra request.
        load: [
          "[tex]/ams",
          "[tex]/boldsymbol",
          "[tex]/mathtools",
          "[tex]/physics",
          "[tex]/braket",
          "[tex]/cancel",
          "[tex]/empheq",
        ],
      },
      options: {
        // The accessibility explorer: keyboard navigation of the expression
        // tree and spoken sub-expressions. Off until the reader asks for it
        // (see `enableExplorer`) because it loads a speech-rule engine.
        enableMenu: false,
        enableExplorer: false,
        // Assistive MathML beside the visual output, so a screen reader reads
        // the expression rather than MathJax's layout boxes. (MathJax 4 spells
        // this as a menu setting; `enableAssistiveMml` is a v3 name and is
        // rejected as an invalid option.)
        menuOptions: { settings: { assistiveMml: true } },
      },
      startup: {
        // Nothing on the page needs a document-wide sweep: expressions are
        // converted one at a time, on demand.
        typeset: false,
      },
    };

    const script = document.createElement("script");
    script.src = MATHJAX_SCRIPT_URL;
    script.async = true;
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("Failed to load MathJax"));
    };
    script.onload = () => {
      const global = window.MathJax as MathJaxGlobal | undefined;
      if (!global?.startup?.promise) {
        loadPromise = null;
        reject(new Error("MathJax loaded without a startup promise"));
        return;
      }
      global.startup.promise
        .then(() => resolve(global))
        .catch((error: unknown) => {
          loadPromise = null;
          reject(error instanceof Error ? error : new Error("MathJax startup failed"));
        });
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

/** Whether MathJax is already resident, so callers can prefer it for free. */
export function isMathJaxLoaded(): boolean {
  return Boolean(
    typeof window !== "undefined" &&
    (window.MathJax as MathJaxGlobal | undefined)?.startup?.document,
  );
}

/**
 * A LaTeX error MathJax rendered rather than threw, as a message — or
 * `undefined` when the output is a real typesetting.
 *
 * Two shapes to look for. A structural error (an unclosed brace, a mismatched
 * environment, an unknown environment) becomes an `<merror>` element whose text
 * is the message. An unknown *command* is not an error to MathJax at all: it
 * renders the command name in red and carries on, which is why the colour is
 * checked too.
 */
function mathjaxError(node: HTMLElement): string | undefined {
  const merror = node.querySelector("merror, mjx-merror");
  if (merror) return merror.textContent?.trim() || "Invalid LaTeX";

  // `\unknownCommand` → `<mtext mathcolor="red">\unknownCommand</mtext>`, or
  // the CHTML equivalent carrying MathJax's own error class.
  const red = node.querySelector('[mathcolor="red"], .MathJax_Error, mjx-merror');
  const text = red?.textContent?.trim();
  if (text && text.startsWith("\\")) return `Unknown command ${text}`;

  return undefined;
}

/**
 * Let a screen reader see MathJax's MathML.
 *
 * MathJax marks *both* halves of its output `aria-hidden="true"`: the visual
 * CHTML (correctly — it is a box tree, not an expression) and the assistive
 * MathML beside it (because MathJax expects its own menu/explorer to manage
 * that copy, and the explorer is off by default here). The result is an
 * equation that is silent to assistive technology, which KaTeX's output never
 * is — its MathML carries no `aria-hidden` at all.
 *
 * So the assistive copy is unhidden, which is the one thing that makes a
 * MathJax-rendered equation as readable as a KaTeX-rendered one. It stays
 * visually clipped by MathJax's own stylesheet, so nothing changes on screen.
 */
function exposeAssistiveMathml(node: HTMLElement): void {
  const assistive = node.querySelector("mjx-assistive-mml");
  if (!assistive) return;
  assistive.removeAttribute("aria-hidden");
  // The `<math>` inside it must not be hidden either.
  assistive.querySelector("math")?.removeAttribute("aria-hidden");
}

/**
 * MathJax builds its CHTML stylesheet incrementally as new glyphs appear, so it
 * has to be re-published after each batch of conversions or later expressions
 * render with missing metrics.
 */
function syncStylesheet(global: MathJaxGlobal): void {
  if (typeof document === "undefined" || !global.chtmlStylesheet) return;
  const sheet = global.chtmlStylesheet();
  if (!sheet) return;
  const existing = document.getElementById("mathjax-chtml-styles");
  if (existing) existing.textContent = sheet.textContent;
  else {
    sheet.id = "mathjax-chtml-styles";
    document.head.appendChild(sheet);
  }
}

export const mathjaxAdapter: MathRendererAdapter = {
  engine: "mathjax",

  // MathJax with the AMS, physics, braket and mathtools packages loaded is the
  // broadest coverage available in a browser. Anything it cannot parse is a
  // genuine LaTeX error, which is reported rather than passed along.
  supports(): boolean {
    return true;
  },

  async render(request: MathRenderRequest): Promise<RenderedMath> {
    const { latex, displayMode } = request;
    const global = await loadMathJax();
    const source = stripRegistryCommands(latex);

    const node = global.tex2chtmlPromise
      ? await global.tex2chtmlPromise(source, { display: displayMode })
      : global.tex2chtml?.(source, { display: displayMode });
    if (!node) throw new Error("MathJax produced no output");

    // MathJax does not throw on a LaTeX error — it renders the message, or the
    // offending command in red, as ordinary output. Left alone, malformed math
    // would therefore arrive as a "successful" render and never reach the
    // error UI, which is the one place the reader is told what is wrong and
    // offered the source. So the output is inspected and turned back into a
    // rejection, which is the contract the renderer chain expects.
    const failure = mathjaxError(node as HTMLElement);
    if (failure) throw new Error(failure);

    exposeAssistiveMathml(node as HTMLElement);
    syncStylesheet(global);

    // MathML is taken from MathJax's own serializer rather than scraped out of
    // the CHTML: the assistive-MML island inside the output is present but
    // MathJax's `tex2mml` is the authoritative, complete form.
    let mathml: string | undefined;
    try {
      mathml = global.tex2mmlPromise
        ? await global.tex2mmlPromise(source, { display: displayMode })
        : global.tex2mml?.(source, { display: displayMode });
    } catch {
      // Copy MathML degrades to unavailable; the visual render is unaffected.
      mathml = undefined;
    }

    return {
      html: (node as HTMLElement).outerHTML,
      mathml,
      engine: "mathjax",
      latex,
      displayMode,
    };
  },
};

/**
 * Turn on MathJax's accessibility explorer for the whole page.
 *
 * Separate from loading because it pulls in a speech-rule engine of its own.
 * Once on, every MathJax expression on the page becomes keyboard-navigable and
 * announces its sub-expressions. Expressions already rendered are unaffected
 * until re-rendered, which the renderer preference change triggers anyway.
 */
export async function enableExplorer(): Promise<void> {
  const global = (await loadMathJax()) as MathJaxGlobal & {
    config?: { options?: Record<string, unknown> };
    loader?: { load?: (...names: string[]) => Promise<void> };
  };
  await global.loader?.load?.("a11y/explorer");
  const options = global.startup?.document as unknown as
    { options?: Record<string, unknown> } | undefined;
  if (options?.options) {
    options.options.enableExplorer = true;
    options.options.enableMenu = true;
  }
}
