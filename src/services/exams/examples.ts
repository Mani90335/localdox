/**
 * The example exam: its rules, as the New exam form would save them, and its
 * one Markdown file. "Try the example" creates it; "Download example file"
 * saves the Markdown as a template to copy.
 */
import { GATE_SETUP, type ExamSetup } from "./exam-setup.ts";

const files = import.meta.glob<string>("../../../plans/example-exam.md", {
  query: "?raw",
  import: "default",
});
export const EXAMPLE_SETUP: ExamSetup = {
  ...GATE_SETUP,
  questionCount: 4,
  name: "Reasoning & arithmetic",
  summaryMd:
    "- Even and odd numbers, divisibility by 2, 3 and 5\n- Fractions as decimals, rounding to two places\n- Reading a simple bar chart and a directed graph",
  durationMinutes: 10,
  passPercentage: 70,
  maxAttempts: 3,
  mcqPenalty: "third",
  calculator: "scientific",
};
export async function exampleExamFile(): Promise<File> {
  const [load] = Object.values(files);
  return new File([await load()], "example-exam.md", { type: "text/markdown" });
}
