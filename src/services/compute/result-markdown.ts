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

/** The result as one LaTeX statement, without the notes. */
export function resultLatex(answer: ComputeAnswer): string {
  if (answer.op === "solve") {
    const solutions = answer.solutions;
    let outcome: string;
    if (answer.exact) outcome = answer.exact;
    else if (solutions?.length) {
      outcome = solutions.map((s) => solutionLatex(answer.variable ?? "x", s)).join(",\\quad ");
    } else outcome = answer.complete ? "\\text{no solution}" : "\\text{no solution found}";
    return `${answer.input} \\quad\\Longrightarrow\\quad ${outcome}`;
  }
  const chain = [answer.input];
  for (const step of [answer.exact, ...(answer.forms ?? []).map((form) => form.latex)]) {
    if (step && !chain.includes(step)) chain.push(step);
  }
  let latex = chain.join(" = ");
  if (answer.approx) latex += ` \\approx ${answer.approx}`;
  return latex;
}

export function resultMarkdown(answer: ComputeAnswer): string {
  const parts = [`$$\n${resultLatex(answer)}\n$$`];
  if (answer.notes.length) parts.push(answer.notes.join("\n\n"));
  return parts.join("\n\n");
}
