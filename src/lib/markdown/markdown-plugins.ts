// Demand-driven remark/rehype plugin sets for the markdown viewer.
//
// `rehype-highlight` pulls in highlight.js (~279 kB). Listing it statically
// meant every reader downloaded it before the first document could paint,
// whether or not the document contained a single code fence. It is imported
// here on demand instead: each document declares what it needs, the module
// resolves once and is then cached for every document after it.
//
// Content renders immediately with whatever is already loaded; a late-arriving
// plugin re-renders the tree once. Unhighlighted code is still correctly laid
// out monospace in the meantime, so the upgrade reads as syntax colour
// arriving, not as a reflow.
//
// Math takes a different route. `rehype-katex` used to typeset it here, in the
// tree — which threw the original LaTeX away, leaving nothing for Copy LaTeX,
// Show Source, equation labelling or a fallback re-render to work from. The
// math passes below convert remark-math's nodes into elements that *carry* the
// source, and the viewer maps those to React components that typeset it
// through the MathRenderer (see `src/services/math/`). KaTeX still loads on demand,
// now from inside that renderer.

import { useEffect, useMemo, useState } from "react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeSlug from "rehype-slug";
import {
  remarkEquationReferences,
  remarkInlineMathRefs,
  remarkMathNodes,
  isKatexLoaded,
  loadKatex,
} from "@/services/math";
import { loadKatexStyles, loadMonoFont } from "../fonts/fonts";

type Plugin = unknown;

/** Fenced or indented code, or an inline span — anything highlight.js styles. */
const CODE_RE = /(^|\n)\s*(```|~~~)|`[^`\n]+`/;
/** `$…$`, `$$…$$`, and the LaTeX bracket forms remark-math understands. */
const MATH_RE = /\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\(|\\\[/;

export interface MarkdownNeeds {
  code: boolean;
  math: boolean;
}

/** What a chunk of markdown source needs beyond the always-on plugins. */
export function detectMarkdownNeeds(source: string): MarkdownNeeds {
  return { code: CODE_RE.test(source), math: MATH_RE.test(source) };
}

// Module-level caches: the import promise (so concurrent callers share one
// request) and the resolved plugin (so later documents skip the async hop and
// render highlighted on their very first paint).
let highlightPromise: Promise<Plugin> | null = null;
let highlightPlugin: Plugin | null = null;

function loadHighlight(): Promise<Plugin> {
  highlightPromise ??= import("rehype-highlight")
    .then((m) => {
      highlightPlugin = m.default;
      return highlightPlugin;
    })
    .catch((error) => {
      highlightPromise = null;
      throw error;
    });
  return highlightPromise;
}

// Always-on plugins. Frozen module-level arrays: react-markdown re-parses when
// a plugin array changes identity, so these must never be rebuilt per render.
//
// Order matters among the math passes. `remarkMath` produces the math nodes;
// `remarkInlineMathRefs` then splits `\ref`/`\eqref` out of inline math into
// their own nodes; `remarkMathNodes` finally maps whatever math nodes remain
// onto our own element. Running the mapping first would leave the references
// buried inside an already-converted node.
const BASE_REMARK = [
  remarkGfm,
  remarkMath,
  remarkInlineMathRefs,
  remarkMathNodes,
  remarkEquationReferences,
] as const;
const BASE_REHYPE = [rehypeSlug] as const;

/**
 * Plugin arrays for one document's source, plus the extra remark plugins the
 * caller wants merged in (the viewer supplies its interactive-block pass).
 */
export function useMarkdownPlugins(source: string, extraRemark: readonly Plugin[] = []) {
  const needs = useMemo(() => detectMarkdownNeeds(source), [source]);

  // Re-render when a needed plugin lands. Seeded from the module cache so a
  // second document renders complete on its first pass.
  const [, setLoadedAt] = useState(0);

  useEffect(() => {
    let alive = true;
    const bump = () => alive && setLoadedAt(Date.now());

    if (needs.code) {
      loadMonoFont();
      if (!highlightPlugin)
        void loadHighlight()
          .then(bump)
          .catch(() => {});
    }
    // Math: the stylesheet and the default engine, both requested as soon as
    // math is seen in the source so they are in flight while the tree parses.
    // A document with no math downloads neither.
    //
    // `bump` re-renders once KaTeX lands, which is what lets the equations that
    // were waiting on it take the synchronous path on their very next render
    // rather than each scheduling its own async round trip.
    if (needs.math) {
      loadKatexStyles();
      if (!isKatexLoaded())
        void loadKatex()
          .then(bump)
          .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [needs.code, needs.math]);

  const remarkPlugins = useMemo(
    () => [...BASE_REMARK, ...extraRemark],
    // `extraRemark` is expected to be a stable module-level array; spreading it
    // into the dep list keeps a caller that passes a literal from thrashing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...extraRemark],
  );

  const rehypePlugins = useMemo(() => {
    const list: Plugin[] = [...BASE_REHYPE];
    if (needs.code && highlightPlugin) {
      // Unlabelled fences stay plain; trying every language on each block is
      // expensive on long documents. Explicit language fences retain colours.
      list.push([highlightPlugin, { detect: false, ignoreMissing: true }]);
    }
    return list;
    // `highlightPlugin` is module state, not a reactive value — the effect
    // above forces the re-render that re-reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needs.code, highlightPlugin]);

  // react-markdown's `PluggableList` is structurally what both arrays are, but
  // importing unified's types here just to satisfy the cast is not worth it.
  return { remarkPlugins, rehypePlugins } as {
    remarkPlugins: never[];
    rehypePlugins: never[];
  };
}
