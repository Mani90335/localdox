// The Compute tab's math keyboard: what each key shows and what it does to
// the math field. Data only, so tests can check that every key writes LaTeX
// the engines read (tests/compute-keys.test.ts).
//
// Inserted LaTeX uses MathLive's placeholders: `#0` is the selection (or an
// empty box when nothing is selected), `#?` an empty box, and `#@` the thing
// just before the caret, so "2" then x² gives 2², and "1" then the fraction
// key gives 1 over an empty box. After an insert the caret lands in the first
// box. A key's face is its LaTeX with each placeholder drawn as □, unless it
// names its own.

/** MathLive commands the keys run (see mathlive/types/commands.d.ts). */
export type FieldCommand =
  | "moveToPreviousChar"
  | "moveToNextChar"
  | "deleteBackward"
  | "addRowAfter"
  | "addColumnAfter"
  | "removeRow"
  | "removeColumn";

export type KeyAction =
  /** A LaTeX template, with placeholders. */
  | { kind: "insert"; latex: string }
  /** Typed, as if on a keyboard: smart parentheses and shortcuts (pi → π) apply. */
  | { kind: "type"; text: string }
  | { kind: "command"; command: FieldCommand };

export interface MathKey {
  /** The key's accessible name. */
  name: string;
  /** Its face, as LaTeX; `text` faces are set in the UI font instead. */
  face: string;
  text?: boolean;
  action: KeyAction;
  /** Columns it spans (default 1). */
  span?: number;
  /** Digits are set apart from the rest, as on a calculator. */
  digit?: boolean;
  /** A tall face (a 3×3 matrix), drawn smaller to fit the key. */
  small?: boolean;
}

export interface KeyLayout {
  id: "basic" | "functions" | "calculus" | "matrices" | "symbols" | "letters";
  /** The tab's face, and its accessible name. */
  tab: string;
  name: string;
  columns: number;
  rows: MathKey[][];
}

const BOX = "\\square";

/** A LaTeX template key; its face is the template with □ for each box. */
function insert(name: string, latex: string, face?: string): MathKey {
  return { name, face: face ?? latex.replace(/#[0?@]/g, BOX), action: { kind: "insert", latex } };
}

/** A key typed as one character (or a short run, like a function name). */
function type(name: string, text: string, face = text): MathKey {
  return { name, face, text: true, action: { kind: "type", text } };
}

function digit(n: string): MathKey {
  return { ...type(n, n), digit: true };
}

/** A function applied to what's in its parentheses: sin(□). */
function fn(name: string, command: string, face?: string, text = !face): MathKey {
  return {
    name,
    face: face ?? command.replace(/^\\(?:operatorname\{(\w+)\}|(\w+))$/, "$1$2"),
    text,
    action: { kind: "insert", latex: `${command}\\left(#0\\right)` },
  };
}

function command(name: string, cmd: FieldCommand, face: string): MathKey {
  return { name, face, text: true, action: { kind: "command", command: cmd } };
}

function greek(name: string, latex: string): MathKey {
  return { name, face: latex, action: { kind: "insert", latex } };
}

const MATRIX_2 = "\\begin{pmatrix}#0 & #?\\\\ #? & #?\\end{pmatrix}";
const MATRIX_3 = "\\begin{pmatrix}#0 & #? & #?\\\\ #? & #? & #?\\\\ #? & #? & #?\\end{pmatrix}";

export const LAYOUTS: readonly KeyLayout[] = [
  {
    id: "basic",
    tab: "123",
    name: "Basic",
    columns: 8,
    rows: [
      [
        type("x", "x"),
        type("y", "y"),
        insert("Square", "#@^{2}"),
        insert("Power", "#@^{#?}"),
        digit("7"),
        digit("8"),
        digit("9"),
        insert("Divide", "\\div"),
      ],
      [
        type("Open parenthesis", "("),
        type("Close parenthesis", ")"),
        insert("Square root", "\\sqrt{#0}"),
        insert("Root", "\\sqrt[#?]{#0}"),
        digit("4"),
        digit("5"),
        digit("6"),
        insert("Times", "\\times"),
      ],
      [
        insert("Fraction", "\\frac{#@}{#?}"),
        insert("Absolute value", "\\left|#0\\right|", `\\left|${BOX}\\right|`),
        insert("Pi", "\\pi"),
        insert("e", "e"),
        digit("1"),
        digit("2"),
        digit("3"),
        type("Minus", "-", "−"),
      ],
      [
        type("Less than", "<"),
        type("Greater than", ">"),
        type("Comma", ","),
        insert("Imaginary unit", "i"),
        digit("0"),
        type("Decimal point", "."),
        type("Equals", "="),
        type("Plus", "+"),
      ],
    ],
  },
  {
    id: "functions",
    tab: "f(x)",
    name: "Functions",
    columns: 6,
    rows: [
      [
        fn("Sine", "\\sin"),
        fn("Cosine", "\\cos"),
        fn("Tangent", "\\tan"),
        insert("Degrees", "#@^{\\circ}"),
        fn("Natural logarithm", "\\ln"),
        fn("Logarithm", "\\log"),
      ],
      [
        fn("Inverse sine", "\\arcsin", "\\sin^{-1}"),
        fn("Inverse cosine", "\\arccos", "\\cos^{-1}"),
        fn("Inverse tangent", "\\arctan", "\\tan^{-1}"),
        insert("Exponential", "e^{#0}"),
        insert("Logarithm to a base", "\\log_{#?}\\left(#0\\right)", `\\log_{${BOX}}`),
        insert("Power of ten", "10^{#0}"),
      ],
      [
        fn("Hyperbolic sine", "\\sinh"),
        fn("Hyperbolic cosine", "\\cosh"),
        fn("Hyperbolic tangent", "\\tanh"),
        insert("Factorial", "#@!"),
        insert("Binomial coefficient", "\\binom{#?}{#?}", "\\binom{n}{k}"),
        insert("Absolute value", "\\left|#0\\right|", `\\left|${BOX}\\right|`),
      ],
      [
        fn("Secant", "\\sec"),
        fn("Cosecant", "\\csc"),
        fn("Cotangent", "\\cot"),
        insert("Floor", "\\left\\lfloor #0\\right\\rfloor", `\\lfloor ${BOX}\\rfloor`),
        fn("Greatest common divisor", "\\gcd"),
        fn("Least common multiple", "\\operatorname{lcm}"),
      ],
    ],
  },
  {
    id: "calculus",
    tab: "∫",
    name: "Calculus",
    columns: 6,
    rows: [
      [
        insert("Derivative", "\\frac{d}{dx}\\left(#0\\right)", "\\frac{d}{dx}"),
        insert("Second derivative", "\\frac{d^{2}}{dx^{2}}\\left(#0\\right)", "\\frac{d^2}{dx^2}"),
        insert(
          "Partial derivative",
          "\\frac{\\partial}{\\partial x}\\left(#0\\right)",
          "\\frac{\\partial}{\\partial x}",
        ),
        insert("Integral", "\\int #0\\,dx", `\\int ${BOX}\\,dx`),
        insert("Definite integral", "\\int_{#?}^{#?}#?\\,dx", `\\int_{${BOX}}^{${BOX}}`),
        insert("Infinity", "\\infty"),
      ],
      [
        insert("Limit", "\\lim_{x\\to #?}#?", `\\lim_{x\\to ${BOX}}`),
        insert("Limit at infinity", "\\lim_{x\\to\\infty}#?", "\\lim_{x\\to\\infty}"),
        insert("Sum", "\\sum_{n=#?}^{#?}#?", "\\sum"),
        insert("Product", "\\prod_{n=#?}^{#?}#?", "\\prod"),
        insert("Subscript", "#@_{#?}"),
        insert("e", "e"),
      ],
      [
        type("x", "x"),
        type("t", "t"),
        type("n", "n"),
        type("Open parenthesis", "("),
        type("Close parenthesis", ")"),
        insert("Power", "#@^{#?}"),
      ],
    ],
  },
  {
    id: "matrices",
    tab: "[ ]",
    name: "Matrices",
    columns: 4,
    rows: [
      [
        insert("2 by 2 matrix", MATRIX_2),
        { ...insert("3 by 3 matrix", MATRIX_3), small: true },
        insert("Column vector of 2", "\\begin{pmatrix}#0\\\\ #?\\end{pmatrix}"),
        {
          ...insert("Column vector of 3", "\\begin{pmatrix}#0\\\\ #?\\\\ #?\\end{pmatrix}"),
          small: true,
        },
      ],
      [
        command("Add a row", "addRowAfter", "+ Row"),
        command("Add a column", "addColumnAfter", "+ Col"),
        command("Remove the row", "removeRow", "− Row"),
        command("Remove the column", "removeColumn", "− Col"),
      ],
      [
        fn("Determinant", "\\det"),
        fn("Trace", "\\operatorname{tr}"),
        insert("Transpose", "#@^{T}"),
        insert("Inverse", "#@^{-1}"),
      ],
      [
        type("A", "A"),
        type("B", "B"),
        insert("Define", "\\coloneqq", ":="),
        type("Next statement", ";"),
      ],
    ],
  },
  {
    id: "symbols",
    tab: "αβ",
    name: "Greek and relations",
    columns: 8,
    rows: [
      [
        greek("alpha", "\\alpha"),
        greek("beta", "\\beta"),
        greek("gamma", "\\gamma"),
        greek("delta", "\\delta"),
        greek("epsilon", "\\epsilon"),
        greek("theta", "\\theta"),
        greek("lambda", "\\lambda"),
        greek("mu", "\\mu"),
      ],
      [
        greek("rho", "\\rho"),
        greek("sigma", "\\sigma"),
        greek("tau", "\\tau"),
        greek("phi", "\\phi"),
        greek("omega", "\\omega"),
        greek("eta", "\\eta"),
        greek("kappa", "\\kappa"),
        greek("nu", "\\nu"),
      ],
      [
        greek("Capital gamma", "\\Gamma"),
        greek("Capital delta", "\\Delta"),
        greek("Capital theta", "\\Theta"),
        greek("Capital lambda", "\\Lambda"),
        greek("Capital sigma", "\\Sigma"),
        greek("Capital phi", "\\Phi"),
        greek("Capital psi", "\\Psi"),
        greek("Capital omega", "\\Omega"),
      ],
      [
        insert("Less than or equal to", "\\le"),
        insert("Greater than or equal to", "\\ge"),
        insert("Not equal to", "\\ne"),
        insert("Distributed as", "\\sim"),
        insert("Expectation", "E\\left[#0\\right]", `E[${BOX}]`),
        type("Next statement", ";"),
        insert("Probability", "P\\left(#0\\right)", `P(${BOX})`),
        insert("Given", "\\mid"),
      ],
    ],
  },
  {
    id: "letters",
    tab: "abc",
    name: "Letters",
    columns: 10,
    rows: [
      [..."qwertyuiop"].map((l) => type(l, l)),
      [..."asdfghjkl"].map((l) => type(l, l)),
      [..."zxcvbnm"].map((l) => type(l, l)),
    ],
  },
];

/** Keys that are always there, beside the tabs. */
export const EDIT_KEYS: readonly MathKey[] = [
  command("Move left", "moveToPreviousChar", "←"),
  command("Move right", "moveToNextChar", "→"),
  command("Delete", "deleteBackward", "⌫"),
];

/** Empty boxes left in the field: there is nothing to compute until they're filled. */
export function hasEmptyBox(latex: string): boolean {
  return /\\placeholder\b/.test(latex);
}
