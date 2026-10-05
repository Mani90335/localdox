import type { Exam } from "./validation.ts";
import type { Session } from "./session.ts";
import type { AttemptAnalysis } from "./diagnostics.ts";
import type { StudyPlanRecord } from "./study-plan.ts";
export interface ExamRecord {
  id: string;
  exam: Exam;
  solutionFile?: Blob;
  solutionUrl?: string;
  /** Images imported with the exam, by file name. */
  assets?: Record<string, Blob>;
  /** Images shipped with a bundled exam, by file name. */
  assetUrls?: Record<string, string>;
}
export interface AttemptRecord {
  id: string;
  exam: ExamRecord;
  session: Session;
  analysis?: AttemptAnalysis;
  study?: { planId: string; dayId: string; cycle: number; paperFingerprint: string };
}
export const examWriterLock = (workspaceId?: string) =>
  workspaceId ? `localdox-exam-writer:${workspaceId}` : "localdox-exam-writer";
const DB = "localdox-exams-v2";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 3);
    req.onupgradeneeded = () => {
      for (const store of ["exams", "attempts", "plans"]) {
        if (!req.result.objectStoreNames.contains(`workspace-${store}`))
          req.result.createObjectStore(`workspace-${store}`, { keyPath: ["workspaceId", "id"] });
        if (!req.result.objectStoreNames.contains(store))
          req.result.createObjectStore(store, { keyPath: "id" });
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}
async function transaction<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode),
      req = action(tx.objectStore(store));
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? req.error ?? new Error("Exam storage transaction aborted"));
    };
    tx.onerror = () => {
      /* onabort reports the failure */
    };
  });
}
/** Legacy rows stay readable; new workspaces use compound keys so imports with
 * the same authored id cannot overwrite a different workspace's progress. */
async function listScoped<T>(store: string, workspaceId?: string): Promise<T[]> {
  const rows = (await transaction(workspaceId ? `workspace-${store}` : store, "readonly", (s) =>
    s.getAll(workspaceId ? IDBKeyRange.bound([workspaceId, ""], [workspaceId, []]) : undefined),
  )) as (T & { workspaceId?: string })[];
  return workspaceId ? rows.filter((r) => r.workspaceId === workspaceId) : rows;
}
const putScoped = (store: string, record: { id: string }, workspaceId?: string) =>
  transaction(workspaceId ? `workspace-${store}` : store, "readwrite", (s) =>
    s.put(workspaceId ? { ...record, workspaceId } : record),
  );
export const listExams = (workspaceId?: string) => listScoped<ExamRecord>("exams", workspaceId);
export const listAttempts = (workspaceId?: string) =>
  listScoped<AttemptRecord>("attempts", workspaceId);
export const listPlans = (workspaceId?: string) =>
  listScoped<StudyPlanRecord>("plans", workspaceId);
export const saveExam = (record: ExamRecord, workspaceId?: string) =>
  putScoped("exams", record, workspaceId);
export const saveAttempt = (record: AttemptRecord, workspaceId?: string) =>
  putScoped("attempts", record, workspaceId);
export const savePlan = (record: StudyPlanRecord, workspaceId?: string) =>
  putScoped("plans", record, workspaceId);
/**
 * Delete study plans and library exams with the attempts that belong to them,
 * in one transaction: a failure leaves everything as it was. Plans hold their
 * own exam snapshots, so deleting a library exam never breaks a plan.
 */
export async function deleteExamData({
  planIds = [],
  examIds = [],
  workspaceId,
}: {
  planIds?: string[];
  examIds?: string[];
  workspaceId?: string;
}): Promise<string[]> {
  const db = await database(),
    deletedAttempts: string[] = [];
  return new Promise((resolve, reject) => {
    const store = (name: string) => (workspaceId ? `workspace-${name}` : name);
    const key = (id: string) => (workspaceId ? [workspaceId, id] : id);
    const tx = db.transaction([store("plans"), store("exams"), store("attempts")], "readwrite");
    planIds.forEach((id) => tx.objectStore(store("plans")).delete(key(id)));
    examIds.forEach((id) => tx.objectStore(store("exams")).delete(key(id)));
    const cursor = tx.objectStore(store("attempts")).openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      const a = c.value as AttemptRecord & { workspaceId?: string };
      if (workspaceId && a.workspaceId !== workspaceId) {
        c.continue();
        return;
      }
      if (
        (a.study && planIds.includes(a.study.planId)) ||
        (!a.study && examIds.includes(a.session.examId))
      ) {
        deletedAttempts.push(a.id);
        c.delete();
      }
      c.continue();
    };
    tx.oncomplete = () => {
      db.close();
      resolve(deletedAttempts);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("Exam storage transaction aborted"));
    };
  });
}
/** Only this gate may read a solution Blob or request a solution URL. */
export async function loadSolutions(record: ExamRecord, session: Session) {
  if (
    session.submittedAt === undefined ||
    !["submitting", "reflection", "submitted", "review"].includes(session.phase)
  )
    throw new Error("Solutions are sealed until submission");
  let source: string;
  if (record.solutionFile) source = await record.solutionFile.text();
  else if (record.solutionUrl) {
    const response = await fetch(record.solutionUrl, { cache: "no-store" });
    if (!response.ok)
      throw new Error(
        `Solutions could not be loaded (${response.status}). Retry grading when available.`,
      );
    source = await response.text();
  } else throw new Error("No solutions file attached");
  // Loaded here, not at the top, so listing or deleting exam data (Settings)
  // does not pull in the Markdown parser.
  const { importSolutions } = await import("./validation.ts");
  return importSolutions(record.exam, source);
}

export async function storedExamWorkspaceIds(): Promise<string[]> {
  const keys = await Promise.all(
    ["exams", "plans", "attempts"].map((store) =>
      transaction(`workspace-${store}`, "readonly", (s) => s.getAllKeys()),
    ),
  );
  return [...new Set(keys.flat().map((key) => (key as string[])[0]))];
}

/** Removes all feature data owned by one workspace, including orphan attempts. */
export async function clearExamWorkspace(workspaceId?: string): Promise<void> {
  const db = await database();
  const names = ["exams", "plans", "attempts"].map((name) =>
    workspaceId ? `workspace-${name}` : name,
  );
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(names, "readwrite");
    for (const name of names) {
      if (!workspaceId) {
        tx.objectStore(name).clear();
        continue;
      }
      tx.objectStore(name).delete(IDBKeyRange.bound([workspaceId, ""], [workspaceId, []]));
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
