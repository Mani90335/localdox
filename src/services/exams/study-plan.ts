import { z } from "zod";
import { idSchema, parseJson, ExamImportError, type Ruleset } from "./schema.ts";
import type { Question } from "./parser.ts";
import type { AttemptRecord, ExamRecord } from "./storage.ts";
import { createSession, showInstructions } from "./session.ts";
import { isAnswered, type Response } from "./scoring.ts";
import {
  checkPractice,
  practiceKey,
  practiceProgress,
  type PracticeAnswer,
  type PracticeSet,
} from "./practice.ts";
import type { ExamFileContent, ExamSetup } from "./exam-setup.ts";

export const studyPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    name: z.string().min(1).max(160),
    description: z.string().max(2000).default(""),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
      .refine(
        (value) =>
          !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
        "Invalid calendar date",
      )
      .optional(),
    days: z
      .array(
        z
          .object({
            id: idSchema,
            title: z.string().min(1).max(160),
            examId: idSchema,
            summaryMd: z.string().max(20000).default(""),
            estimatedMinutes: z.number().int().positive().optional(),
            tasks: z
              .array(z.object({ id: idSchema, label: z.string().min(1).max(500) }).strict())
              .max(50)
              .default([]),
            /** IDs of `*.practice.md` files imported with the plan. */
            practice: z.array(idSchema).max(20).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(366),
  })
  .strict();
export type StudyPlan = z.infer<typeof studyPlanSchema>;
export type StudyDay = StudyPlan["days"][number];
export interface PaperCycle {
  index: number;
  exam: ExamRecord;
  fingerprint: string;
  assignedAt: number;
  revisionCompletedAt?: number;
}
export interface DayRecord {
  tasks: Record<string, boolean>;
  note: string;
  /** Empty only while a configured exam waits for its file (`hasExamFile`). */
  cycles: PaperCycle[];
  /** Step 1: the learner said they finished studying. */
  learnedAt?: number;
  /** Step 2: practice questions and the learner's checked answers. */
  practice?: { sets: PracticeSet[]; answers: Record<string, PracticeAnswer> };
  /** Step 4: the learner went through the passed exam's answers. */
  reviewedAt?: number;
}
/**
 * The four steps of a topic (a plan entry), unlocked strictly in this order.
 * Topics are independent: learners decide the order themselves.
 */
export type DayStep = "learn" | "practice" | "exam" | "review" | "done";
export interface StudyPlanRecord {
  id: string;
  plan: StudyPlan;
  createdAt: number;
  updatedAt: number;
  days: Record<string, DayRecord>;
  /** Rules configured in the app; the exam file arrives later. Absent on
   * plans imported whole (plan JSON with its exams). */
  setup?: ExamSetup;
}
export type DayStatus = "ready" | "in_progress" | "failed" | "revision_required" | "passed";
export interface DayProgress {
  id: string;
  status: DayStatus;
  attemptsUsed: number;
  attemptsRemaining: number;
  maxAttempts: number;
  passPercentage: number;
  bestPercentage: number | null;
  latestPercentage: number | null;
  completedTasks: number;
  totalTasks: number;
  cycle: PaperCycle;
  attempts: AttemptRecord[];
  activeAttempt?: AttemptRecord;
  /** Which steps are finished. A passed exam implies the steps before it. */
  steps: { learn: boolean; practice: boolean; exam: boolean; review: boolean };
  /** The step the learner should do now ("done" when all four are finished). */
  step: DayStep;
  practiceTotal: number;
  practiceAttempted: number;
}
export function progressionPolicy(rules: Ruleset) {
  return (
    rules.progression ?? {
      passPercentage: 80,
      rewriteDifficultyPercentage: 50,
      difficultyLabel: "hard",
    }
  );
}
export function scorePercentage(score: number, totalMarks: number) {
  return totalMarks > 0 ? (score / totalMarks) * 100 : 0;
}
export function meetsPassingScore(score: number, totalMarks: number, threshold: number) {
  const earned = score * 100,
    target = threshold * totalMarks;
  const roundingError = Number.EPSILON * Math.max(1, Math.abs(earned), Math.abs(target)) * 4;
  return totalMarks > 0 && earned + roundingError >= target;
}
export async function paperFingerprint(paper: Question[]): Promise<string> {
  const normalize = (value: string) => value.normalize("NFC").replace(/\s+/g, " ").trim();
  // Renaming IDs, shuffling questions/options, or changing diagnostic tags does
  // not make an exhausted paper new. The key is never accessed here.
  const canonical = paper
    .map((q) =>
      JSON.stringify({
        type: q.type,
        marks: q.marks,
        body: normalize(q.body),
        options: q.options.map(normalize).sort(),
      }),
    )
    .sort();
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(canonical)),
  );
  return [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, "0")).join("");
}
function planError(location: string, message: string): never {
  throw new ExamImportError([{ severity: "error", location, message }]);
}
function validateStudyExam(exam: ExamRecord, location: string) {
  const r = exam.exam.rules,
    policy = progressionPolicy(r);
  if (r.attempts.max === null)
    planError(location, "A study exam must configure a finite attempts.max in its exam JSON.");
  if (r.results.scoreVisibility !== "immediate")
    planError(
      location,
      'Study exams require results.scoreVisibility="immediate" so the daily gate can be shown.',
    );
  if (!exam.exam.taxonomy.difficulty.includes(policy.difficultyLabel))
    planError(
      location,
      `The rewrite difficulty label ${policy.difficultyLabel} is not in this exam taxonomy.`,
    );
}
/** Practice reveals answers, so it may not contain the exam's questions. */
function assertNoRepeats(sets: PracticeSet[], exam: ExamRecord, location: string) {
  if (sets.some((set) => set.questions.some((q) => exam.exam.paper.some((p) => p.body === q.body))))
    planError(
      location,
      "A practice question repeats a question from this topic's exam. Practice shows answers, so use different questions.",
    );
}
/** False while a configured exam still waits for its file. */
export const hasExamFile = (record: StudyPlanRecord) =>
  record.plan.days.every((d) => record.days[d.id]?.cycles.length > 0);
/** A configured exam: a one-topic plan whose content arrives as one file. */
export function createExamPlan(
  setup: ExamSetup,
  now = Date.now(),
  id: string = crypto.randomUUID(),
): StudyPlanRecord {
  const plan = studyPlanSchema.parse({
    schemaVersion: 1,
    id,
    name: setup.name,
    days: [{ id: "exam", title: setup.name, examId: `${id}-exam`, summaryMd: setup.summaryMd }],
  });
  return {
    id,
    plan,
    createdAt: now,
    updatedAt: now,
    days: { exam: { tasks: {}, note: "", cycles: [] } },
    setup,
  };
}
/** Attach the file read by `readExamFile`. A file is attached once. */
export async function attachExamFile(
  record: StudyPlanRecord,
  content: ExamFileContent,
  now = Date.now(),
): Promise<StudyPlanRecord> {
  const day = record.plan.days[0];
  if (!record.setup) throw new Error("This plan came with its exams; there is no file to add.");
  if (record.days[day.id].cycles.length) throw new Error("This exam already has its file.");
  if (content.exam.id !== day.examId) throw new Error("This file was read for a different exam.");
  validateStudyExam(content.exam, "exam.md");
  const sets = content.practice ? [content.practice] : [];
  assertNoRepeats(sets, content.exam, "exam.md");
  const fingerprint = await paperFingerprint(content.exam.exam.paper);
  return withDay(
    record,
    day.id,
    (d) => ({
      ...d,
      ...(sets.length ? { practice: { sets, answers: {} } } : {}),
      cycles: [{ index: 0, exam: content.exam, fingerprint, assignedAt: now }],
    }),
    now,
  );
}
export async function importStudyPlan(
  source: string,
  library: ExamRecord[],
  now = Date.now(),
  practiceSets: PracticeSet[] = [],
): Promise<StudyPlanRecord> {
  const plan = parseJson(source, studyPlanSchema, "plan.json"),
    days: Record<string, DayRecord> = {},
    seen = new Set<string>();
  for (const day of plan.days) {
    if (seen.has(day.id)) planError(`days.${day.id}`, "Duplicate day ID");
    seen.add(day.id);
    if (new Set(day.tasks.map((t) => t.id)).size !== day.tasks.length)
      planError(`days.${day.id}.tasks`, "Duplicate task ID");
    const exam = library.find((e) => e.id === day.examId);
    if (!exam)
      planError(`days.${day.id}.examId`, `Import exam ${day.examId} before importing this plan.`);
    validateStudyExam(exam, `days.${day.id}.examId`);
    const sets = day.practice.map((id) => {
      const set = practiceSets.find((p) => p.id === id);
      if (!set)
        planError(`days.${day.id}.practice`, `Add ${id}.practice.md to the files you import.`);
      return structuredClone(set);
    });
    assertNoRepeats(sets, exam, `days.${day.id}.practice`);
    days[day.id] = {
      tasks: {},
      note: "",
      ...(sets.length ? { practice: { sets, answers: {} } } : {}),
      cycles: [
        {
          index: 0,
          exam: structuredClone(exam),
          fingerprint: await paperFingerprint(exam.exam.paper),
          assignedAt: now,
        },
      ],
    };
  }
  return { id: plan.id, plan, createdAt: now, updatedAt: now, days };
}
export function studyProgress(record: StudyPlanRecord, attempts: AttemptRecord[]): DayProgress[] {
  return record.plan.days.map((day) => {
    const saved = record.days[day.id],
      cycle = saved.cycles.at(-1)!,
      first = saved.cycles[0],
      policy = progressionPolicy(first.exam.exam.rules),
      maxAttempts = first.exam.exam.rules.attempts.max!;
    const all = attempts
      .filter(
        (a) =>
          !a.session.demo &&
          a.study?.planId === record.id &&
          a.study.dayId === day.id &&
          saved.cycles.some(
            (c) => c.index === a.study!.cycle && c.fingerprint === a.study!.paperFingerprint,
          ),
      )
      .sort((a, b) => a.session.createdAt - b.session.createdAt);
    const current = all.filter((a) => a.study!.cycle === cycle.index),
      started = current.filter((a) => a.session.startedAt !== undefined),
      graded = all.filter((a) => a.analysis && ["submitted", "review"].includes(a.session.phase)),
      activeAttempt = current.find((a) =>
        ["instructions", "in_progress", "submitting", "reflection"].includes(a.session.phase),
      );
    const passed = graded.some((a) =>
        meetsPassingScore(a.analysis!.score, a.analysis!.totalMarks, policy.passPercentage),
      ),
      percentages = graded.map((a) => scorePercentage(a.analysis!.score, a.analysis!.totalMarks));
    const practice = practiceProgress(saved.practice?.sets ?? [], saved.practice?.answers ?? {});
    const status: DayStatus = passed
      ? "passed"
      : activeAttempt && activeAttempt.session.phase !== "instructions"
        ? "in_progress"
        : started.length >= maxAttempts
          ? "revision_required"
          : started.some((a) => a.analysis)
            ? "failed"
            : "ready";
    // Steps unlock in order, so a passed exam already implies learn and
    // practice (questions added afterwards never relock a finished day).
    const steps = {
      learn: passed || saved.learnedAt !== undefined,
      practice: passed || practice.attempted >= practice.total,
      exam: passed,
      review: passed && saved.reviewedAt !== undefined,
    };
    const step: DayStep = !steps.learn
      ? "learn"
      : !steps.practice
        ? "practice"
        : !steps.exam
          ? "exam"
          : !steps.review
            ? "review"
            : "done";
    return {
      steps,
      step,
      practiceTotal: practice.total,
      practiceAttempted: practice.attempted,
      id: day.id,
      status,
      attemptsUsed: started.length,
      attemptsRemaining: Math.max(0, maxAttempts - started.length),
      maxAttempts,
      passPercentage: policy.passPercentage,
      bestPercentage: percentages.length ? Math.max(...percentages) : null,
      latestPercentage: percentages.at(-1) ?? null,
      completedTasks: day.tasks.filter((t) => saved.tasks[t.id]).length,
      totalTasks: day.tasks.length,
      cycle,
      attempts: all,
      activeAttempt,
    };
  });
}
function editableDay(record: StudyPlanRecord, dayId: string, attempts: AttemptRecord[]) {
  const progress = studyProgress(record, attempts).find((p) => p.id === dayId);
  if (!progress) throw new Error("Unknown topic");
  return progress;
}
export function updateStudyTask(
  record: StudyPlanRecord,
  dayId: string,
  taskId: string,
  completed: boolean,
  attempts: AttemptRecord[],
  now = Date.now(),
): StudyPlanRecord {
  editableDay(record, dayId, attempts);
  if (!record.plan.days.find((d) => d.id === dayId)!.tasks.some((t) => t.id === taskId))
    throw new Error("Unknown study task");
  return {
    ...record,
    updatedAt: now,
    days: {
      ...record.days,
      [dayId]: {
        ...record.days[dayId],
        tasks: { ...record.days[dayId].tasks, [taskId]: completed },
      },
    },
  };
}
export function updateStudyNote(
  record: StudyPlanRecord,
  dayId: string,
  note: string,
  attempts: AttemptRecord[],
  now = Date.now(),
): StudyPlanRecord {
  editableDay(record, dayId, attempts);
  if (note.length > 5000) throw new Error("Notes must be at most 5000 characters");
  return {
    ...record,
    updatedAt: now,
    days: { ...record.days, [dayId]: { ...record.days[dayId], note } },
  };
}
export function prepareStudyAttempt(
  record: StudyPlanRecord,
  dayId: string,
  attempts: AttemptRecord[],
  now = Date.now(),
): AttemptRecord {
  const progress = editableDay(record, dayId, attempts);
  if (progress.status === "passed") throw new Error("This topic's exam is already passed.");
  if (!progress.activeAttempt) assertExamUnlocked(progress);
  if (progress.status === "revision_required")
    throw new Error("Attempt limit reached. Revise and attach a new qualifying paper.");
  if (progress.activeAttempt) return progress.activeAttempt;
  const exam = progress.cycle.exam,
    session = showInstructions(
      createSession(exam.exam.rules, exam.exam.paper, exam.exam.taxonomy.id, now),
    );
  return {
    id: session.id,
    exam,
    session,
    study: {
      planId: record.id,
      dayId,
      cycle: progress.cycle.index,
      paperFingerprint: progress.cycle.fingerprint,
    },
  };
}
export function assertStudyStart(
  record: StudyPlanRecord,
  attempt: AttemptRecord,
  attempts: AttemptRecord[],
) {
  if (!attempt.study || attempt.study.planId !== record.id)
    throw new Error("Attempt does not belong to this plan");
  const p = editableDay(record, attempt.study.dayId, attempts);
  if (p.status === "passed" || p.status === "revision_required" || p.attemptsRemaining === 0)
    throw new Error("This day cannot start another attempt on this paper.");
  if (
    p.cycle.index !== attempt.study.cycle ||
    p.cycle.fingerprint !== attempt.study.paperFingerprint
  )
    throw new Error("This paper has been replaced. Start from the study plan.");
  if (p.activeAttempt && p.activeAttempt.id !== attempt.id)
    throw new Error("Finish the current attempt first.");
  assertExamUnlocked(p);
}
function assertExamUnlocked(p: DayProgress) {
  if (!p.steps.learn) throw new Error("Finish Step 1 (Learn) before the exam.");
  if (!p.steps.practice) throw new Error("Answer every practice question before the exam.");
}
function withDay(
  record: StudyPlanRecord,
  dayId: string,
  change: (day: DayRecord) => DayRecord,
  now: number,
): StudyPlanRecord {
  return {
    ...record,
    updatedAt: now,
    days: { ...record.days, [dayId]: change(record.days[dayId]) },
  };
}
/** Step 1. Learning happens outside the app; the learner confirms it here. */
export function markLearned(
  record: StudyPlanRecord,
  dayId: string,
  attempts: AttemptRecord[],
  now = Date.now(),
): StudyPlanRecord {
  editableDay(record, dayId, attempts);
  return withDay(record, dayId, (d) => ({ ...d, learnedAt: d.learnedAt ?? now }), now);
}
/** Step 2. Record a checked answer. Each question is answered once. */
export function answerPractice(
  record: StudyPlanRecord,
  dayId: string,
  setId: string,
  questionId: string,
  response: Response,
  attempts: AttemptRecord[],
  now = Date.now(),
): StudyPlanRecord {
  const p = editableDay(record, dayId, attempts);
  if (!p.steps.learn) throw new Error("Finish Step 1 (Learn) before practising.");
  const practice = record.days[dayId].practice,
    set = practice?.sets.find((s) => s.id === setId),
    q = set?.questions.find((q) => q.id === questionId),
    solution = set?.solutions.find((s) => s.id === questionId);
  if (!practice || !set || !q || !solution) throw new Error("Unknown practice question");
  if (!isAnswered(response)) throw new Error("Choose an answer first");
  const key = practiceKey(setId, questionId);
  if (practice.answers[key]) throw new Error("This question is already checked");
  const answer: PracticeAnswer = {
    response,
    outcome: checkPractice(q, solution, response),
    at: now,
  };
  return withDay(
    record,
    dayId,
    (d) => ({ ...d, practice: { ...practice, answers: { ...practice.answers, [key]: answer } } }),
    now,
  );
}
/** Learners can add their own practice files to any unlocked day. */
export function addPractice(
  record: StudyPlanRecord,
  dayId: string,
  set: PracticeSet,
  attempts: AttemptRecord[],
  now = Date.now(),
): StudyPlanRecord {
  editableDay(record, dayId, attempts);
  const practice = record.days[dayId].practice ?? { sets: [], answers: {} };
  if (practice.sets.some((s) => s.id === set.id))
    throw new Error(`This day already has practice named ${set.id}. Rename the file and retry.`);
  return withDay(
    record,
    dayId,
    (d) => ({ ...d, practice: { ...practice, sets: [...practice.sets, set] } }),
    now,
  );
}
/** Step 4. Available once the exam is passed; completes the day. */
export function markReviewed(
  record: StudyPlanRecord,
  dayId: string,
  attempts: AttemptRecord[],
  now = Date.now(),
): StudyPlanRecord {
  const p = editableDay(record, dayId, attempts);
  if (p.status !== "passed") throw new Error("Pass the exam before finishing the review.");
  return withDay(record, dayId, (d) => ({ ...d, reviewedAt: d.reviewedAt ?? now }), now);
}
export function completeRevision(
  record: StudyPlanRecord,
  dayId: string,
  attempts: AttemptRecord[],
  now = Date.now(),
): StudyPlanRecord {
  const p = editableDay(record, dayId, attempts);
  if (p.status !== "revision_required")
    throw new Error("Revision is available after the attempt limit is reached.");
  return {
    ...record,
    updatedAt: now,
    days: {
      ...record.days,
      [dayId]: {
        ...record.days[dayId],
        cycles: record.days[dayId].cycles.map((c) =>
          c.index === p.cycle.index ? { ...c, revisionCompletedAt: now } : c,
        ),
      },
    },
  };
}
export async function attachRewrite(
  record: StudyPlanRecord,
  dayId: string,
  exam: ExamRecord,
  attempts: AttemptRecord[],
  now = Date.now(),
): Promise<StudyPlanRecord> {
  const p = editableDay(record, dayId, attempts),
    saved = record.days[dayId],
    initial = saved.cycles[0].exam.exam,
    policy = progressionPolicy(initial.rules);
  if (p.status !== "revision_required" || p.cycle.revisionCompletedAt === undefined)
    throw new Error("Complete revision before attaching a replacement paper.");
  validateStudyExam(exam, "rewrite.exam.json");
  if (exam.exam.taxonomy.id !== initial.taxonomy.id)
    throw new Error("The replacement paper must use the same taxonomy.");
  if (
    exam.exam.rules.attempts.max !== initial.rules.attempts.max ||
    JSON.stringify(progressionPolicy(exam.exam.rules)) !== JSON.stringify(policy)
  )
    throw new Error(
      "The replacement exam must retain the original pass percentage, attempt limit and rewrite policy.",
    );
  if (exam.exam.paper.some((q) => !q.difficulty))
    throw new Error("Every replacement question needs a difficulty tag.");
  const hard = exam.exam.paper.filter((q) => q.difficulty === policy.difficultyLabel).length;
  if (hard * 100 < policy.rewriteDifficultyPercentage * exam.exam.paper.length)
    throw new Error(
      `The new paper needs at least ${policy.rewriteDifficultyPercentage}% ${policy.difficultyLabel} questions; found ${Math.round((hard / exam.exam.paper.length) * 100)}%.`,
    );
  const fingerprint = await paperFingerprint(exam.exam.paper);
  if (saved.cycles.some((c) => c.fingerprint === fingerprint))
    throw new Error(
      "This paper was already used for this day. Import a different set of questions.",
    );
  return {
    ...record,
    updatedAt: now,
    days: {
      ...record.days,
      [dayId]: {
        ...saved,
        cycles: [
          ...saved.cycles,
          { index: p.cycle.index + 1, exam: structuredClone(exam), fingerprint, assignedAt: now },
        ],
      },
    },
  };
}
