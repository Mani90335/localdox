import { test } from "node:test";
import assert from "node:assert/strict";
import { exam, key } from "./exam-format.test.ts";
import {
  createSession,
  showInstructions,
  startSession,
  setAnswer,
  questionState,
} from "../src/services/exams/session.ts";
import {
  checkpointAttempt,
  checkpointPlan,
  clearCheckpoint,
  recoverPending,
  type RecoveryStore,
} from "../src/services/exams/recovery.ts";
import {
  importStudyPlan,
  updateStudyNote,
  updateStudyTask,
} from "../src/services/exams/study-plan.ts";
class MemoryStorage implements RecoveryStore {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
function attempt() {
  const e = exam();
  return {
    id: "recovery-test",
    exam: { id: e.rules.meta.id, exam: e, solutionFile: new Blob([key]) },
    session: {
      ...startSession(
        showInstructions(createSession(e.rules, e.paper, e.taxonomy.id, 0)),
        e.rules,
        true,
        true,
        0,
      ),
      id: "recovery-test",
    },
  };
}
test("pending answer survives reload before IndexedDB commit without serializing the key", () => {
  const store = new MemoryStorage(),
    old = attempt(),
    updated = {
      ...old,
      session: setAnswer(old.session, old.exam.exam.rules, old.exam.exam.paper[0], "A", 1000),
    };
  const token = checkpointAttempt(updated, store);
  assert.ok(!token.value.includes("solutionFile"));
  assert.ok(!token.value.includes("::distractor"));
  const restored = recoverPending([old], [], store);
  assert.equal(questionState(restored.attempts[0].session, "q1").response, "A");
  assert.equal(restored.attempts[0].exam, old.exam);
  assert.equal(restored.tokens.length, 1);
  clearCheckpoint(token, store);
  assert.equal(store.length, 0);
});
test("an older commit cannot erase a newer pending response", () => {
  const store = new MemoryStorage(),
    a = attempt(),
    older = checkpointAttempt(a, store),
    newer = checkpointAttempt(
      { ...a, session: setAnswer(a.session, a.exam.exam.rules, a.exam.exam.paper[0], "B", 1000) },
      store,
    );
  clearCheckpoint(older, store);
  assert.equal(store.getItem(newer.key), newer.value);
  clearCheckpoint(newer, store);
  assert.equal(store.length, 0);
});
test("checklist and notes recover before their IndexedDB write completes", async () => {
  const store = new MemoryStorage(),
    a = attempt();
  a.exam.exam.rules.attempts.max = 2;
  const old = await importStudyPlan(
    JSON.stringify({
      schemaVersion: 1,
      id: "recovery-plan",
      name: "Plan",
      days: [
        { id: "day", title: "Day", examId: a.exam.id, tasks: [{ id: "read", label: "Read" }] },
      ],
    }),
    [a.exam],
    0,
  );
  const updated = updateStudyNote(
    updateStudyTask(old, "day", "read", true, [], 1),
    "day",
    "Keep this note",
    [],
    2,
  );
  checkpointPlan(updated, store);
  const recovered = recoverPending([], [old], store).plans[0];
  assert.equal(recovered.days.day.tasks.read, true);
  assert.equal(recovered.days.day.note, "Keep this note");
  assert.equal(recovered.days.day.cycles[0].exam, old.days.day.cycles[0].exam);
});
