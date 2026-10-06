import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETUP, readExamFile } from "../src/services/exams/exam-setup.ts";
import {
  paperPlanId,
  rulesFileFor,
  sourceFingerprint,
  starterRules,
  syncPaperPlan,
  type PaperSource,
} from "../src/services/exams/paper-plan.ts";
import type { AttemptRecord } from "../src/services/exams/storage.ts";
import { XAM_TEMPLATE, xruleTemplate } from "../src/services/exams/templates.ts";
import { parseXrule } from "../src/services/exams/xrule.ts";

const file = (id: string, name: string, folderId: string | null = null, deletedAt?: number) => ({
  id,
  name,
  folderId,
  deletedAt,
});
// gate/ → da/ → week-1/
const folders = [
  { id: "gate", parentId: null },
  { id: "da", parentId: "gate" },
  { id: "week-1", parentId: "da" },
];

test("a paper's rules come from its own name first, then the nearest folder with one", () => {
  const paper = file("p", "mock-1.xam", "week-1");
  const own = file("r1", "mock-1.xrule", "week-1"),
    folderRules = file("r2", "rules.xrule", "da"),
    rootRules = file("r3", "default.xrule");
  assert.deepEqual(rulesFileFor(paper, [paper, own, folderRules, rootRules], folders), {
    kind: "found",
    file: own,
  });
  // A folder's only .xrule covers every paper beneath it, like an exam type.
  assert.deepEqual(rulesFileFor(paper, [paper, folderRules, rootRules], folders), {
    kind: "found",
    file: folderRules,
  });
  assert.deepEqual(rulesFileFor(paper, [paper, rootRules], folders), {
    kind: "found",
    file: rootRules,
  });
  assert.deepEqual(rulesFileFor(paper, [paper], folders), { kind: "missing" });
});

test("rules in the Bin don't count, and unrelated siblings are never guessed between", () => {
  const paper = file("p", "mock-1.xam", "da");
  const binned = file("r1", "mock-1.xrule", "da", 1),
    a = file("a", "easy.xrule", "da"),
    b = file("b", "hard.xrule", "da"),
    root = file("root", "default.xrule");
  assert.deepEqual(rulesFileFor(paper, [paper, binned, root], folders), {
    kind: "found",
    file: root,
  });
  assert.deepEqual(rulesFileFor(paper, [paper, a, b, root], folders), {
    kind: "ambiguous",
    files: [a, b],
  });
  // A matching name still settles it.
  const named = file("n", "mock-1.xrule", "da");
  assert.equal(rulesFileFor(paper, [paper, a, b, named], folders).kind, "found");
});

test("a folder cycle in stored data can't loop the lookup", () => {
  const paper = file("p", "x.xam", "a");
  const looped = [
    { id: "a", parentId: "b" },
    { id: "b", parentId: "a" },
  ];
  assert.deepEqual(rulesFileFor(paper, [paper], looped), { kind: "missing" });
});

test("new files start from templates that read as valid exams", () => {
  assert.deepEqual(parseXrule(xruleTemplate("Algebra")), { ...DEFAULT_SETUP, name: "Algebra" });
  assert.equal(parseXrule(starterRules("mock-1.xam")).name, "mock-1");
  const { exam } = readExamFile({ ...DEFAULT_SETUP, name: "New" }, "x", XAM_TEMPLATE, "new.xam");
  assert.equal(exam.exam.paper.length, 3);
});

const PAPER = (stem: string) => `:::question{#q1 type=mcq marks=2}
${stem}

- a
- b
:::

:::solution{#q1 answer=A}
Because.
:::
`;
const RULES = xruleTemplate("Mock");
const source = (paper = PAPER("First?"), rules = RULES): PaperSource => ({
  fileId: "mock-1.xam-abc12345",
  paper: { name: "mock-1.xam", text: paper },
  rules: { name: "mock.xrule", text: rules },
});

test("the first open builds the paper's plan from its files", async () => {
  const result = await syncPaperPlan(undefined, source(), [], 1);
  assert.equal(result.kind, "built");
  assert.equal(result.plan.id, paperPlanId("mock-1.xam-abc12345"));
  assert.match(result.plan.id, /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
  assert.equal(result.plan.days.exam.cycles[0].exam.exam.paper.length, 1);
  assert.deepEqual(result.plan.source, {
    fileId: "mock-1.xam-abc12345",
    fingerprint: sourceFingerprint(RULES, PAPER("First?")),
  });
  const again = await syncPaperPlan(result.plan, source(), [], 2);
  assert.equal(again.kind, "current");
  assert.equal(again.plan, result.plan);
});

test("edits before any attempt apply at once", async () => {
  const plan = (await syncPaperPlan(undefined, source(), [], 1)).plan;
  const edited = await syncPaperPlan(plan, source(PAPER("Second?")), [], 6);
  assert.equal(edited.kind, "built");
  assert.equal(edited.plan.days.exam.cycles[0].exam.exam.paper[0].body, "Second?");
  assert.equal(edited.plan.createdAt, plan.createdAt);
  // Rules edits apply too.
  const stricter = await syncPaperPlan(
    edited.plan,
    source(PAPER("Second?"), RULES.replace('"maxAttempts": 3', '"maxAttempts": 1')),
    [],
    7,
  );
  assert.equal(stricter.plan.days.exam.cycles[0].exam.exam.rules.attempts.max, 1);
});

test("after an attempt the plan is pinned to the version it used", async () => {
  const plan = (await syncPaperPlan(undefined, source(), [], 1)).plan;
  const attempts = [{ id: "a1", study: { planId: plan.id, dayId: "exam" } } as AttemptRecord];
  const pinned = await syncPaperPlan(plan, source(PAPER("Changed?")), attempts, 2);
  assert.equal(pinned.kind, "pinned");
  assert.equal(pinned.plan, plan);
  // Broken files can't disturb a pinned plan: they aren't even read.
  assert.equal((await syncPaperPlan(plan, source("garbage"), attempts, 3)).kind, "pinned");
});

test("files that can't be read fail with the importer's error, and nothing is built", async () => {
  await assert.rejects(syncPaperPlan(undefined, source(PAPER("x"), "{"), [], 1), /JSON/);
  await assert.rejects(
    syncPaperPlan(undefined, source(PAPER("x"), xruleTemplate("M").replace("30", "0")), [], 1),
    /durationMinutes/,
  );
});
