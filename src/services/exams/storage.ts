import type { Exam } from "./validation.ts";
import { importSolutions } from "./validation.ts";
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
const DB = "localdox-exams-v2";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      for (const store of ["exams", "attempts", "plans"]) {
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
export const listExams = () =>
  transaction("exams", "readonly", (s) => s.getAll()) as Promise<ExamRecord[]>;
export const listAttempts = () =>
  transaction("attempts", "readonly", (s) => s.getAll()) as Promise<AttemptRecord[]>;
export const saveExam = (record: ExamRecord) =>
  transaction("exams", "readwrite", (s) => s.put(record));
export const saveAttempt = (record: AttemptRecord) =>
  transaction("attempts", "readwrite", (s) => s.put(record));
export const listPlans = () =>
  transaction("plans", "readonly", (s) => s.getAll()) as Promise<StudyPlanRecord[]>;
export const savePlan = (record: StudyPlanRecord) =>
  transaction("plans", "readwrite", (s) => s.put(record));
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
  return importSolutions(record.exam, source);
}
