/**
 * Exam files as Settings shows them: what is stored, roughly how big, and a
 * delete. Exam Workspaces holds the "localdox-exam-writer" lock while it is open
 * and keeps everything in memory, so deleting under it would be overwritten
 * by its next save. Delete therefore runs only when that lock is free.
 */
import {
  clearExamWorkspace,
  storedExamWorkspaceIds,
  examWriterLock,
  deleteExamData,
  listAttempts,
  listExams,
  listPlans,
} from "./storage.ts";
import { forgetCheckpoints, workspaceRecoveryStore } from "./recovery.ts";

const DB = "localdox-exams-v2";
export interface StoredExamFile {
  workspaceId?: string;
  kind: "plan" | "exam";
  id: string;
  name: string;
  detail: string;
  attempts: number;
  /** Records plus every Blob they hold (keys, images), attempts included. */
  bytes: number;
}
function sizeOf(value: unknown): number {
  let blobs = 0;
  const json = JSON.stringify(value, (_key, v) => {
    if (v instanceof Blob) {
      blobs += v.size;
      return undefined;
    }
    return v;
  });
  return (json?.length ?? 0) + blobs;
}
/** Listing must not create the database for someone who never used exams. */
async function exists() {
  if (!indexedDB.databases) return true;
  return (await indexedDB.databases()).some((d) => d.name === DB);
}
export async function listExamFiles(): Promise<StoredExamFile[]> {
  if (!(await exists())) return [];
  const scopes = [undefined, ...(await storedExamWorkspaceIds())];
  return (await Promise.all(scopes.map(listWorkspaceExamFiles))).flat();
}
async function listWorkspaceExamFiles(workspaceId?: string): Promise<StoredExamFile[]> {
  if (!(await exists())) return [];
  const [plans, exams, attempts] = await Promise.all([
    listPlans(workspaceId),
    listExams(workspaceId),
    listAttempts(workspaceId),
  ]);
  const files: StoredExamFile[] = [];
  for (const p of plans) {
    const own = attempts.filter((a) => a.study?.planId === p.id),
      waiting = p.plan.days.some((d) => !p.days[d.id]?.cycles.length),
      topics = p.plan.days.length;
    files.push({
      workspaceId,
      kind: "plan",
      id: p.id,
      name: p.plan.name,
      detail: waiting
        ? "Study plan · waiting for its file"
        : p.setup
          ? "Study plan"
          : `Study plan · ${topics} topic${topics === 1 ? "" : "s"}`,
      attempts: own.length,
      bytes: sizeOf(p) + own.reduce((n, a) => n + sizeOf(a), 0),
    });
  }
  for (const e of exams) {
    const own = attempts.filter((a) => !a.study && a.session.examId === e.id);
    files.push({
      workspaceId,
      kind: "exam",
      id: e.id,
      name: e.exam.rules.meta.name,
      detail: "Exam library",
      attempts: own.length,
      bytes: sizeOf(e) + own.reduce((n, a) => n + sizeOf(a), 0),
    });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}
export async function deleteExamFile(
  file: Pick<StoredExamFile, "kind" | "id" | "workspaceId">,
): Promise<void> {
  const planIds = file.kind === "plan" ? [file.id] : [],
    examIds = file.kind === "exam" ? [file.id] : [];
  const run = async () => {
    const attemptIds = await deleteExamData({ planIds, examIds, workspaceId: file.workspaceId });
    forgetCheckpoints({ planIds, attemptIds }, workspaceRecoveryStore(file.workspaceId));
  };
  if (!navigator.locks) return run();
  const done = await navigator.locks.request(
    examWriterLock(file.workspaceId),
    { ifAvailable: true },
    async (lock) => {
      if (!lock) return false;
      await run();
      return true;
    },
  );
  if (!done) throw new Error("Exam Workspaces is open in another tab. Close it, then try again.");
}

export async function removeExamWorkspace(workspaceId?: string): Promise<void> {
  const run = async () => {
    await clearExamWorkspace(workspaceId);
    const journal = workspaceRecoveryStore(workspaceId);
    const keys = Array.from({ length: journal.length }, (_, i) => journal.key(i)).filter(
      (key): key is string => !!key?.startsWith("localdox:exam-recovery:"),
    );
    keys.forEach((key) => journal.removeItem(key));
  };
  if (!navigator.locks) return run();
  const done = await navigator.locks.request(
    examWriterLock(workspaceId),
    { ifAvailable: true },
    async (lock) => {
      if (!lock) return false;
      await run();
      return true;
    },
  );
  if (!done)
    throw new Error("This Exam Workspace is open in another tab. Close it, then try again.");
}

/** Hold every known writer lock before clearing anything. */
export async function clearAllExamStorage(): Promise<void> {
  if (!(await exists())) return;
  const scopes = [undefined, ...(await storedExamWorkspaceIds())];
  const run = async (index: number): Promise<void> => {
    if (index === scopes.length) {
      for (const scope of scopes) await clearExamWorkspace(scope);
      return;
    }
    if (!navigator.locks) return run(index + 1);
    await navigator.locks.request(
      examWriterLock(scopes[index]),
      { ifAvailable: true },
      async (lock) => {
        if (!lock) throw new Error("Close Exam Workspaces in other tabs before clearing storage.");
        await run(index + 1);
      },
    );
  };
  await run(0);
}
