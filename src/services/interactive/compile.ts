// Compiles an ```interactive-react example (TypeScript + JSX) to the CommonJS
// the preview frame evaluates. Runs in compiler.worker.ts. Babel's `transform`
// is passed in, so the protocol types can be imported without Babel and the
// tests can drive it directly.

export type CompileResult =
  { ok: true; code: string } | { ok: false; message: string; stack?: string };

export type Transform = (
  code: string,
  options: { filename: string; presets: unknown[]; plugins: unknown[] },
) => { code?: string | null };

const OPTIONS = {
  filename: "interactive-component.tsx",
  presets: ["typescript", ["react", { runtime: "classic" }]],
  plugins: ["transform-modules-commonjs"],
};

/** Never throws: a compile error is a result the block shows its author. */
export function compileInteractive(transform: Transform, source: string): CompileResult {
  try {
    if (/^\s*import\s/m.test(source)) {
      throw new Error("React and hooks are provided automatically; remove import statements.");
    }
    return { ok: true, code: transform(source, OPTIONS).code ?? "" };
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    return { ok: false, message: error.message, stack: error.stack };
  }
}

export type CompileRequest = { id: number; source: string };
/** `ready` once Babel has loaded in the worker; then one reply per request. */
export type CompileReply =
  { type: "ready" } | { type: "result"; id: number; result: CompileResult };
