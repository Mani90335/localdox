import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkDirective from "remark-directive";
import remarkMath from "remark-math";
import { z } from "zod";
import { ExamImportError, idSchema, type Issue } from "./schema.ts";
import { blankHeader, paperHeader } from "./rules-tag.ts";

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
function containers(source: string, kind: string): Node[] {
  const root = processor.parse(source) as Node;
  const errors: Issue[] = [];
  const nodes: Node[] = [];
  for (const n of root.children ?? []) {
    if (n.type !== "containerDirective" || n.name !== kind) {
      errors.push({
        severity: "error",
        location: `${kind}.md:${n.position?.start.line}`,
        message: `Expected a :::${kind} container (put headings inside it)`,
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
/** A heading's text, without its `#` marks. */
const headingText = (source: string, n: Node) =>
  sourceOf(source, n)
    .split("\n")[0]
    .replace(/^#+\s*|\s*#*\s*$/g, "");
/**
 * The top-level blocks of a question file, in order. Only headings and
 * `:::question` / `:::solution` containers are allowed: a stray paragraph
 * would otherwise vanish from what the reader is asked.
 */
function questionFileBlocks(
  source: string,
  file: string,
  errors: Issue[],
): ({ heading: string; node: Node } | { heading?: undefined; node: Node })[] {
  const root = processor.parse(source) as Node,
    blocks: ({ heading: string; node: Node } | { heading?: undefined; node: Node })[] = [];
  for (const n of root.children ?? []) {
    const location = `${file}:${n.position?.start.line}`;
    if (n.type === "heading") {
      blocks.push({ heading: headingText(source, n), node: n });
      continue;
    }
    if (n.type === "thematicBreak") continue;
    if (n.type !== "containerDirective" || (n.name !== "question" && n.name !== "solution")) {
      errors.push({
        severity: "error",
        location,
        message: "Expected a heading or a :::question or :::solution block (put text inside it)",
      });
      continue;
    }
    if (!/^:{3,}\s*$/.test(sourceOf(source, n).trimEnd().split("\n").at(-1) ?? ""))
      errors.push({ severity: "error", location, message: "Unclosed directive" });
    blocks.push({ node: n });
  }
  return blocks;
}
/**
 * Questions and the solutions matched to them by id. Ids are unique across
 * the file, because a solution may sit anywhere in it.
 */
function pairUp(
  source: string,
  file: string,
  questionNodes: Node[],
  solutionNodes: Node[],
  defaults: Record<string, string>,
  errors: Issue[],
): { questions: Question[]; solutions: Solution[] } {
  const questions: Question[] = [],
    solutions: Solution[] = [],
    ids = new Set<string>();
  for (const node of questionNodes) {
    const q = toQuestion(source, node, file, defaults);
    if (ids.has(q.id))
      errors.push({ severity: "error", location: q.location, message: `Duplicate id: ${q.id}` });
    ids.add(q.id);
    questions.push(q);
  }
  for (const node of solutionNodes) {
    const s = toSolution(source, node, file);
    if (ids.has(s.id)) solutions.push(s);
    else
      errors.push({
        severity: "error",
        location: s.location,
        message: `No question for solution ${s.id}`,
      });
  }
  return { questions, solutions };
}

/** An `.xam` paper: its exam questions and their keys. */
export interface ExamFile {
  questions: Question[];
  solutions: Solution[];
}
/**
 * One exam paper. `:::question` blocks are the exam, in order; `:::solution`
 * blocks (key + explanation) may sit anywhere, including under a
 * `# Solutions` heading, and are matched by id. Headings are optional:
 * `# Exam` (or `# Questions`) and `# Solutions` only organise the file.
 * Practice belongs in an `.xp` file, which shows keys as soon as a question
 * is answered; a paper's keys stay sealed until it is submitted.
 */
export function parseExamFile(raw: string, file = "exam.xam"): ExamFile {
  const errors: Issue[] = [];
  // The optional `---` header names the paper's ruleset (rules-tag.ts). It is
  // checked here, then blanked so line numbers below still match the file.
  for (const field of paperHeader(raw)?.fields ?? []) {
    if (field.key !== "rules")
      errors.push({
        severity: "error",
        location: `${file}:${field.line}`,
        message: `Unknown header field "${field.key}". The header only names the ruleset: rules: name.xrule`,
      });
    else if (!/\.xrule$/i.test(field.value))
      errors.push({
        severity: "error",
        location: `${file}:${field.line}`,
        message: "rules must name an .xrule file, like rules: mock.xrule",
      });
  }
  const source = blankHeader(raw),
    questionNodes: Node[] = [],
    solutionNodes: Node[] = [];
  let inSolutions = false;
  for (const block of questionFileBlocks(source, file, errors)) {
    const location = `${file}:${block.node.position?.start.line}`;
    if (block.heading !== undefined) {
      const text = block.heading.trim().toLowerCase();
      if (/^(exam|questions?)\b/.test(text)) inSolutions = false;
      else if (/^(answer keys?|answers|keys?|solutions?)\b/.test(text)) inSolutions = true;
      else
        errors.push({
          severity: "error",
          location,
          message: /^practi[cs]e\b/.test(text)
            ? "Practice questions go in their own .xp file, where each answer is checked at once. An exam paper holds only its exam."
            : `Unknown heading "${block.heading}". Use # Exam or # Solutions, or no heading`,
        });
    } else if (block.node.name === "solution") solutionNodes.push(block.node);
    else if (inSolutions)
      errors.push({
        severity: "error",
        location,
        message: "Put this question before the # Solutions heading",
      });
    else questionNodes.push(block.node);
  }
  if (errors.length) throw new ExamImportError(errors);
  const paper = pairUp(source, file, questionNodes, solutionNodes, { section: "exam" }, errors);
  if (errors.length) throw new ExamImportError(errors);
  return paper;
}

/** An `.xp` file: practice questions, grouped under the headings above them. */
export interface PracticeFile {
  groups: { title: string | null; questions: Question[] }[];
  solutions: Solution[];
}
/**
 * Practice questions in the paper's grammar, with no rules file: every
 * heading starts a group, `marks` is optional, and each question's solution
 * may sit anywhere. Practice has no sections, timer or penalty.
 */
export function parsePracticeFile(source: string, file = "practice.xp"): PracticeFile {
  const errors: Issue[] = [],
    questionNodes: Node[] = [],
    solutionNodes: Node[] = [],
    titles: (string | null)[] = [];
  let title: string | null = null;
  for (const block of questionFileBlocks(source, file, errors)) {
    if (block.heading !== undefined) title = block.heading.trim() || null;
    else if (block.node.name === "solution") solutionNodes.push(block.node);
    else {
      questionNodes.push(block.node);
      titles.push(title);
    }
  }
  if (errors.length) throw new ExamImportError(errors);
  const { questions, solutions } = pairUp(
    source,
    file,
    questionNodes,
    solutionNodes,
    { section: "practice", marks: "1" },
    errors,
  );
  if (errors.length) throw new ExamImportError(errors);
  const groups: PracticeFile["groups"] = [];
  questions.forEach((q, i) => {
    const last = groups.at(-1);
    if (last && last.title === titles[i]) last.questions.push(q);
    else groups.push({ title: titles[i], questions: [q] });
  });
  return { groups, solutions };
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
