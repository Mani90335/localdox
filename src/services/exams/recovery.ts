import type { AttemptRecord } from "./storage.ts";
import type { StudyPlanRecord } from "./study-plan.ts";
const prefix = "localdox:exam-recovery:";
export interface RecoveryStore {
  length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface AttemptCheckpoint {
  version: 1;
  kind: "attempt";
  id: string;
  session: AttemptRecord["session"];
  analysis?: AttemptRecord["analysis"];
  study?: AttemptRecord["study"];
}
interface PlanCheckpoint {
  version: 1;
  kind: "plan";
  id: string;
  updatedAt: number;
  days: Record<
    string,
    {
      tasks: Record<string, boolean>;
      note: string;
      cycles: { fingerprint: string; revisionCompletedAt?: number }[];
    }
  >;
}
type Checkpoint = AttemptCheckpoint | PlanCheckpoint;
export interface RecoveryToken {
  key: string;
  value: string;
}
/** Synchronous, short-lived journal bridges the interval before IDB commits.
 * Exam content and opaque solution files remain in IndexedDB, never here. */
export function checkpointAttempt(
  record: AttemptRecord,
  store: RecoveryStore = localStorage,
): RecoveryToken {
  const checkpoint: AttemptCheckpoint = {
    version: 1,
    kind: "attempt",
    id: record.id,
    session: record.session,
    analysis: record.analysis,
    study: record.study,
  };
  const key = prefix + "attempt:" + record.id,
    value = JSON.stringify(checkpoint);
  store.setItem(key, value);
  return { key, value };
}
export function checkpointPlan(
  record: StudyPlanRecord,
  store: RecoveryStore = localStorage,
): RecoveryToken {
  const checkpoint: PlanCheckpoint = {
    version: 1,
    kind: "plan",
    id: record.id,
    updatedAt: record.updatedAt,
    days: Object.fromEntries(
      Object.entries(record.days).map(([id, day]) => [
        id,
        {
          tasks: day.tasks,
          note: day.note,
          cycles: day.cycles.map((c) => ({
            fingerprint: c.fingerprint,
            revisionCompletedAt: c.revisionCompletedAt,
          })),
        },
      ]),
    ),
  };
  const key = prefix + "plan:" + record.id,
    value = JSON.stringify(checkpoint);
  store.setItem(key, value);
  return { key, value };
}
export function clearCheckpoint(token: RecoveryToken, store: RecoveryStore = localStorage) {
  // An older transaction must never clear a newer edit's recovery data.
  if (store.getItem(token.key) === token.value) store.removeItem(token.key);
}
/** Drop journal entries of deleted plans and attempts so none is replayed. */
export function forgetCheckpoints(
  { planIds = [], attemptIds = [] }: { planIds?: string[]; attemptIds?: string[] },
  store: RecoveryStore = localStorage,
) {
  for (const id of planIds) store.removeItem(prefix + "plan:" + id);
  for (const id of attemptIds) store.removeItem(prefix + "attempt:" + id);
}
export function recoverPending(
  attempts: AttemptRecord[],
  plans: StudyPlanRecord[],
  store: RecoveryStore = localStorage,
): { attempts: AttemptRecord[]; plans: StudyPlanRecord[]; tokens: RecoveryToken[] } {
  const recoveredAttempts = [...attempts],
    recoveredPlans = [...plans],
    tokens: RecoveryToken[] = [];
  const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter(
    (key): key is string => !!key && key.startsWith(prefix),
  );
  for (const key of keys) {
    const value = store.getItem(key)!;
    let checkpoint: Checkpoint;
    try {
      checkpoint = JSON.parse(value);
      if (checkpoint.version !== 1 || typeof checkpoint.id !== "string")
        throw new Error("Unsupported checkpoint");
    } catch {
      throw new Error(
        "Exam recovery data is malformed. Keep this browser profile intact to recover your work.",
      );
    }
    if (checkpoint.kind === "attempt") {
      const index = recoveredAttempts.findIndex((a) => a.id === checkpoint.id);
      if (index < 0) continue;
      if (checkpoint.session.id !== checkpoint.id || !Array.isArray(checkpoint.session.events))
        throw new Error("Invalid attempt recovery checkpoint");
      recoveredAttempts[index] = {
        ...recoveredAttempts[index],
        session: checkpoint.session,
        analysis: checkpoint.analysis,
        study: checkpoint.study,
      };
      tokens.push({ key, value });
    } else if (checkpoint.kind === "plan") {
      const index = recoveredPlans.findIndex((p) => p.id === checkpoint.id);
      if (index < 0) continue;
      const plan = recoveredPlans[index],
        days = { ...plan.days };
      for (const [id, progress] of Object.entries(checkpoint.days)) {
        const day = days[id];
        if (
          !day ||
          day.cycles.length !== progress.cycles.length ||
          day.cycles.some((c, i) => c.fingerprint !== progress.cycles[i].fingerprint)
        )
          continue;
        days[id] = {
          ...day,
          tasks: progress.tasks,
          note: progress.note,
          cycles: day.cycles.map((c, i) => ({
            ...c,
            revisionCompletedAt: progress.cycles[i].revisionCompletedAt,
          })),
        };
      }
      recoveredPlans[index] = {
        ...plan,
        updatedAt: Math.max(plan.updatedAt, checkpoint.updatedAt),
        days,
      };
      tokens.push({ key, value });
    }
  }
  return { attempts: recoveredAttempts, plans: recoveredPlans, tokens };
}

/** A workspace sees only its own journal, including when authored ids overlap. */
export function workspaceRecoveryStore(
  workspaceId: string | undefined,
  store: RecoveryStore = localStorage,
): RecoveryStore {
  if (!workspaceId) return store;
  const namespace = `localdox:workspace-exam-recovery:${encodeURIComponent(workspaceId)}:`;
  const keys = () =>
    Array.from({ length: store.length }, (_, i) => store.key(i)).filter(
      (key): key is string => !!key?.startsWith(namespace),
    );
  return {
    get length() {
      return keys().length;
    },
    key: (i) => keys()[i]?.slice(namespace.length) ?? null,
    getItem: (key) => store.getItem(namespace + key),
    setItem: (key, value) => store.setItem(namespace + key, value),
    removeItem: (key) => store.removeItem(namespace + key),
  };
}
