import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkDirective from "remark-directive";
import remarkMath from "remark-math";
import { z } from "zod";
import { ExamImportError, idSchema, type Issue } from "./schema.ts";

export type QuestionType = "mcq" | "msq" | "nat";
export interface Question {
  id: string;
  section: string;
  type: QuestionType;
  marks: number;
  topic?: string;
  difficulty?: string;
  time?: number;
  tags: string[];
  body: string;
  options: string[];
  location: string;
}
export interface Distractor {
  option?: string;
  value?: number;
  trap: string;
  note?: string;
}
export interface Solution {
  id: string;
  answer: string;
  tolerance?: number;
  body: string;
  distractors: Distractor[];
  location: string;
}
interface Node {
  type: string;
  name?: string;
  attributes?: Record<string, string>;
  children?: Node[];
  position?: { start: { offset?: number; line: number }; end: { offset?: number; line: number } };
}
const attrs = z
  .object({
    id: idSchema,
    section: z.string().min(1),
    type: z.enum(["mcq", "msq", "nat"]),
    marks: z.coerce.number().finite().positive(),
    topic: z.string().optional(),
    difficulty: z.string().optional(),
    time: z.coerce.number().finite().positive().optional(),
    tags: z.string().optional(),
  })
  .strict();
const solutionAttrs = z
  .object({
    id: idSchema,
    answer: z.string().min(1),
    tolerance: z.coerce.number().finite().nonnegative().optional(),
  })
  .strict();
const distractorAttrs = z
  .object({
    option: z
      .string()
      .regex(/^[A-Z]$/)
      .optional(),
    value: z.coerce.number().finite().optional(),
    trap: z.string().min(1),
    note: z.string().optional(),
  })
  .strict()
  .refine(
    (a) => (a.option !== undefined) !== (a.value !== undefined),
    "Provide exactly one of option or value",
  );
const processor = unified().use(remarkParse).use(remarkMath).use(remarkDirective);
function sourceOf(source: string, node: Node) {
  return source.slice(node.position?.start.offset, node.position?.end.offset);
}
function containers(source: string, kind: string, also: string[] = []): Node[] {
  const root = processor.parse(source) as Node;
  const errors: Issue[] = [];
  const nodes: Node[] = [];
  for (const n of root.children ?? []) {
    if (n.type !== "containerDirective" || (n.name !== kind && !also.includes(n.name ?? ""))) {
      errors.push({
        severity: "error",
        location: `${kind}.md:${n.position?.start.line}`,
        message: `Expected a :::${[kind, ...also].join(" or :::")} container (put headings inside it)`,
      });
      continue;
    }
    if (!/^:{3,}\s*$/.test(sourceOf(source, n).trimEnd().split("\n").at(-1) ?? ""))
      errors.push({
        severity: "error",
        location: `${kind}.md:${n.position?.start.line}`,
        message: "Unclosed directive",
      });
    nodes.push(n);
  }
  if (!nodes.length)
    errors.push({
      severity: "error",
      location: `${kind}.md`,
      message: `No ${kind} containers found`,
    });
  if (errors.length) throw new ExamImportError(errors);
  return nodes;
}
function toQuestion(source: string, n: Node, file: string, defaults = {}): Question {
  const location = `${file}:${n.position?.start.line}`;
  const a = attrs.safeParse({ ...defaults, ...n.attributes });
  if (!a.success)
    throw new ExamImportError(
      a.error.issues.map((i) => ({
        severity: "error",
        location: `${location}.${i.path.join(".")}`,
        message: i.message,
      })),
    );
  const children = n.children ?? [];
  const list = a.data.type === "nat" ? undefined : children.filter((c) => c.type === "list").at(-1);
  return {
    ...a.data,
    tags: a.data.tags?.split(",").filter(Boolean) ?? [],
    location,
    body: children
      .filter((c) => c !== list)
      .map((c) => sourceOf(source, c))
      .join("\n\n"),
    options: (list?.children ?? []).map((item) =>
      (item.children ?? []).map((c) => sourceOf(source, c)).join("\n\n"),
    ),
  };
}
export function parsePaper(source: string): Question[] {
  return containers(source, "question").map((n) => toQuestion(source, n, "paper.md"));
}
function toSolution(source: string, n: Node, file: string): Solution {
  const location = `${file}:${n.position?.start.line}`;
  const a = solutionAttrs.safeParse(n.attributes);
  if (!a.success)
    throw new ExamImportError(
      a.error.issues.map((i) => ({ severity: "error", location, message: i.message })),
    );
  const distractors: Distractor[] = [];
  const body: Node[] = [];
  for (const c of n.children ?? []) {
    if (c.type === "leafDirective" && c.name === "distractor") {
      const d = distractorAttrs.safeParse(c.attributes);
      if (!d.success)
        throw new ExamImportError(
          d.error.issues.map((i) => ({
            severity: "error",
            location: `${file}:${c.position?.start.line}`,
            message: i.message,
          })),
        );
      distractors.push(d.data);
    } else body.push(c);
  }
  return {
    ...a.data,
    location,
    body: body.map((c) => sourceOf(source, c)).join("\n\n"),
    distractors,
  };
}
export function parseSolutions(source: string): Solution[] {
  return containers(source, "solution").map((n) => toSolution(source, n, "solutions.md"));
}
/**
 * A practice file holds questions and their solutions together, in any order.
 * `section` is optional there: practice has no sections.
 */
export function parsePracticeFile(
  source: string,
  file = "practice.md",
): { questions: Question[]; solutions: Solution[] } {
  const nodes = containers(source, "question", ["solution"]);
  return {
    questions: nodes
      .filter((n) => n.name === "question")
      .map((n) => toQuestion(source, n, file, { section: "practice" })),
    solutions: nodes.filter((n) => n.name === "solution").map((n) => toSolution(source, n, file)),
  };
}
export const optionLabel = (index: number) => String.fromCharCode(65 + index);
export const numeric = (s: string) =>
  /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s.trim()) && Number.isFinite(Number(s));
export function natMatches(
  value: number,
  solution: Pick<Solution, "answer" | "tolerance">,
): boolean {
  const bounds = solution.answer.split(":").map(Number);
  if (bounds.length === 2) return value >= bounds[0] && value <= bounds[1];
  return (
    Math.abs(value - bounds[0]) <=
    (solution.tolerance ?? 0) +
      Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(bounds[0])) * 4
  );
}
