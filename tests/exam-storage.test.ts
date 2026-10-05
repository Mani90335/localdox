import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { importExam, importSolutions } from "../src/services/exams/validation.ts";
import {
  listAttempts,
  saveAttempt,
  loadSolutions,
  type ExamRecord,
} from "../src/services/exams/storage.ts";
import {
  createSession,
  showInstructions,
  startSession,
  submitSession,
  resumeSession,
} from "../src/services/exams/session.ts";
import type { Session } from "../src/services/exams/session.ts";
import { analyzeAttempt } from "../src/services/exams/diagnostics.ts";
import { defaultRules } from "../src/services/exams/default-rules.ts";
import { calculate } from "../src/services/exams/calculator.ts";
const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const sample = () =>
  importExam(
    read("exams/gate-2027-da/gate2027da.exam.json"),
    read("exams/gate-2027-da/gate2027da.paper.md"),
    read("exams/taxonomies/gate-da.taxonomy.json"),
  );
test("bundled exams validate and seeded session triggers every default rule", () => {
  const e = sample(),
    solutions = importSolutions(e, read("exams/gate-2027-da/gate2027da.solutions.md")).solutions,
    s = JSON.parse(read("exams/gate-2027-da/demo-session.json")) as Session,
    a = analyzeAttempt(e.rules, e.taxonomy, e.paper, solutions, s);
  assert.deepEqual(new Set(a.rules.map((r) => r.id)), new Set(defaultRules.map((r) => r.id)));
  assert.ok(
    Math.abs(Object.values(a.marksLostByCause).reduce((a, b) => a + b, 0) - a.marksLost) < 1e-9,
  );
  const quiz = importExam(
    read("exams/section-quiz/quiz.exam.json"),
    read("exams/section-quiz/quiz.paper.md"),
    read("exams/taxonomies/reasoning.taxonomy.json"),
  );
  assert.equal(
    importSolutions(quiz, read("exams/section-quiz/quiz.solutions.md")).solutions.length,
    2,
  );
});
test("sealed key never invokes Blob.text before submission", async () => {
  const e = sample();
  let reads = 0;
  const file = new Blob();
  file.text = async () => {
    reads++;
    return read("exams/gate-2027-da/gate2027da.solutions.md");
  };
  const record: ExamRecord = { id: e.rules.meta.id, exam: e, solutionFile: file };
  let s = startSession(
    showInstructions(createSession(e.rules, e.paper, e.taxonomy.id, 100)),
    e.rules,
    true,
    true,
    100,
  );
  await assert.rejects(loadSolutions(record, s), /sealed/);
  assert.equal(reads, 0);
  s = submitSession(s, 1000);
  assert.equal((await loadSolutions(record, s)).solutions.length, 12);
  assert.equal(reads, 1);
});
test("IndexedDB preserves full session and deadline across reads", async () => {
  const e = sample(),
    s = startSession(
      showInstructions(createSession(e.rules, e.paper, e.taxonomy.id, 1000)),
      e.rules,
      true,
      true,
      1000,
    ),
    record = { id: s.id, exam: { id: e.rules.meta.id, exam: e }, session: s };
  await saveAttempt(record);
  const stored = (await listAttempts()).find((a) => a.id === s.id)!;
  assert.deepEqual(stored.session, s);
  assert.equal(
    resumeSession(stored.session, e.rules, e.paper, s.deadlineAt! + 1).phase,
    "submitting",
  );
});
test("safe scientific calculator supports precedence and rejects code", () => {
  assert.equal(calculate("2+3*4"), 14);
  assert.equal(calculate("-2^2"), -4);
  assert.equal(calculate("2^3^2"), 512);
  assert.equal(calculate("sqrt(9)+5!"), 123);
  assert.ok(Math.abs(calculate("sin(pi/2)") - 1) < 1e-10);
  for (const input of ["alert(1)", "globalThis", "1/0", "2;3", "constructor(1)", "(-1)!"])
    assert.throws(() => calculate(input));
});
