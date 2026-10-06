import { test } from "node:test";
import assert from "node:assert/strict";
import { practiceRulesSchema } from "../src/services/exams/practice-rules.ts";
import { xruleSchema, parseXrule } from "../src/services/exams/xrule.ts";
import { practiceXruleTemplate, XP_TEMPLATE } from "../src/services/exams/templates.ts";
import { readPracticeFile } from "../src/services/exams/practice.ts";
import { withRulesTag, withoutRulesTag } from "../src/services/exams/rules-tag.ts";
import {
  clearPracticeProgress,
  loadPracticeAnswers,
  loadPracticeTime,
  practiceGeneration,
  practiceSignature,
  savePracticeAnswers,
  savePracticeTime,
} from "../src/services/exams/practice-progress.ts";

test("practice rules have safe defaults and reject invalid deadlines and unknown controls", () => {
  assert.deepEqual(practiceRulesSchema.parse({}), {
    questionTimeLimitSeconds: null,
    showElapsedTime: true,
    allowSkip: true,
  });
  for (const seconds of [0, -1, 1.5, 36001, "60", Infinity])
    assert.equal(
      practiceRulesSchema.safeParse({ questionTimeLimitSeconds: seconds }).success,
      false,
    );
  assert.equal(practiceRulesSchema.safeParse({ revealAll: true }).success, false);
  const file = xruleSchema.parse(JSON.parse(practiceXruleTemplate("Timed drill")));
  assert.equal(file.name, "Timed drill");
  assert.equal(file.practice?.questionTimeLimitSeconds, null);
  assert.equal(parseXrule(JSON.stringify({ ...file, durationMinutes: 5 })).durationMinutes, 5);
});

test("practice rules headers preserve content and source locations, and malformed links fail", () => {
  const original = readPracticeFile(XP_TEMPLATE);
  const tagged = withRulesTag(XP_TEMPLATE, "Practice.xrule");
  const sheet = readPracticeFile(tagged);
  assert.deepEqual(
    sheet.questions.map((q) => q.id),
    original.questions.map((q) => q.id),
  );
  assert.equal(sheet.questions[0].body, original.questions[0].body);
  assert.equal(withoutRulesTag(tagged), XP_TEMPLATE);
  assert.throws(
    () => readPracticeFile(withRulesTag(XP_TEMPLATE, "wrong.txt")),
    /rules must name an .xrule file/,
  );
  assert.throws(
    () => readPracticeFile(`---\nrulse: practice.xrule\n---\n${XP_TEMPLATE}`),
    /Unknown header field/,
  );
});

test("browser-only progress guards corrupt values, isolates files, and ignores obsolete timer writes after reset", () => {
  const data = new Map<string, string>();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    },
  });
  try {
    const fileId = "test";
    data.set(
      "localdox:practice-answers:test",
      JSON.stringify({
        bad: { sig: "a", outcome: "anything", response: [1] },
        okay: {
          sig: "b",
          outcome: "unanswered",
          response: null,
          reason: "timeout",
          elapsedMs: 5000,
        },
      }),
    );
    assert.deepEqual(Object.keys(loadPracticeAnswers(fileId)), ["okay"]);
    savePracticeAnswers("other", {
      q: { sig: "s", outcome: "correct", response: "A", elapsedMs: 20 },
    });
    savePracticeTime(fileId, "q", "sig", 1200);
    assert.equal(loadPracticeTime(fileId, "q", "sig"), 1200);
    assert.equal(loadPracticeTime(fileId, "q", "edited"), 0);
    const generation = practiceGeneration(fileId);
    clearPracticeProgress(fileId);
    savePracticeTime(fileId, "q", "sig", 1300, generation);
    assert.equal(loadPracticeTime(fileId, "q", "sig"), 0);
    assert.deepEqual(loadPracticeAnswers(fileId), {});
    assert.equal(loadPracticeAnswers("other").q.elapsedMs, 20);
    data.set("localdox:practice-answers:test", "{broken");
    assert.deepEqual(loadPracticeAnswers(fileId), {});
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("Blocked");
      },
    });
    assert.deepEqual(loadPracticeAnswers(fileId), {});
    assert.doesNotThrow(() => savePracticeTime(fileId, "q", "sig", 2000));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("question and answer-key edits invalidate old practice progress", () => {
  const sheet = readPracticeFile(XP_TEMPLATE);
  const q = sheet.questions[0],
    s = sheet.solutionFor[q.id];
  assert.notEqual(practiceSignature(q, s), practiceSignature({ ...q, body: "Changed" }, s));
  assert.notEqual(practiceSignature(q, s), practiceSignature(q, { ...s, answer: "A" }));
});
