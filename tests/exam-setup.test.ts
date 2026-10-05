import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { parseExamFile } from "../src/services/exams/parser.ts";
import { ExamImportError } from "../src/services/exams/schema.ts";
import {
  DEFAULT_SETUP,
  readExamFile,
  readPracticeFile,
  type ExamSetup,
} from "../src/services/exams/exam-setup.ts";
import { importSolutions } from "../src/services/exams/validation.ts";
import {
  attachExamFile,
  createExamPlan,
  hasExamFile,
  markLearned,
  answerPractice,
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
const FILE = `# Practice

:::question{#p1 type=mcq marks=1}
Practice question?

- Right
- Wrong
:::

:::solution{#p1 answer=A}
Practice explanation.
:::

# Exam

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

test("one file splits into practice and exam; solutions are matched by id", () => {
  const { practice, exam } = parseExamFile(FILE, "prob.md");
  assert.deepEqual(
    practice.questions.map((q) => q.id),
    ["p1"],
  );
  assert.deepEqual(
    exam.questions.map((q) => [q.id, q.section]),
    [
      ["q1", "exam"],
      ["q2", "numbers"],
    ],
  );
  assert.deepEqual(
    exam.solutions.map((s) => s.id),
    ["q1", "q2"],
  );
  assert.deepEqual(
    practice.solutions.map((s) => s.id),
    ["p1"],
  );
});

test("structure errors name the file and line", () => {
  assert.deepEqual(
    issuesOf(() => parseExamFile("# Intro\n\n:::question{#a type=nat marks=1}\nQ\n:::\n", "x.md")),
    [
      'x.md:1: Unknown heading "Intro". Use # Practice, # Exam or # Solutions',
      "x.md:3: Put this question under a # Practice or # Exam heading",
    ],
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
        "# Practice\n\n:::question{#a type=nat marks=1}\nQ\n:::\n\n# Exam\n\n:::question{#a type=nat marks=1}\nQ2\n:::\n\n:::solution{#zzz answer=1}\n:::\n",
        "x.md",
      ),
    ),
    ["x.md:9: Duplicate id: a", "x.md:13: No question for solution zzz"],
  );
});

test("the setup becomes the ruleset; sections come from the questions", () => {
  const { exam, practice } = readExamFile(setup, "prob-exam", FILE, "prob.md");
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
  assert.equal(practice?.questions.length, 1);
});

test("exam keys are sealed in their own blob, without practice keys or trap tags", async () => {
  const { exam } = readExamFile(setup, "prob-exam", FILE, "prob.md");
  const sealed = await exam.solutionFile!.text();
  assert.doesNotMatch(sealed, /p1|Practice explanation|distractor/);
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
    issuesOf(() => readExamFile(setup, "e", "# Practice\n", "prob.md")),
    ["prob.md: No exam questions. Add them under a # Exam heading."],
  );
});

test("images go with the part that names them", () => {
  const withImages = FILE.replace("Practice question?", "Practice ![a](a.svg)").replace(
    "Seven thirds.",
    "See ![b](b.png)",
  );
  const a = new Blob(["<svg/>"]),
    b = new Blob(["png"]),
    unused = new Blob(["x"]);
  const { exam, practice } = readExamFile(setup, "e", withImages, "prob.md", {
    "a.svg": a,
    "b.png": b,
    "c.png": unused,
  });
  assert.deepEqual(Object.keys(exam.assets ?? {}), ["b.png"]);
  assert.deepEqual(Object.keys(practice?.assets ?? {}), ["a.svg"]);
});

test("a configured exam waits for its file, then runs the four steps", async () => {
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
  let [p] = studyProgress(ready, []);
  assert.equal(p.step, "learn");
  assert.equal(p.maxAttempts, 2);
  assert.equal(p.passPercentage, 60);
  assert.equal(p.practiceTotal, 1);
  let next = markLearned(ready, "exam", [], 4);
  next = answerPractice(next, "exam", content.practice!.id, "p1", "A", [], 5);
  [p] = studyProgress(next, []);
  assert.equal(p.step, "exam");
  const attempt = prepareStudyAttempt(next, "exam", [], 6);
  assert.equal(attempt.exam.id, "prob-exam");
});

test("practice may not repeat an exam question", async () => {
  const repeated = FILE.replace("Practice question?", "Three options?");
  const plan = createExamPlan(setup, 1, "prob");
  await assert.rejects(
    attachExamFile(plan, readExamFile(setup, "prob-exam", repeated, "prob.md")),
    /repeats a question/,
  );
});

test("Add questions takes a practice-only file", () => {
  const set = readPracticeFile("extra", FILE.slice(0, FILE.indexOf("# Exam")), "extra.md");
  assert.equal(set.questions.length, 1);
  assert.throws(() => readPracticeFile("extra", FILE, "extra.md"), /exam questions/);
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

test("the bundled example file is valid", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../plans/example-exam.md", import.meta.url), "utf8");
  const { exam, practice } = readExamFile({ ...DEFAULT_SETUP, name: "Example" }, "x", source);
  assert.equal(exam.exam.paper.length, 4);
  assert.equal(practice?.questions.length, 3);
});
