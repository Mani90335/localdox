import { test } from "node:test";
import assert from "node:assert/strict";
import { exam, key } from "./exam-format.test.ts";
import { importSolutions } from "../src/services/exams/validation.ts";
import { defaultRules, resolvedRules } from "../src/services/exams/default-rules.ts";
import { evaluate, analyzeAttempt, weaknessProfile } from "../src/services/exams/diagnostics.ts";
import {
  createSession,
  showInstructions,
  startSession,
  setAnswer,
  submitSession,
  beginReflection,
  finishReflection,
} from "../src/services/exams/session.ts";
const scenarios: Record<
  string,
  [Record<string, string | number | boolean>, Record<string, string | number | boolean>]
> = {
  slow_on_easy: [{ difficulty: "easy", timeRatio: 1.5 }, { timeRatio: 1.49 }],
  stuck_on_hard: [{ difficulty: "hard", timeRatio: 2, outcome: "wrong" }, { outcome: "correct" }],
  rushed_wrong: [{ timeRatio: 0.4, outcome: "wrong" }, { timeRatio: 0.41 }],
  overconfident_wrong: [{ confidence: "sure", outcome: "wrong" }, { confidence: "unsure" }],
  lucky_guess: [{ confidence: "guess", outcome: "correct" }, { outcome: "wrong" }],
  underconfident_right: [
    { confidence: "unsure", outcome: "correct", difficulty: "easy" },
    { difficulty: "hard" },
  ],
  unjustified_guess_penalty: [
    { confidence: "guess", outcome: "wrong", negativeMarksTaken: 0.5 },
    { negativeMarksTaken: 0 },
  ],
  fell_for_trap: [{ selectedTrap: "sign" }, { selectedTrap: "none" }],
  changed_right_to_wrong: [{ changedCorrectToWrong: true }, { changedCorrectToWrong: false }],
  skipped_easy: [{ difficulty: "easy", outcome: "unanswered" }, { difficulty: "hard" }],
  late_collapse: [{ accuracyDrop: 20 }, { accuracyDrop: 19.99 }],
  guess_bleed: [{ guessPenaltyMarks: 3 }, { guessPenaltyMarks: 2.99 }],
};
for (const rule of defaultRules)
  test(`default rule ${rule.id}: trigger and near miss`, () => {
    const [signals, miss] = scenarios[rule.id];
    assert.equal(evaluate(rule.when, signals), true);
    assert.equal(evaluate(rule.when, { ...signals, ...miss }), false);
  });
test("DSL all, any, not, membership and comparison", () => {
  assert.ok(
    evaluate(
      {
        all: [
          { not: { signal: "a", op: "in", value: [2, 3] } },
          {
            any: [
              { signal: "a", op: ">", value: 0 },
              { signal: "a", op: "==", value: 0 },
            ],
          },
        ],
      },
      { a: 1 },
    ),
  );
  assert.ok(evaluate({ signal: "a", op: "not_in", value: [2] }, { a: 1 }));
});
test("custom overrides, disabled rules and pacing thresholds", () => {
  const r = exam().rules;
  r.diagnostics.rules = [{ ...defaultRules[0], label: "Override" }];
  assert.equal(resolvedRules(r).find((v) => v.id === "slow_on_easy")?.label, "Override");
  r.diagnostics.disabledRules = ["slow_on_easy"];
  assert.ok(!resolvedRules(r).some((v) => v.id === "slow_on_easy"));
  r.diagnostics.pacing.fastRatio = 0.1;
  assert.equal(
    evaluate(resolvedRules(r).find((v) => v.id === "rushed_wrong")!.when, {
      timeRatio: 0.2,
      outcome: "wrong",
    }),
    false,
  );
});
function analysis(response = "B", confidence: "sure" | "guess" | "unsure" = "sure") {
  const e = exam();
  let s = startSession(
    showInstructions(createSession(e.rules, e.paper, e.taxonomy.id, 0)),
    e.rules,
    true,
    true,
    0,
  );
  s = setAnswer(s, e.rules, e.paper[0], "A", 1000);
  s = setAnswer(s, e.rules, e.paper[0], response, 2000);
  s = finishReflection(beginReflection(submitSession(s, 10000), e.rules));
  s.confidence.q1 = confidence;
  return { e, s, solutions: importSolutions(e, key).solutions };
}
test("attribution priority, trap taxonomy cause, changes and conservation", () => {
  const { e, s, solutions } = analysis();
  let a = analyzeAttempt(e.rules, e.taxonomy, e.paper, solutions, s);
  assert.equal(a.questions[0].primaryCause, "overconfidence");
  assert.equal(a.questions[0].flags.find((f) => f.ruleId === "fell_for_trap")?.cause, "careless");
  assert.equal(a.questions[0].signals.changedCorrectToWrong, true);
  assert.equal(
    Object.values(a.marksLostByCause).reduce((a, b) => a + b, 0),
    a.marksLost,
  );
  e.rules.diagnostics.causePriority = ["careless", "overconfidence"];
  a = analyzeAttempt(e.rules, e.taxonomy, e.paper, solutions, s);
  assert.equal(a.questions[0].primaryCause, "careless");
});
test("wrong to correct and fallback", () => {
  const { e, s, solutions } = analysis();
  s.events = s.events.map((ev) =>
    ev.type === "answer_set"
      ? {
          ...ev,
          value: ev.value === "A" ? "B" : "A",
          previous: ev.previous === "A" ? "B" : ev.previous,
        }
      : ev,
  );
  assert.equal(
    analyzeAttempt(e.rules, e.taxonomy, e.paper, solutions, s).questions[0].signals
      .changedWrongToCorrect,
    true,
  );
  e.rules.diagnostics.disabledRules = defaultRules.map((r) => r.id);
  s.events = s.events.filter((e) => e.type !== "answer_set");
  assert.equal(
    analyzeAttempt(e.rules, e.taxonomy, e.paper, solutions, s).questions[0].primaryCause,
    "concept_gap",
  );
});
test("noise threshold exempts severity 3; self reports are separate; persistence crosses exams", () => {
  const { e, s, solutions } = analysis();
  e.rules.diagnostics.report.minEvidenceQuestions = 5;
  s.journal.q1 = { cause: "concept_gap", trap: "sign", note: "Review sign" };
  const a = analyzeAttempt(e.rules, e.taxonomy, e.paper, solutions, s);
  assert.ok(a.weaknesses.every((w) => w.severity === 3));
  assert.ok(a.traps.some((t) => t.selfReported));
  const b = { ...a, sessionId: "second", examId: "another", at: a.at + 1 };
  const profile = weaknessProfile([a, b], e.taxonomy.id, 2);
  assert.ok(profile.weaknesses.some((w) => w.persistent));
  assert.equal(
    weaknessProfile([a, { ...b, taxonomyId: "different" }], e.taxonomy.id, 2).weaknesses[0]
      .persistent,
    false,
  );
  assert.equal(weaknessProfile([{ ...a, demo: true }], e.taxonomy.id).attemptCount, 0);
});
