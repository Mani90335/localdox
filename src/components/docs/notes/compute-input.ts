// The Compute tab's input preferences, and moving input between its two
// modes (see ComputeComposer). Kept per device; nothing else depends on them.
// Relative imports, so tests run it in Node (tests/compute-keys.test.ts).

import { prepareInput } from "../../../services/compute/input.ts";
import { needsAdvanced } from "../../../services/compute/advanced/routing.ts";

/** Math: written as it looks, in a math field. Text: plain text or LaTeX, over several lines. */
export type InputMode = "math" | "text";

const MODE_KEY = "localdox:compute-input";
const KEYPAD_KEY = "localdox:compute-keypad";

export function preferredMode(): InputMode {
  try {
    return localStorage.getItem(MODE_KEY) === "text" ? "text" : "math";
  } catch {
    return "math";
  }
}
export function rememberMode(mode: InputMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Math again next time; nothing else depends on it.
  }
}
export function keypadPreferred(): boolean {
  try {
    return localStorage.getItem(KEYPAD_KEY) !== "closed";
  } catch {
    return true;
  }
}
export function rememberKeypad(open: boolean) {
  try {
    localStorage.setItem(KEYPAD_KEY, open ? "open" : "closed");
  } catch {
    // Open again next time.
  }
}

/**
 * Text input as math-field LaTeX, statement by statement (lines become `;`),
 * or null when some part can't be read: it then stays text rather than
 * reaching the math field as letters.
 */
export function asMath(text: string): string | null {
  const statements = text
    .split(/\n|(?<!\\);/)
    .map((s) => s.trim())
    .filter(Boolean);
  const latex: string[] = [];
  for (const statement of statements) {
    const prepared = prepareInput(statement, {
      advanced: statements.length > 1 || needsAdvanced(statement),
    });
    if (!prepared.ok) return null;
    latex.push(prepared.latex);
  }
  return latex.join(";");
}
