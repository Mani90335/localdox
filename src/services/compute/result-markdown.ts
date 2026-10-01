// A computed result as Markdown: what Copy, "Add to rough work" and "Insert
// into document" all carry. One display equation that reads as a statement
// (input = result ≈ decimal, or equation ⟹ solutions), then the notes, so
// the assumptions travel with the result they qualify.

import type { ComputeAnswer, Solution } from "./protocol.ts";

/** "x = 2", "x = \frac{\pi}{6} \approx 0.5236", "x = 1 \ (\times 2)". */
export function solutionLatex(variable: string, solution: Solution): string {
  const value = solution.exact ?? solution.approx ?? "";
  const relation = solution.exact ? "=" : "\\approx";
  let latex = `${variable} ${relation} ${value}`;
  if (solution.exact && solution.approx) latex += ` \\approx ${solution.approx}`;
  if (solution.multiplicity > 1) latex += ` \\ (\\times ${solution.multiplicity})`;
  return latex;
}

/** Whether `forms` are other ways of writing the result (so `=` it), not separate results. */
function formsAreEqual(answer: ComputeAnswer): boolean {
  return answer.engine !== "advanced" || answer.op === "simplify";
}

/** `lhs = exact`, or `x \in {…}` when the left side already ends in a relation. */
export function withLhs(lhs: string, value: string): string {
  return /\\in\s*$|=\s*$/.test(lhs) ? `${lhs} ${value}` : `${lhs} = ${value}`;
}

/** The result as one LaTeX statement, without the notes. */
export function resultLatex(answer: ComputeAnswer): string {
  if (answer.op === "solve") {
    const solutions = answer.solutions;
    let outcome: string;
    if (answer.exact) outcome = answer.lhs ? withLhs(answer.lhs, answer.exact) : answer.exact;
    else if (solutions?.length) {
      outcome = solutions.map((s) => solutionLatex(answer.variable ?? "x", s)).join(",\\quad ");
    } else outcome = answer.complete ? "\\text{no solution}" : "\\text{no solution found}";
    return `${answer.input} \\quad\\Longrightarrow\\quad ${outcome}`;
  }
  if (answer.lhs) {
    let latex = answer.exact ? withLhs(answer.lhs, answer.exact) : answer.lhs;
    if (answer.approx) latex += ` \\approx ${answer.approx}`;
    return latex;
  }
  const chain = [answer.input];
  const steps = [
    answer.exact,
    ...(formsAreEqual(answer) ? (answer.forms ?? []).map((f) => f.latex) : []),
  ];
  for (const step of steps) {
    if (step && !chain.includes(step)) chain.push(step);
  }
  let latex = chain.join(" = ");
  if (answer.approx) latex += ` \\approx ${answer.approx}`;
  return latex;
}

export function resultMarkdown(answer: ComputeAnswer): string {
  const parts: string[] = [];
  if (answer.given?.length) parts.push(`Given ${answer.given.map((g) => `$${g}$`).join(", ")}.`);
  parts.push(`$$\n${resultLatex(answer)}\n$$`);
  // Results beside the main one (eigenspaces, a statistics summary), one per line.
  if (!formsAreEqual(answer) && answer.forms?.length) {
    parts.push(answer.forms.map((f) => `- ${f.label}: $${f.latex}$`).join("\n"));
  }
  if (answer.notes.length) parts.push(answer.notes.join("\n\n"));
  return parts.join("\n\n");
}
