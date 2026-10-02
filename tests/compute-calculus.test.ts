import assert from "node:assert/strict";
import { test } from "node:test";
import katex from "katex";
import { ComputeEngine } from "@cortex-js/compute-engine";
import { compute, configureEngine } from "../src/services/compute/engine.ts";
import { resultMarkdown } from "../src/services/compute/result-markdown.ts";

const ce = new ComputeEngine();
configureEngine(ce);

test("keyboard derivatives and integrals have correct answers and plain steps", () => {
  for (const [input, expected] of [
    [String.raw`\frac{d}{dx}\left(x^3+2x\right)`, "3x^2+2"],
    [String.raw`\frac{d}{dx}\left(7\right)`, "0"],
    [String.raw`\frac{d}{dt}\left(t^2/2\right)`, "t"],
    [String.raw`\int x^2\,dx`, String.raw`\frac{x^3}{3} + C`],
    [String.raw`\int_0^1 x^2\,dx`, String.raw`\frac{1}{3}`],
    [String.raw`\int_1^0 x^2\,dx`, String.raw`\frac{-1}{3}`],
    [String.raw`\int_0^1 (x^3+2x)\,dx`, String.raw`\frac{5}{4}`],
    [String.raw`\int \sin x\,dx`, String.raw`-\cos(x) + C`],
    [String.raw`\frac{d}{dx}\left(\sin x\right)`, String.raw`\cos(x)`],
    [String.raw`\int e^x\,dx`, "\\mathrm{e}^{x} + C"],
  ]) {
    const result = compute(ce, { op: "evaluate", input });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.exact, expected, input);
    assert.ok(result.steps?.length);
    for (const step of result.steps)
      if (step.latex) katex.renderToString(step.latex, { throwOnError: true });
    assert.match(resultMarkdown(result, { steps: true }), /Steps/);
  }
});

test("unsupported calculus cannot silently turn into arithmetic or lose a hole at zero", () => {
  for (const input of [
    String.raw`\frac{d^{2}}{dx^{2}}\left(x^3\right)`,
    String.raw`\frac{d}{dx}\left(x^2\right)+4`,
    String.raw`\frac{ d }{ dx }{x^2}+4`,
    String.raw`\frac{\partial}{\partial x}\left(x^2\right)`,
    String.raw`\int_{-1}^1\frac{x}{x}\,dx`,
    String.raw`\int_{-1}^1\frac{1}{x/x}\,dx`,
    String.raw`\int_{-1}^1\frac{1}{x}\,dx`,
    String.raw`\int_0^{\infty} x^2\,dx`,
    String.raw`\int x^{1000}\,dx`,
    String.raw`\int \ln(x)\,dx`,
    String.raw`\int x^2 y\,dx`,
    String.raw`\lim_{x\to 0}\frac{\sin x}{x}`,
  ]) {
    const result = compute(ce, { op: "evaluate", input });
    assert.equal(result.ok, false, input);
    if (!result.ok) assert.equal(result.kind, "unsupported", input);
  }
});
