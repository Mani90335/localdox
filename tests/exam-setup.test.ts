import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { parseExamFile } from "../src/services/exams/parser.ts";
import { ExamImportError } from "../src/services/exams/schema.ts";
import { DEFAULT_SETUP, readExamFile, type ExamSetup } from "../src/services/exams/exam-setup.ts";
import { importSolutions } from "../src/services/exams/validation.ts";
import { parseXrule } from "../src/services/exams/xrule.ts";
import {
  attachExamFile,
  createExamPlan,
  hasExamFile,
  prepareStudyAttempt,
  studyProgress,
} from "../src/services/exams/study-plan.ts";
import {
  deleteExamData,
  listAttempts,
  listPlans,
  saveAttempt,
  savePlan,
} from "../src/services/exams/storage.ts";
import { forgetCheckpoints, type RecoveryStore } from "../src/services/exams/recovery.ts";

const setup: ExamSetup = {
  ...DEFAULT_SETUP,
  name: "Probability",
  durationMinutes: 20,
  passPercentage: 60,
  maxAttempts: 2,
  mcqPenalty: "third",
  calculator: "basic",
};
const FILE = `# Exam

:::question{#q1 type=mcq marks=3}
Three options?

- One
- Two
- Three
:::

:::question{#q2 type=nat marks=2 section=numbers}
Enter 7/3.
:::

## Keys and solutions

:::solution{#q1 answer=B}
Because two.

::distractor{option=A trap=boundary}
:::

:::solution{#q2 answer="2.32:2.34"}
Seven thirds.
:::
`;
const issuesOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ExamImportError, String(error));
    return error.issues.map((i) => `${i.location}: ${i.message}`);
  }
  assert.fail("expected an import error");
};

test("a paper's questions keep their order; solutions anywhere are matched by id", () => {
  const paper = parseExamFile(FILE, "prob.md");
  assert.deepEqual(
    paper.questions.map((q) => [q.id, q.section]),
    [
      ["q1", "exam"],
      ["q2", "numbers"],
    ],
  );
  assert.deepEqual(
    paper.solutions.map((s) => s.id),
    ["q1", "q2"],
  );
  // Headings are optional; without them the paper asks the same.
  const asked = (source: string) => {
    const p = parseExamFile(source);
    return [...p.questions, ...p.solutions].map(({ location: _, ...rest }) => rest);
  };
  assert.deepEqual(
    asked(FILE.replace("# Exam\n", "").replace("## Keys and solutions\n", "")),
    asked(FILE),
  );
});

test("structure errors name the file and line", () => {
  assert.deepEqual(
    issuesOf(() => parseExamFile("# Intro\n\n:::question{#a type=nat marks=1}\nQ\n:::\n", "x.md")),
    ['x.md:1: Unknown heading "Intro". Use # Exam or # Solutions, or no heading'],
  );
  assert.deepEqual(
    issuesOf(() =>
      parseExamFile(
        "# Exam\n\n:::question{#a type=nat marks=1}\nQ\n:::\n\nLoose text\n\n:::solution{#zzz answer=1}\n:::\n",
        "x.md",
      ),
    ),
    ["x.md:7: Expected a heading or a :::question or :::solution block (put text inside it)"],
  );
  assert.deepEqual(
    issuesOf(() =>
      parseExamFile(
        ":::question{#a type=nat marks=1}\nQ\n:::\n\n:::question{#a type=nat marks=1}\nQ2\n:::\n\n:::solution{#zzz answer=1}\n:::\n",
        "x.md",
      ),
    ),
    ["x.md:5: Duplicate id: a", "x.md:9: No question for solution zzz"],
  );
  assert.deepEqual(
    issuesOf(() =>
      parseExamFile("# Solutions\n\n:::question{#a type=nat marks=1}\nQ\n:::\n", "x.md"),
    ),
    ["x.md:3: Put this question before the # Solutions heading"],
  );
});

test("practice is not part of a paper: it belongs in an .xp file", () => {
  const issues = issuesOf(() =>
    parseExamFile("# Practice\n\n:::question{#a type=nat marks=1}\nQ\n:::\n", "x.xam"),
  );
  assert.equal(issues.length, 1);
  assert.match(issues[0], /^x\.xam:1: Practice questions go in their own \.xp file/);
});

test("the setup becomes the ruleset; sections come from the questions", () => {
  const { exam } = readExamFile(setup, "prob-exam", FILE, "prob.md");
  const r = exam.exam.rules;
  assert.equal(r.meta.name, "Probability");
  assert.equal(r.timing.durationMinutes, 20);
  assert.equal(r.attempts.max, 2);
  assert.equal(r.progression.passPercentage, 60);
  assert.equal(r.tools.calculator, "basic");
  assert.deepEqual(r.questionTypes.mcq?.negativeMarking, { fractionOfMarks: [1, 3] });
  assert.equal(r.results.scoreVisibility, "immediate");
  assert.deepEqual(
    r.sections.map((s) => [s.id, s.questionCount]),
    [
      ["exam", 1],
      ["numbers", 1],
    ],
  );
  // A three-option MCQ is fine: option counts are the author's choice here.
  assert.equal(exam.exam.paper[0].options.length, 3);
});

test("exam keys are sealed in their own blob, without trap tags", async () => {
  const { exam } = readExamFile(setup, "prob-exam", FILE, "prob.md");
  const sealed = await exam.solutionFile!.text();
  assert.doesNotMatch(sealed, /distractor/);
  const { solutions } = importSolutions(exam.exam, sealed);
  assert.deepEqual(
    solutions.map((s) => [s.id, s.answer, s.body]),
    [
      ["q1", "B", "Because two."],
      ["q2", "2.32:2.34", "Seven thirds."],
    ],
  );
});

test("a broken or missing key is caught at upload, not after a timed attempt", () => {
  const missing = FILE.replace(/:::solution\{#q2[\s\S]*?:::\n/, "");
  assert.ok(
    issuesOf(() => readExamFile(setup, "e", missing, "prob.md")).includes(
      "prob.md: Missing solution for q2",
    ),
  );
  const wrong = FILE.replace("{#q1 answer=B}", "{#q1 answer=E}");
  assert.ok(
    issuesOf(() => readExamFile(setup, "e", wrong, "prob.md")).some((i) =>
      i.includes("Invalid option answer"),
    ),
  );
  assert.deepEqual(
    issuesOf(() => readExamFile(setup, "e", "# Exam\n", "prob.md")),
    ["prob.md: No exam questions. Add a :::question block and its :::solution."],
  );
});

test("a paper takes only the images it names", () => {
  const withImages = FILE.replace("Seven thirds.", "See ![b](b.png)");
  const { exam } = readExamFile(setup, "e", withImages, "prob.md", {
    "b.png": new Blob(["png"]),
    "c.png": new Blob(["x"]),
  });
  assert.deepEqual(Object.keys(exam.assets ?? {}), ["b.png"]);
});

test("a configured exam waits for its file, then its exam is open at once", async () => {
  const plan = createExamPlan(setup, 1, "prob");
  assert.equal(hasExamFile(plan), false);
  const content = readExamFile(setup, plan.plan.days[0].examId, FILE, "prob.md");
  const ready = await attachExamFile(plan, content, 2);
  assert.equal(hasExamFile(ready), true);
  await assert.rejects(attachExamFile(ready, content, 3), /already has its file/);
  await assert.rejects(
    attachExamFile(plan, readExamFile(setup, "other", FILE, "prob.md"), 3),
    /different exam/,
  );
  const [p] = studyProgress(ready, []);
  assert.equal(p.status, "ready");
  assert.equal(p.maxAttempts, 2);
  assert.equal(p.passPercentage, 60);
  // Nothing to learn or practise first: the exam starts straight away.
  const attempt = prepareStudyAttempt(ready, "exam", [], 4);
  assert.equal(attempt.exam.id, "prob-exam");
  assert.equal(attempt.session.phase, "instructions");
});

test("deleting a plan removes its attempts and leaves everything else", async () => {
  const keep = createExamPlan(setup, 1, "keep"),
    drop = createExamPlan(setup, 1, "drop");
  await savePlan(keep);
  await savePlan(drop);
  const attempt = (id: string, planId?: string, examId = "lib") =>
    ({
      id,
      exam: {},
      session: { id, examId },
      ...(planId ? { study: { planId, dayId: "exam", cycle: 0, paperFingerprint: "" } } : {}),
    }) as never;
  await saveAttempt(attempt("a-drop", "drop"));
  await saveAttempt(attempt("a-keep", "keep"));
  await saveAttempt(attempt("a-lib"));
  assert.deepEqual(await deleteExamData({ planIds: ["drop"] }), ["a-drop"]);
  assert.deepEqual(
    (await listPlans()).map((p) => p.id),
    ["keep"],
  );
  assert.deepEqual((await listAttempts()).map((a) => a.id).sort(), ["a-keep", "a-lib"]);
  // A library exam's own attempts go with it; study attempts never do.
  assert.deepEqual(await deleteExamData({ examIds: ["lib"] }), ["a-lib"]);
});

test("deleted plans and attempts leave no recovery journal behind", () => {
  const data = new Map<string, string>([
    ["localdox:exam-recovery:plan:drop", "{}"],
    ["localdox:exam-recovery:attempt:a1", "{}"],
    ["localdox:exam-recovery:plan:keep", "{}"],
  ]);
  const store: RecoveryStore = {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
  forgetCheckpoints({ planIds: ["drop"], attemptIds: ["a1"] }, store);
  assert.deepEqual([...data.keys()], ["localdox:exam-recovery:plan:keep"]);
});

test("the bundled example .xrule and .xam are valid together", async () => {
  const { readFile } = await import("node:fs/promises");
  const read = (name: string) => readFile(new URL(`../documentation/plans/${name}`, import.meta.url), "utf8");
  const setup = parseXrule(await read("example.xrule"), "example.xrule");
  assert.equal(setup.preset, "gate");
  assert.equal(setup.durationMinutes, 10);
  const { exam } = readExamFile(setup, "x", await read("example.xam"), "example.xam");
  assert.equal(exam.exam.paper.length, 4);
  assert.equal(exam.exam.rules.progression.passPercentage, 70);
});
