import { test } from "node:test";
import assert from "node:assert/strict";
import { rulesetSchema } from "../src/services/exams/schema.ts";
import {
  createSession,
  showInstructions,
  startSession,
  navigate,
  setAnswer,
  markQuestion,
} from "../src/services/exams/session.ts";
import type { Question } from "../src/services/exams/parser.ts";
import {
  formatDateTime,
  formatDuration,
  formatClock,
  formatPercent,
  humanizeId,
  usableThresholds,
  timerTone,
  crossedThreshold,
  marksLabel,
  markingCards,
  ruleSentences,
  violationCopy,
  statusCounts,
  examKind,
  formatKey,
  groupByFormat,
  uiProfile,
} from "../src/services/exams/ui/display.ts";

const rules = (extra: Record<string, unknown> = {}) =>
  rulesetSchema.parse({
    schemaVersion: 2,
    meta: { id: "t", name: "T", version: "1" },
    timing: { mode: "global", durationMinutes: 10 },
    sections: [{ id: "a", name: "A", questionCount: 3 }],
    questionTypes: { mcq: { negativeMarking: { fractionOfMarks: [1, 3] } }, nat: {} },
    ...extra,
  });
const q = (id: string, type: "mcq" | "nat", marks: number): Question => ({
  id,
  section: "a",
  type,
  marks,
  tags: [],
  body: "",
  options: type === "mcq" ? ["x", "y", "z", "w"] : [],
  location: id,
});

test("dates read as Today / Yesterday / '5 Oct 2026, 6:57 pm'", () => {
  const now = new Date(2026, 9, 5, 20, 0).getTime();
  assert.equal(formatDateTime(new Date(2026, 9, 5, 18, 57).getTime(), now), "Today, 6:57 pm");
  assert.equal(formatDateTime(new Date(2026, 9, 4, 0, 5).getTime(), now), "Yesterday, 12:05 am");
  assert.equal(formatDateTime(new Date(2026, 8, 5, 12, 0).getTime(), now), "5 Sep 2026, 12:00 pm");
});

test("durations, clock and percentages", () => {
  assert.equal(formatDuration(32.76), "33s");
  assert.equal(formatDuration(245), "4m 5s");
  assert.equal(formatDuration(720), "12m");
  assert.equal(formatDuration(4800), "1h 20m");
  assert.equal(formatDuration(10800), "3h");
  assert.equal(formatClock(3599.9), "00:59:59");
  // Never round a failing 79.6% up to the 80% gate.
  assert.equal(formatPercent(79.6), "79%");
  assert.equal(formatPercent(80), "80%");
  assert.equal(humanizeId("gate-da"), "Gate DA");
  assert.equal(humanizeId("reasoning"), "Reasoning");
});

test("a threshold at or above the clock length never fires", () => {
  const r = rules({
    timing: { mode: "global", durationMinutes: 10, warnAtMinutesLeft: [10, 5, 1] },
  });
  assert.deepEqual(usableThresholds(r, 0), [5, 1]);
  assert.equal(crossedThreshold(r, 0, 600), null);
  assert.equal(timerTone(r, 0, 600), "normal");
  assert.equal(crossedThreshold(r, 0, 299), 5);
  assert.equal(crossedThreshold(r, 0, 280), null, "notice is brief, timer colour persists");
  assert.equal(timerTone(r, 0, 280), "warning");
  assert.equal(timerTone(r, 0, 59), "danger");
  assert.equal(crossedThreshold(r, 0, 55), 1);
});

test("per-section clocks use the section length", () => {
  const r = rules({
    timing: { mode: "per_section", durationMinutes: 10, warnAtMinutesLeft: [10, 1] },
    sections: [{ id: "a", name: "A", questionCount: 1, durationMinutes: 5 }],
  });
  assert.deepEqual(usableThresholds(r, 0), [1]);
});

test("marking copy is plain and precise", () => {
  const r = rules();
  assert.equal(marksLabel(r, "mcq", 2), "+2 / −0.67");
  assert.equal(marksLabel(r, "nat", 2), "+2");
  const cards = markingCards(r, [q("1", "mcq", 2), q("2", "nat", 1)]);
  assert.equal(cards[0].example, "2 marks: wrong answer costs 0.67");
  assert.match(cards[0].rule, /1\/3 of its marks/);
  assert.match(cards[1].rule, /No negative marking/);
});

test("integrity rules are sentences, not config", () => {
  const r = rules({
    integrity: { requireFullscreen: true, maxTabSwitches: 3, onViolation: "warn_then_autosubmit" },
  });
  assert.equal(
    ruleSentences(r)[0],
    "Leaving fullscreen or switching tabs more than 3 times submits your exam.",
  );
  assert.equal(violationCopy(r, 1), "Warning 1 of 3: stay in fullscreen.");
});

test("status counts partition answered / not answered / not visited", () => {
  const r = rules(),
    paper = [q("1", "mcq", 1), q("2", "mcq", 1), q("3", "mcq", 1)];
  let s = startSession(showInstructions(createSession(r, paper, "t", 0)), r, true, true, 0);
  s = setAnswer(s, r, paper[0], "A", 1);
  s = markQuestion(s, r, true, 2);
  s = navigate(s, r, paper, "2", 3);
  s = markQuestion(s, r, true, 4);
  const c = statusCounts(s, s.order);
  assert.deepEqual(c, { answered: 1, notAnswered: 1, marked: 2, notVisited: 1, total: 3 });
});

test("kinds, version grouping, pacing tags and profiles", () => {
  assert.equal(examKind(rules()), "quiz");
  assert.equal(examKind(rules({ ui: { kind: "full" } })), "full");
  const a = rules(),
    b = rules({ meta: { id: "t2", name: "T new paper", version: "1" } }),
    c = rules({ timing: { mode: "global", durationMinutes: 20 } });
  const groups = groupByFormat([a, b, c], (r) => formatKey(r, "tax"));
  assert.deepEqual(
    groups.map((g) => g.length),
    [2, 1],
  );
  assert.equal(uiProfile(a).id, "gate");
  // Attempts stored before `ui` existed still render.
  assert.equal(uiProfile({ ...a, ui: undefined } as never).id, "gate");
});

test("a short sample can run on a proportionally scaled clock", async () => {
  const { sampleScale } = await import("../src/services/exams/ui/display.ts");
  const gate = rules({
      timing: { mode: "global", durationMinutes: 180 },
      sections: [{ id: "a", name: "A", questionCount: 65 }],
      sampleMode: true,
    }),
    paper = Array.from({ length: 12 }, (_, i) => q(String(i), "mcq", 1));
  // 12 of 65 questions → 33 whole minutes of the 180.
  assert.equal(sampleScale(gate, paper) * 180, 33);
  const r = rules({ sections: [{ id: "a", name: "A", questionCount: 65 }], sampleMode: true });
  const s = createSession(r, paper, "t", 0);
  const scaled = startSession(showInstructions({ ...s, timeScale: 0.5 }), r, true, true, 0);
  assert.equal(scaled.deadlineAt, 0.5 * 10 * 60000);
  const full = startSession(showInstructions(s), r, true, true, 0);
  assert.equal(full.deadlineAt, 10 * 60000, "no scale means the official time");
  assert.throws(() => startSession(showInstructions({ ...s, timeScale: 2 }), r, true, true, 0));
});

test("import errors read as plain sentences with file and line", async () => {
  const { describeIssue, describeImportIssues } =
    await import("../src/services/exams/ui/display.ts");
  assert.equal(
    describeIssue({ severity: "error", location: "invalid.exam.json.meta", message: "Required" }),
    "invalid.exam.json: “meta” is missing.",
  );
  assert.equal(
    describeIssue({
      severity: "error",
      location: "invalid.exam.json.",
      message: "Unrecognized key(s) in object: 'typo'",
    }),
    "invalid.exam.json: Unknown field typo. Check the spelling, or remove it.",
  );
  assert.equal(
    describeIssue({
      severity: "error",
      location: "plan.json.days.0.title",
      message: "Expected string, received number",
    }),
    "plan.json: “days[0].title” should be a string, not number.",
  );
  assert.equal(
    describeIssue({ severity: "error", location: "paper.md:12", message: "Unclosed directive" }),
    "paper.md, line 12: A ::: block is not closed. Add a line with just ::: after it.",
  );
  const text = describeImportIssues([
    { severity: "error", location: "a.exam.json.meta", message: "Required" },
    { severity: "warning", location: "x", message: "ignored" },
  ]);
  assert.equal(text, "Couldn't import. One thing to fix:\n• a.exam.json: “meta” is missing.");
});
