// Pure LaTeX string analysis. No engine, no DOM — so it is testable under the
// plain node test runner, and it is the single place that decides what a piece
// of source *says* before any engine is asked to draw it.

/**
 * Commands KaTeX does not implement, so `supports()` can hand them to MathJax
 * without paying for a parse that is going to throw.
 *
 * Deliberately short and specific. KaTeX's own error is the real authority —
 * this list exists to skip the round trip for the constructs that come up in
 * physics writing, not to duplicate KaTeX's function table.
 */
const KATEX_UNSUPPORTED = [
  // AMS environments KaTeX has no parser for.
  //
  // Verified against the installed KaTeX rather than assumed: `align`,
  // `align*`, `gather`, `split`, `alignat` and `aligned` *are* supported (in
  // display mode), so listing them here would send perfectly good input to
  // MathJax and lose the fast path for exactly the documents that need it most.
  // These are the ones KaTeX genuinely has no environment for.
  /\\begin\{(multline\*?|eqnarray\*?|flalign\*?|xalignat\*?|xxalignat\*?|subequations|IEEEeqnarray|empheq|alignedat)\}/,
  // Diagram/commutative-diagram packages.
  /\\begin\{(tikzcd|tikzpicture|CD)\}/,
  /\\xymatrix/,
  // physics.sty — common in QM writing, not in KaTeX.
  /\\(dv|pdv|odv|qty|evaluated|Res|principalvalue|absolutevalue)\b/,
  // mhchem is an optional KaTeX extension we do not ship.
  /\\(ce|pu)\{/,
  // Layout/box commands outside KaTeX's scope.
  /\\(parbox|minipage|multicolumn|shortstack|raisebox|makebox|framebox)\b/,
  /\\begin\{(tabular|array\*|figure|table|center)\}/,
  // Programmable TeX. Never safe to hand to KaTeX, and MathJax handles the
  // benign subset of it.
  /\\(def|newcommand|renewcommand|providecommand|let|expandafter|csname|catcode)\b/,
  // Counters and cross-referencing machinery.
  /\\(setcounter|addtocounter|refstepcounter|value)\b/,
  // Unicode-math / fontspec territory.
  /\\(setmathfont|symbf|symit|symbb)\b/,
] as const;

/**
 * Whether KaTeX is worth trying for this source.
 *
 * Conservative in the direction that matters: a false positive costs one failed
 * parse and a fallback (correct output, slightly slower), while a false negative
 * would send perfectly good KaTeX input to MathJax and lose the fast path.
 */
export function katexCanAttempt(latex: string): boolean {
  return !KATEX_UNSUPPORTED.some((pattern) => pattern.test(latex));
}

/** `\label{eq:maxwell}` → `eq:maxwell`. First label wins; later ones are noise. */
export function extractLabel(latex: string): string | undefined {
  const match = /\\label\s*\{([^}]+)\}/.exec(latex);
  return match ? match[1].trim() || undefined : undefined;
}

/**
 * Strip the commands that are *our* job rather than the engine's.
 *
 * `\label` places no ink and neither KaTeX nor Temml implements it, so leaving
 * it in turns a perfectly good equation into a parse error. `\nonumber` and
 * `\notag` are read by the registry (see {@link isNumberSuppressed}) and then
 * removed for the same reason.
 *
 * The author's original string is never mutated in place — callers keep it for
 * Copy LaTeX and Show Source. This produces the *engine input* only.
 */
export function stripRegistryCommands(latex: string): string {
  return latex
    .replace(/\\label\s*\{[^}]*\}/g, "")
    .replace(/\\(?:nonumber|notag)\b\s*/g, "")
    .replace(/\\tag\s*\{[^}]*\}/g, "");
}

/** `\nonumber` / `\notag` — the author opting this equation out of numbering. */
export function isNumberSuppressed(latex: string): boolean {
  return /\\(?:nonumber|notag)\b/.test(latex);
}

/** `\tag{2a}` — an author-chosen number that overrides the automatic counter. */
export function explicitTag(latex: string): string | undefined {
  const match = /\\tag\s*\{([^}]+)\}/.exec(latex);
  return match ? match[1].trim() || undefined : undefined;
}

/** Every `\ref{…}` / `\eqref{…}` target named in a piece of source. */
export function extractReferences(latex: string): string[] {
  const found: string[] = [];
  const pattern = /\\(?:eqref|ref)\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(latex))) {
    const key = match[1].trim();
    if (key) found.push(key);
  }
  return found;
}

/**
 * Macros preloaded into every engine.
 *
 * Physics and relativity notation is mostly *not* in core LaTeX — `\bra`,
 * `\ket`, `\dd` and friends come from `physics.sty`/`braket.sty`, which no
 * browser engine bundles. Defining them here in terms of primitives every
 * engine does implement means one definition serves KaTeX, MathJax and Temml
 * alike, and the reader's source stays the source they would write in a paper.
 *
 * Kept to notation with one unambiguous meaning. `physics.sty`'s argument-
 * sniffing commands (`\dv` with optional orders, `\qty` auto-sizing to content)
 * cannot be expressed as simple macros, so `katexCanAttempt` routes those to
 * MathJax instead of approximating them here.
 */
export const MATH_MACROS: Readonly<Record<string, string>> = Object.freeze({
  // --- Dirac / bra-ket -----------------------------------------------------
  "\\bra": "\\left\\langle #1\\right|",
  "\\ket": "\\left|#1\\right\\rangle",
  "\\braket": "\\left\\langle #1\\middle|#2\\right\\rangle",
  "\\ketbra": "\\left|#1\\right\\rangle\\!\\left\\langle #2\\right|",
  "\\expval": "\\left\\langle #1\\right\\rangle",
  "\\ev": "\\left\\langle #1\\right\\rangle",
  "\\mel": "\\left\\langle #1\\middle|#2\\middle|#3\\right\\rangle",
  "\\comm": "\\left[#1,#2\\right]",
  "\\acomm": "\\left\\{#1,#2\\right\\}",
  "\\anticomm": "\\left\\{#1,#2\\right\\}",
  "\\poissonbracket": "\\left\\{#1,#2\\right\\}",

  // --- Differentials and operators ----------------------------------------
  "\\dd": "\\mathrm{d}",
  "\\dt": "\\mathrm{d}t",
  "\\grad": "\\boldsymbol{\\nabla}",
  "\\divergence": "\\boldsymbol{\\nabla}\\cdot",
  "\\curl": "\\boldsymbol{\\nabla}\\times",
  "\\laplacian": "\\nabla^{2}",
  "\\dalembertian": "\\Box",
  "\\Lagr": "\\mathcal{L}",
  "\\Ham": "\\mathcal{H}",
  "\\Tr": "\\operatorname{Tr}",
  "\\tr": "\\operatorname{tr}",
  "\\diag": "\\operatorname{diag}",
  "\\sgn": "\\operatorname{sgn}",
  "\\Res": "\\operatorname{Res}",
  "\\herm": "^{\\dagger}",
  "\\hc": "\\text{h.c.}",
  "\\adj": "^{\\dagger}",

  // --- Vectors and tensors -------------------------------------------------
  "\\vb": "\\mathbf{#1}",
  "\\vu": "\\hat{\\mathbf{#1}}",
  "\\vec": "\\boldsymbol{#1}",
  "\\uvec": "\\hat{\\boldsymbol{#1}}",
  "\\tensor": "\\mathsf{#1}",
  "\\fourvec": "#1^{\\mu}",

  // --- Units and constants -------------------------------------------------
  "\\unit": "\\,\\mathrm{#1}",
  "\\si": "\\,\\mathrm{#1}",
  "\\degree": "^{\\circ}",
  "\\hbar": "\\mathchar'0127",
  "\\kB": "k_{\\mathrm{B}}",
  "\\eV": "\\,\\mathrm{eV}",

  // --- Common shorthands ---------------------------------------------------
  "\\R": "\\mathbb{R}",
  "\\C": "\\mathbb{C}",
  "\\Z": "\\mathbb{Z}",
  "\\N": "\\mathbb{N}",
  "\\Q": "\\mathbb{Q}",
  "\\abs": "\\left\\lvert #1\\right\\rvert",
  "\\norm": "\\left\\lVert #1\\right\\rVert",
  "\\set": "\\left\\{#1\\right\\}",
  "\\order": "\\mathcal{O}\\!\\left(#1\\right)",
  "\\ii": "\\mathrm{i}",
  "\\ee": "\\mathrm{e}",
});

// `\hbar` above uses `\mathchar` for MathJax's benefit; KaTeX defines \hbar
// itself and its macro table takes precedence in a way that varies by version.
// Rather than depend on that, the KaTeX adapter drops this one entry — see
// `katexMacros`.
const ENGINE_EXCLUDED: Readonly<Record<string, readonly string[]>> = {
  katex: ["\\hbar", "\\vec"],
  temml: ["\\hbar"],
  // MathJax loads the real `physics` and `braket` packages, whose versions of
  // these commands are more capable than the approximations above (they size
  // delimiters to their content and take optional derivative orders). A macro
  // defined here would shadow them, so the packages win.
  mathjax: [
    "\\bra",
    "\\ket",
    "\\braket",
    "\\ketbra",
    "\\expval",
    "\\ev",
    "\\mel",
    "\\comm",
    "\\acomm",
    "\\anticomm",
    "\\poissonbracket",
    "\\dd",
    "\\grad",
    "\\divergence",
    "\\curl",
    "\\laplacian",
    "\\dalembertian",
    "\\Tr",
    "\\tr",
    "\\diag",
    "\\Res",
    "\\vb",
    "\\vu",
    "\\abs",
    "\\norm",
    "\\order",
  ],
};

/** The macro table for one engine, minus the entries that engine defines better. */
export function macrosFor(engine: "katex" | "mathjax" | "temml"): Record<string, string> {
  const excluded = new Set(ENGINE_EXCLUDED[engine]);
  const out: Record<string, string> = {};
  for (const [name, body] of Object.entries(MATH_MACROS)) {
    if (!excluded.has(name)) out[name] = body;
  }
  return out;
}

/**
 * Whether a display equation should carry a number.
 *
 * Numbering an equation that is not a statement — a lone symbol shown on its
 * own line, a `\text{…}` aside — is noise, so a number is offered only to
 * display math that either declares a label or looks like a relation.
 */
export function isNumberable(latex: string, displayMode: boolean): boolean {
  if (!displayMode) return false;
  if (isNumberSuppressed(latex)) return false;
  if (extractLabel(latex) || explicitTag(latex)) return true;
  const body = stripRegistryCommands(latex).trim();
  if (!body) return false;
  // A relation symbol, or an alignment/cases environment (which is a set of
  // relations by construction).
  return (
    /(?:=|\\ne\b|\\neq\b|\\leq\b|\\geq\b|≤|≥|<|>|\\sim\b|\\approx\b|\\equiv\b|\\propto\b|\\to\b|\\rightarrow\b|\\implies\b|\\mapsto\b)/.test(
      body,
    ) || /\\begin\{(align|alignat|gather|multline|cases|split|eqnarray|flalign)/.test(body)
  );
}
