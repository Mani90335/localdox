import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fileLabel,
  getDocumentKind,
  isEditableKind,
  isTextKind,
} from "../src/lib/markdown/document-utils.ts";
import {
  DEFAULT_SETUP,
  GATE_RULESET,
  GATE_SETUP,
  readExamFile,
} from "../src/services/exams/exam-setup.ts";
import { ExamImportError } from "../src/services/exams/schema.ts";
import { describeIssue } from "../src/services/exams/ui/display.ts";
import { parseXrule } from "../src/services/exams/xrule.ts";

const xrule = (fields: object) => JSON.stringify({ xrule: 1, name: "Mock 1", ...fields });
function issuesOf(run: () => unknown) {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ExamImportError, String(error));
    return error.issues;
  }
  assert.fail("expected an import error");
}
const XAM = `# Exam

:::question{#q1 type=mcq marks=2}
Pick B.

- a
- b
- c
- d
:::

:::solution{#q1 answer=B}
Because.
:::
`;

test("the reader knows both formats as text it can preview and edit", () => {
  assert.equal(getDocumentKind("paper.xam"), "exam");
  assert.equal(getDocumentKind("RULES.XRULE"), "exam-rules");
  for (const kind of ["exam", "exam-rules"] as const) {
    assert.ok(isTextKind(kind));
    assert.ok(isEditableKind(kind));
  }
  assert.equal(fileLabel("exam"), "Exam questions");
  assert.equal(fileLabel("exam-rules"), "Exam rules");
});

test("a minimal .xrule fills the rest from the defaults", () => {
  const setup = parseXrule(xrule({}));
  assert.deepEqual(setup, { ...DEFAULT_SETUP, name: "Mock 1" });
});

test("plain fields set the common rules", () => {
  const setup = parseXrule(
    xrule({
      summary: "Bayes",
      durationMinutes: 45,
      questionCount: 10,
      passPercentage: 60,
      maxAttempts: 2,
      mcqPenalty: "quarter",
      calculator: "basic",
    }),
  );
  assert.equal(setup.summaryMd, "Bayes");
  assert.equal(setup.durationMinutes, 45);
  assert.equal(setup.questionCount, 10);
  assert.equal(setup.passPercentage, 60);
  assert.equal(setup.maxAttempts, 2);
  assert.equal(setup.mcqPenalty, "quarter");
  assert.equal(setup.calculator, "basic");
  assert.equal(setup.rootRules, undefined);
});

test("a preset starts from its rules; fields override it", () => {
  const setup = parseXrule(xrule({ preset: "gate", durationMinutes: 60 }));
  assert.equal(setup.preset, "gate");
  assert.deepEqual(setup.rootRules, GATE_RULESET);
  assert.equal(setup.questionCount, GATE_SETUP.questionCount);
  assert.equal(setup.durationMinutes, 60);
});

test("a rules block supplies time, pass mark, attempts and count unless fields override", () => {
  const rules = {
    ...GATE_RULESET,
    timing: { ...GATE_RULESET.timing, durationMinutes: 90 },
    progression: { ...GATE_RULESET.progression, passPercentage: 55 },
    attempts: { ...GATE_RULESET.attempts, max: 4 },
    sections: [{ id: "s1", name: "One", questionCount: 12 }],
  };
  const fromRules = parseXrule(xrule({ rules }));
  assert.equal(fromRules.durationMinutes, 90);
  assert.equal(fromRules.passPercentage, 55);
  assert.equal(fromRules.maxAttempts, 4);
  assert.equal(fromRules.questionCount, 12);
  assert.equal(fromRules.rootRules?.sections[0].id, "s1");
  assert.equal(parseXrule(xrule({ rules, maxAttempts: 1 })).maxAttempts, 1);
});

test("contradictions are rejected with the field that causes them", () => {
  const both = issuesOf(() => parseXrule(xrule({ preset: "gate", rules: GATE_RULESET })));
  assert.match(both[0].location, /exam\.xrule\.rules$/);
  const penalty = issuesOf(() => parseXrule(xrule({ preset: "gate", mcqPenalty: "third" })));
  assert.match(penalty[0].location, /mcqPenalty$/);
  assert.match(penalty[0].message, /questionTypes/);
  const tools = issuesOf(() => parseXrule(xrule({ rules: GATE_RULESET, calculator: "none" })));
  assert.match(tools[0].message, /rules\.tools/);
});

test("malformed files explain themselves in plain words", () => {
  assert.match(
    describeIssue(issuesOf(() => parseXrule("{", "mock.xrule"))[0]),
    /^mock\.xrule: This isn't valid JSON/,
  );
  const version = issuesOf(() => parseXrule(JSON.stringify({ name: "x" }), "mock.xrule"));
  assert.equal(describeIssue(version[0]), "mock.xrule: “xrule” must be 1.");
  const typo = issuesOf(() => parseXrule(xrule({ passMark: 50 }), "mock.xrule"));
  assert.match(describeIssue(typo[0]), /Unknown field passMark/);
  const range = issuesOf(() => parseXrule(xrule({ maxAttempts: 0 }), "mock.xrule"));
  assert.match(range[0].location, /maxAttempts$/);
});

test("an .xrule and its .xam make a runnable exam", () => {
  const setup = parseXrule(xrule({ questionCount: 1, passPercentage: 50 }));
  const { exam } = readExamFile(setup, "mock-1", XAM, "mock-1.xam");
  assert.equal(exam.exam.paper.length, 1);
  assert.equal(exam.exam.rules.progression.passPercentage, 50);
  const wrongCount = issuesOf(() =>
    readExamFile(parseXrule(xrule({ questionCount: 3 })), "mock-1", XAM, "mock-1.xam"),
  );
  assert.match(wrongCount[0].message, /Expected 3 exam questions, found 1/);
});
