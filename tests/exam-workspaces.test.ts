import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { GATE_SETUP, readExamFile } from "../src/services/exams/exam-setup.ts";
import { createExamPlan } from "../src/services/exams/study-plan.ts";
import { clearExamWorkspace, listPlans, savePlan } from "../src/services/exams/storage.ts";
import {
  checkpointPlan,
  recoverPending,
  workspaceRecoveryStore,
  type RecoveryStore,
} from "../src/services/exams/recovery.ts";

const paper = `# Exam
:::question{#q1 type=mcq marks=2}
What is two plus two?

- Four
- Three
- Two
- One
:::
:::solution{#q1 answer=A}
Two plus two equals four.
:::
`;
test("GATE variations inherit marking and tools, enforce count and validate keys", () => {
  const setup = { ...GATE_SETUP, name: "Short GATE", questionCount: 1, durationMinutes: 5 };
  const content = readExamFile(setup, "short-gate", paper);
  assert.equal(content.exam.exam.rules.timing.durationMinutes, 5);
  assert.equal(content.exam.exam.rules.tools.calculator, "scientific");
  assert.deepEqual(content.exam.exam.rules.questionTypes.mcq?.negativeMarking, {
    fractionOfMarks: [1, 3],
  });
  assert.equal(content.exam.exam.rules.questionTypes.msq?.scoring, "all_or_nothing");
  assert.equal(content.exam.exam.rules.questionTypes.nat?.negativeMarking, null);
  assert.throws(
    () => readExamFile({ ...setup, questionCount: 2 }, "bad-count", paper),
    /Expected 2 exam questions/,
  );
  assert.throws(() => readExamFile(setup, "bad-key", paper.replace("answer=A", "answer=Z")));
  assert.throws(() => readExamFile(setup, "bad-options", paper.replace("- One\n", "")));
  assert.equal(GATE_SETUP.rootRules!.timing.durationMinutes, 180);
});

test("identical plan IDs and deleting a workspace never affect another workspace or legacy data", async () => {
  const plan = createExamPlan({ ...GATE_SETUP, name: "Shared authored ID" }, 1, "shared-plan");
  await savePlan(plan);
  await savePlan(plan, "workspace-a");
  await savePlan({ ...plan, updatedAt: 99 }, "workspace-b");
  assert.equal((await listPlans("workspace-a"))[0].updatedAt, 1);
  assert.equal((await listPlans("workspace-b"))[0].updatedAt, 99);
  await clearExamWorkspace("workspace-a");
  assert.deepEqual(await listPlans("workspace-a"), []);
  assert.equal((await listPlans("workspace-b"))[0].id, plan.id);
  assert.ok((await listPlans()).some((p) => p.id === plan.id));
});

test("recovery journals cannot replay a same-ID plan from another workspace", () => {
  const values = new Map<string, string>();
  const store: RecoveryStore = {
    get length() {
      return values.size;
    },
    key: (i) => [...values.keys()][i] ?? null,
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => {
      values.set(k, v);
    },
    removeItem: (k) => {
      values.delete(k);
    },
  };
  const plan = createExamPlan({ ...GATE_SETUP, name: "Plan" }, 1, "same-id");
  const changed = { ...plan, days: { exam: { ...plan.days.exam, note: "Workspace A only" } } };
  checkpointPlan(changed, workspaceRecoveryStore("a", store));
  assert.equal(
    recoverPending([], [plan], workspaceRecoveryStore("b", store)).plans[0].days.exam.note,
    "",
  );
  assert.equal(
    recoverPending([], [plan], workspaceRecoveryStore("a", store)).plans[0].days.exam.note,
    "Workspace A only",
  );
  assert.equal(recoverPending([], [plan], store).tokens.length, 0);
});

test("workspace kinds survive persistence and backups, and old backups default to reader", async () => {
  const { newWorkspaceRecord, persistence, parseWorkspaceImport, serializeWorkspace } =
    await import("../src/lib/workspace/persistence.ts");
  const workspace = newWorkspaceRecord("GATE preparation", "exam");
  await persistence.putWorkspace(workspace);
  assert.equal((await persistence.getWorkspace(workspace.id))?.kind, "exam");
  assert.equal(
    (await persistence.listWorkspaceSummaries()).find((w) => w.id === workspace.id)?.kind,
    "exam",
  );
  const backup = await serializeWorkspace(workspace);
  assert.equal(parseWorkspaceImport(backup).kind, "exam");
  const legacy = JSON.parse(backup);
  delete legacy.workspace.kind;
  assert.equal(parseWorkspaceImport(JSON.stringify(legacy)).kind, "reader");
  legacy.workspace.kind = "unsupported";
  assert.throws(() => parseWorkspaceImport(JSON.stringify(legacy)));
});
