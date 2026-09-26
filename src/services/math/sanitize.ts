// Sanitizing engine output.
//
// Every engine here is fed untrusted markdown, and every engine's output is
// handed to `dangerouslySetInnerHTML`. Both adapters run with `trust: false`,
// which already denies the HTML-producing commands (`\href`, `\includegraphics`,
// `\htmlClass`, `\htmlData`), so this is defence in depth rather than the only
// line — but it is the line that holds if an engine ever gains a new command,
// or if a `\text{…}` body finds a path through.
//
// The allow-list is deliberately shaped around what math *is*: MathML elements,
// KaTeX's and MathJax's layout spans, and the presentational attributes those
// need. No event handlers, no URLs, no foreign objects, no `<style>`.

import DOMPurify from "dompurify";

/** MathML presentation elements, plus the semantics/annotation pair. */
const MATHML_TAGS = [
  "math",
  "annotation",
  "annotation-xml",
  "maction",
  "menclose",
  "merror",
  "mfenced",
  "mfrac",
  "mglyph",
  "mi",
  "mlabeledtr",
  "mmultiscripts",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mphantom",
  "mprescripts",
  "mroot",
  "mrow",
  "ms",
  "mspace",
  "msqrt",
  "mstyle",
  "msub",
  "msubsup",
  "msup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "munder",
  "munderover",
  "none",
  "semantics",
] as const;

/**
 * What KaTeX and MathJax's CHTML layout is built from.
 *
 * MathJax 4's CHTML output is a tree of custom elements (`<mjx-container>`,
 * `<mjx-math>`, `<mjx-mi>`, one per MathML node type and several per glyph
 * class). Omitting them did not fail loudly — DOMPurify unwrapped each one and
 * left the bare MathML behind, which the browser then laid out *as well as*
 * MathJax's own assistive copy, so every fallback equation rendered twice. They
 * are structural elements carrying no URLs or handlers, and the attribute
 * allow-list below still applies to them, so the whole namespace is allowed by
 * prefix rather than enumerated.
 */
const LAYOUT_TAGS = ["span", "div", "svg", "g", "path", "rect", "line", "use", "defs", "text"];

/** MathJax's custom-element prefix; every tag it emits for CHTML starts here. */
const MJX_PREFIX = "mjx-";

const ALLOWED_ATTRS = [
  // Structural / styling.
  "class",
  "style",
  "id",
  // MathML presentation.
  "accent",
  "accentunder",
  "columnalign",
  "columnlines",
  "columnspacing",
  "columnspan",
  "depth",
  "dir",
  "display",
  "displaystyle",
  "encoding",
  "fence",
  "height",
  "linethickness",
  "lspace",
  "mathbackground",
  "mathcolor",
  "mathsize",
  "mathvariant",
  "maxsize",
  "minsize",
  "movablelimits",
  "notation",
  "rowalign",
  "rowlines",
  "rowspacing",
  "rowspan",
  "rspace",
  "scriptlevel",
  "separator",
  "stretchy",
  "symmetric",
  "voffset",
  "width",
  "xmlns",
  // SVG geometry, for MathJax's SVG output and KaTeX's rule/extensible glyphs.
  "d",
  "fill",
  "stroke",
  "stroke-width",
  "transform",
  "viewBox",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "preserveAspectRatio",
  "focusable",
  // Accessibility. These carry the semantics a screen reader reads, so they
  // must survive sanitizing.
  "aria-hidden",
  "aria-label",
  "aria-labelledby",
  "aria-describedby",
  "role",
  "tabindex",
  "data-mml-node",
  "data-semantic-type",
  "data-semantic-role",
  "data-semantic-speech",
  "data-latex",
];

const CONFIG = {
  ALLOWED_TAGS: [...MATHML_TAGS, ...LAYOUT_TAGS],
  ALLOWED_ATTR: ALLOWED_ATTRS,
  // MathML lives in its own namespace; without this DOMPurify treats `<math>`
  // and its children as unknown HTML and strips them.
  USE_PROFILES: { html: true, mathMl: true, svg: true },
  // No `href`/`xlink:href` in the allow-list above, so nothing here can
  // navigate — but `ALLOW_DATA_ATTR: false` also closes the generic
  // `data-*` escape hatch, leaving only the semantic attributes named above.
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: true,
  // `<style>` inside math output would be a page-wide CSS injection.
  FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "foreignObject"],
  FORBID_ATTR: ["srcset", "src", "href", "xlink:href", "formaction", "action"],
};

/**
 * Whether a real DOM is available. Under the node test runner and during SSR
 * there is none, and DOMPurify cannot run.
 */
const canSanitize = typeof window !== "undefined" && typeof window.document !== "undefined";

/**
 * Registered once: allow MathJax's `mjx-*` custom elements through.
 *
 * A hook rather than an enumerated tag list because MathJax emits an element
 * per MathML node type and per glyph class — dozens of names, versioned with
 * the engine. The prefix is the stable contract. Attributes are still filtered
 * by the allow-list above, so these elements can carry structure and nothing
 * else.
 */
let hookInstalled = false;
function installHook(): void {
  if (hookInstalled || !canSanitize) return;
  hookInstalled = true;
  DOMPurify.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName?.startsWith(MJX_PREFIX)) {
      data.allowedTags[data.tagName] = true;
    }
  });
}

/**
 * Sanitize one engine's markup.
 *
 * Off the browser (SSR, unit tests) this returns the input unchanged: there is
 * no DOM to parse with, and nothing is being inserted into a live document
 * either — the markup is only ever mounted client-side, where the real pass
 * runs before insertion.
 */
export function sanitizeMathMarkup(html: string): string {
  if (!canSanitize) return html;
  installHook();
  return DOMPurify.sanitize(html, CONFIG) as unknown as string;
}
