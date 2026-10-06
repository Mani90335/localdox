import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { exam, key } from "./exam-format.test.ts";
import { importSolutions } from "../src/services/exams/validation.ts";
import {
  importStudyPlan,
  studyProgress,
  prepareStudyAttempt,
  assertStudyStart,
  updateStudyTask,
  completeRevision,
  attachRewrite,
  meetsPassingScore,
  paperFingerprint,
} from "../src/services/exams/study-plan.ts";
import type { StudyPlanRecord } from "../src/services/exams/study-plan.ts";
import type { AttemptRecord, ExamRecord } from "../src/services/exams/storage.ts";
import { savePlan, listPlans } from "../src/services/exams/storage.ts";
import {
  startSession,
  setAnswer,
  submitSession,
  beginReflection,
  finishReflection,
} from "../src/services/exams/session.ts";
import { analyzeAttempt } from "../src/services/exams/diagnostics.ts";
const definition = {
  schemaVersion: 1,
  id: "plan",
  name: "My plan",
  days: [
    { id: "day1", title: "Day one", examId: "test", tasks: [{ id: "read", label: "Read lesson" }] },
    { id: "day2", title: "Day two", examId: "test" },
  ],
};
function record(): ExamRecord {
  const e = exam();
  e.rules.attempts.max = 2;
  e.rules.progression = {
    passPercentage: 80,
    rewriteDifficultyPercentage: 50,
    difficultyLabel: "hard",
  };
  return { id: "test", exam: e, solutionFile: new Blob([key]) };
}
const create = () => importStudyPlan(JSON.stringify(definition), [record()], 0);
function take(
  plan: StudyPlanRecord,
  attempts: AttemptRecord[],
  response: string,
  now = 10,
): AttemptRecord {
  const a = prepareStudyAttempt(plan, "day1", attempts, now);
  assertStudyStart(plan, a, attempts);
  const e = a.exam.exam;
  let s = startSession(a.session, e.rules, true, true, now + 1);
  s = setAnswer(s, e.rules, e.paper[0], response, now + 2);
  s = beginReflection(submitSession(s, now + 3), e.rules);
  if (s.phase === "reflection") s = finishReflection(s);
  const solutions = importSolutions(e, key).solutions;
  return { ...a, session: s, analysis: analyzeAttempt(e.rules, e.taxonomy, e.paper, solutions, s) };
}
test("study plan strict import validates dates, references, IDs and finite exam limits", async () => {
  await assert.rejects(importStudyPlan(JSON.stringify({ ...definition, typo: true }), [record()]));
  await assert.rejects(
    importStudyPlan(JSON.stringify({ ...definition, startDate: "2026-02-30" }), [record()]),
  );
  await assert.rejects(importStudyPlan(JSON.stringify(definition), []), /Import exam test/);
  const e = record();
  e.exam.rules.attempts.max = null;
  await assert.rejects(importStudyPlan(JSON.stringify(definition), [e]), /attempts.max/);
  await assert.rejects(
    importStudyPlan(
      JSON.stringify({ ...definition, days: [definition.days[0], definition.days[0]] }),
      [record()],
    ),
    /Duplicate day/,
  );
});
test("topics are independent; checklists never pass an exam; raw score at threshold passes", async () => {
  let p = await create();
  // Learners order topics themselves, and an exam is open from the start.
  assert.equal(studyProgress(p, [])[1].status, "ready");
  assert.equal(prepareStudyAttempt(p, "day2", []).session.phase, "instructions");
  p = updateStudyTask(p, "day1", "read", true, []);
  assert.equal(studyProgress(p, [])[0].completedTasks, 1);
  assert.equal(studyProgress(p, [])[0].status, "ready");
  const a = take(p, [], "A");
  assert.equal(studyProgress(p, [a])[0].status, "passed");
  assert.throws(() => prepareStudyAttempt(p, "day1", [a]), /already passed/);
  assert.equal(studyProgress(p, [a])[1].status, "ready", "other topics are unaffected");
  assert.equal(meetsPassingScore(4, 5, 80), true);
  assert.equal(meetsPassingScore(3.999, 5, 80), false);
  assert.equal(meetsPassingScore(4, 5, 90), false);
});
test("failure, exact MAX_ATTEMPTS boundary, revision and qualifying replacement", async () => {
  let p = await create();
  const a = take(p, [], "B"),
    b = take(p, [a], "B", 20),
    history = [a, b];
  assert.equal(studyProgress(p, [a])[0].status, "failed");
  assert.equal(studyProgress(p, history)[0].status, "revision_required");
  assert.throws(() => prepareStudyAttempt(p, "day1", history), /Attempt limit/);
  const next = record();
  next.exam.paper[0].body = "A new question";
  next.exam.paper[0].difficulty = "hard";
  await assert.rejects(attachRewrite(p, "day1", next, history), /Complete revision/);
  p = completeRevision(p, "day1", history);
  const same = record();
  same.exam.paper[0].difficulty = "hard";
  same.exam.paper[0].id = "renamed";
  await assert.rejects(attachRewrite(p, "day1", same, history), /already used/);
  const easy = structuredClone(next);
  easy.exam.paper[0].difficulty = "easy";
  await assert.rejects(attachRewrite(p, "day1", easy, history), /at least 50%/);
  const weaker = structuredClone(next);
  weaker.exam.rules.progression.passPercentage = 50;
  await assert.rejects(attachRewrite(p, "day1", weaker, history), /retain the original/);
  p = await attachRewrite(p, "day1", next, history);
  assert.equal(studyProgress(p, history)[0].status, "ready");
  assert.equal(studyProgress(p, history)[0].attemptsRemaining, 2);
  assert.equal(studyProgress(p, history)[0].cycle.index, 1);
  const pass = take(p, history, "A", 30);
  assert.equal(studyProgress(p, [...history, pass])[0].status, "passed");
});
test("active attempts and old instructions cannot bypass limits or unlock unrelated plans", async () => {
  const p = await create(),
    a = prepareStudyAttempt(p, "day1", [], 10);
  assert.equal(prepareStudyAttempt(p, "day1", [a]).id, a.id);
  const started = { ...a, session: startSession(a.session, a.exam.exam.rules, true, true, 11) };
  assert.equal(studyProgress(p, [started])[0].status, "in_progress");
  assert.throws(() => assertStudyStart(p, { ...a, id: "another" }, [started]), /current attempt/);
  const passed = take(p, [], "A");
  // Library attempts and demo attempts never pass a topic.
  assert.notEqual(studyProgress(p, [{ ...passed, study: undefined }])[0].status, "passed");
  assert.notEqual(
    studyProgress(p, [{ ...passed, session: { ...passed.session, demo: true } }])[0].status,
    "passed",
  );
});
test("paper fingerprint ignores IDs, ordering, metadata and superficial whitespace", async () => {
  const e = record(),
    q = e.exam.paper[0];
  assert.equal(
    await paperFingerprint([q]),
    await paperFingerprint([
      {
        ...q,
        id: "new",
        difficulty: "hard",
        body: q.body.replaceAll(" ", "  "),
        options: [...q.options].reverse(),
      },
    ]),
  );
});
test("plans and manual progress survive IndexedDB roundtrip", async () => {
  const p = updateStudyTask(await create(), "day1", "read", true, []);
  await savePlan(p);
  const loaded = (await listPlans()).find((r) => r.id === p.id)!;
  assert.equal(loaded.days.day1.tasks.read, true);
});
