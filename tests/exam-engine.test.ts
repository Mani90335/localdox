import { test } from "node:test";
import assert from "node:assert/strict";
import { exam, rules, paper, key } from "./exam-format.test.ts";
import { importExam, importSolutions } from "../src/services/exams/validation.ts";
import { scoreQuestion } from "../src/services/exams/scoring.ts";
import {
  createSession,
  showInstructions,
  startSession,
  setAnswer,
  submitSession,
  tick,
  resumeSession,
  recordIntegrity,
  focusedSeconds,
  navigate,
  markQuestion,
  pauseSession,
  remainingSeconds,
  beginReflection,
  finishReflection,
  openReview,
} from "../src/services/exams/session.ts";
const start = (e = exam()) =>
  startSession(
    showInstructions(createSession(e.rules, e.paper, e.taxonomy.id, 0)),
    e.rules,
    true,
    true,
    0,
  );
test("MCQ fractional negative marking, unanswered and review policy", () => {
  const e = exam(),
    q = e.paper[0],
    s = importSolutions(e, key).solutions[0];
  e.rules.questionTypes.mcq!.negativeMarking = { fractionOfMarks: [1, 3] };
  assert.equal(scoreQuestion(e.rules, q, s, "B").score, -2 / 3);
  assert.equal(scoreQuestion(e.rules, q, s, null).score, 0);
  assert.equal(scoreQuestion(e.rules, q, s, "A").score, 2);
  e.rules.navigation.markedForReviewAnswerCounts = false;
  assert.equal(scoreQuestion(e.rules, q, s, "A", true).score, 0);
});
test("MSQ all-or-nothing and partial-no-wrong", () => {
  const e = exam(),
    q = { ...e.paper[0], type: "msq" as const },
    s = { ...importSolutions(e, key).solutions[0], answer: "A,B" };
  e.rules.questionTypes.msq = {
    selection: "multiple",
    scoring: "all_or_nothing",
    negativeMarking: null,
  };
  assert.equal(scoreQuestion(e.rules, q, s, ["A"]).score, 0);
  e.rules.questionTypes.msq.scoring = "partial_no_wrong";
  assert.equal(scoreQuestion(e.rules, q, s, ["A"]).score, 1);
  assert.equal(scoreQuestion(e.rules, q, s, ["A", "C"]).score, 0);
  assert.equal(scoreQuestion(e.rules, q, s, ["A", "B"]).score, 2);
});
test("NAT exact, tolerance, inclusive range, zero and invalid values", () => {
  const e = exam(),
    q = { ...e.paper[0], type: "nat" as const },
    base = importSolutions(e, key).solutions[0];
  for (const [s, v, score] of [
    [{ answer: "0" }, "0", 2],
    [{ answer: "2.4", tolerance: 0.01 }, "2.41", 2],
    [{ answer: "2.3:2.5" }, "2.5", 2],
    [{ answer: "2.3:2.5" }, "2.51", 0],
    [{ answer: "2.4" }, "NaN", 0],
  ] as const)
    assert.equal(scoreQuestion(e.rules, q, { ...base, ...s }, v).score, score);
});
test("reload preserves deadline and auto-submits at expiry", () => {
  const e = exam(),
    s = start(e);
  const restored = resumeSession(JSON.parse(JSON.stringify(s)), e.rules, e.paper, 120000);
  assert.equal(remainingSeconds(restored, 120000), 480);
  const expired = tick(restored, e.rules, e.paper, 700000);
  assert.equal(expired.phase, "submitting");
  assert.equal(expired.submittedAt, 600000);
  assert.equal(expired.events.at(-1)?.type, "submitted");
});
test("focused time excludes hidden intervals and stops after submit", () => {
  const e = exam();
  let s = start(e);
  s = recordIntegrity(s, e.rules, "tab_hidden", 10000);
  s = recordIntegrity(s, e.rules, "tab_visible", 50000);
  s = submitSession(s, 60000);
  assert.equal(focusedSeconds(s).q1, 20);
});
test("events preserve previous answers; rules enforce navigation, marking, clearing, pause", () => {
  const e = exam();
  let s = start(e);
  s = setAnswer(s, e.rules, e.paper[0], "A", 1000);
  s = setAnswer(s, e.rules, e.paper[0], "B", 2000);
  assert.equal(s.events.at(-1)?.previous, "A");
  assert.throws(() => navigate(s, e.rules, e.paper, "missing", 3000));
  assert.throws(() => pauseSession(s, e.rules, 3000));
  e.rules.navigation.markForReview = false;
  assert.throws(() => markQuestion(s, e.rules, true, 3000));
  e.rules.navigation.clearResponse = false;
  assert.throws(() => setAnswer(s, e.rules, e.paper[0], null, 3000));
});
test("per-section timers expire through closed-app time and lock previous sections", () => {
  const e = importExam(
    JSON.stringify({
      ...rules,
      timing: { mode: "per_section", durationMinutes: 10 },
      sections: [
        { id: "a", name: "A", questionCount: 1, durationMinutes: 4 },
        { id: "b", name: "B", questionCount: 1, durationMinutes: 6 },
      ],
    }),
    paper + "\n\n" + paper.replace("#q1", "#q2").replace("section=a", "section=b"),
  );
  let s = start(e);
  s = tick(s, e.rules, e.paper, 300000);
  assert.equal(s.currentId, "q2");
  assert.equal(s.deadlineAt, 600000);
  assert.throws(() => navigate(s, e.rules, e.paper, "q1", 301000));
  assert.equal(tick(s, e.rules, e.paper, 700000).phase, "submitting");
});
test("full state machine requires submission before reflection and review", () => {
  const e = exam();
  let s = start(e);
  assert.throws(() => beginReflection(s, e.rules));
  s = submitSession(s, 10000);
  s = beginReflection(s, e.rules);
  assert.equal(s.phase, "reflection");
  s = finishReflection(s);
  assert.equal(openReview(s, e.rules).phase, "review");
});

test("expiry without automatic submission locks answers and stops focused time", () => {
  const e = exam();
  e.rules.timing.autoSubmitOnExpiry = false;
  let s = tick(start(e), e.rules, e.paper, 700000);
  assert.equal(s.phase, "in_progress");
  assert.throws(() => setAnswer(s, e.rules, e.paper[0], "A", 700000), /expired/);
  s = submitSession(s, 800000);
  assert.equal(focusedSeconds(s).q1, 600);
});
test("duplicate hidden events do not double-count integrity violations", () => {
  const e = exam();
  e.rules.integrity.maxTabSwitches = 1;
  e.rules.integrity.onViolation = "warn_then_autosubmit";
  let s = recordIntegrity(start(e), e.rules, "tab_hidden", 1000);
  s = recordIntegrity(s, e.rules, "tab_hidden", 2000);
  assert.equal(s.violations, 1);
  s = recordIntegrity(s, e.rules, "tab_visible", 3000);
  s = recordIntegrity(s, e.rules, "tab_hidden", 4000);
  assert.equal(s.phase, "submitting");
  assert.equal(s.violations, 2);
});
test("interrupted focus is bounded by last persisted observation", () => {
  const e = exam();
  let s = { ...start(e), lastObservedAt: 10000 };
  s = resumeSession(s, e.rules, e.paper, 50000);
  s = recordIntegrity(s, e.rules, "tab_visible", 50000);
  s = submitSession(s, 60000);
  assert.equal(focusedSeconds(s).q1, 20);
});
