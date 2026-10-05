import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LEGACY_EXAM_WORKSPACE } from "@/lib/workspace/kinds";
import * as examStorage from "./storage";
import { workspaceRecoveryStore } from "./recovery";
import { bundledExams } from "./library";
import { readBundle } from "./bundle";
import { EXAMPLE_SETUP, exampleExamFile } from "./examples";
import {
  examUpload,
  readExamFile,
  readPracticeFile,
  type ExamFileContent,
  type ExamSetup,
} from "./exam-setup";
import { loadSolutions, type ExamRecord, type AttemptRecord } from "./storage";
import { analyzeAttempt } from "./diagnostics";
import {
  createSession,
  showInstructions,
  startSession,
  assertAttemptLimit,
  resumeSession,
  observeSession,
  tick,
  setAnswer,
  navigate,
  markQuestion,
  submitSession,
  beginReflection,
  finishReflection,
  openReview,
  recordIntegrity,
  questionState,
  finishSection,
  pauseSession,
  unpauseSession,
  setConfidence,
  type Session,
} from "./session";
import { ExamImportError } from "./schema";
import type { Solution } from "./parser";
import type { Response } from "./scoring";
import { ExamScreen, type SaveState } from "./ExamScreen";
import { ResultScreen, ReviewScreen } from "./Reports";
import { PracticeScreen } from "./PracticeScreen";
import { ExamWorkspace } from "./ExamWorkspace";
import { InstructionsScreen } from "./Instructions";
import { type ContinueItem } from "./LibraryScreen";
import { Button, Skeleton, Toast, ToastRegion } from "./ui/kit";
import { describeImportIssues, formatDateTime, formatDuration } from "./ui/display";
import {
  importStudyPlan,
  prepareStudyAttempt,
  assertStudyStart,
  updateStudyTask,
  updateStudyNote,
  completeRevision,
  attachRewrite,
  studyProgress,
  markLearned,
  answerPractice,
  addPractice,
  markReviewed,
  createExamPlan,
  attachExamFile,
  type StudyPlanRecord,
} from "./study-plan";
import { checkpointAttempt, checkpointPlan, clearCheckpoint, recoverPending } from "./recovery";
import "./exams.css";
const errorText = (error: unknown) =>
  error instanceof ExamImportError
    ? describeImportIssues(error.issues)
    : error instanceof Error
      ? error.message
      : String(error);
export default function ExamApp({
  workspaceId,
  onImmersive,
}: {
  onImmersive: (active: boolean) => void;
  workspaceId: string;
}) {
  const scope = workspaceId === LEGACY_EXAM_WORKSPACE ? undefined : workspaceId;
  const journal = useMemo(() => workspaceRecoveryStore(scope), [scope]);
  const { listExams, listAttempts, listPlans, saveExam, saveAttempt, savePlan } = useMemo(
    () => ({
      listExams: () => examStorage.listExams(scope),
      listAttempts: () => examStorage.listAttempts(scope),
      listPlans: () => examStorage.listPlans(scope),
      saveExam: (record: ExamRecord) => examStorage.saveExam(record, scope),
      saveAttempt: (record: AttemptRecord) => examStorage.saveAttempt(record, scope),
      savePlan: (record: StudyPlanRecord) => examStorage.savePlan(record, scope),
    }),
    [scope],
  );
  const [library, setLibrary] = useState<ExamRecord[]>([]),
    [attempts, setAttempts] = useState<AttemptRecord[]>([]),
    [current, setCurrent] = useState<AttemptRecord | null>(null),
    [solutions, setSolutions] = useState<Solution[]>([]),
    [practicing, setPracticing] = useState<{ planId: string; dayId: string } | null>(null),
    [plans, setPlans] = useState<StudyPlanRecord[]>([]),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [ack, setAck] = useState(false),
    [now, setNow] = useState(Date.now()),
    [busy, setBusy] = useState(false),
    [storageFailed, setStorageFailed] = useState(false),
    [retry, setRetry] = useState(0),
    [saveState, setSaveState] = useState<SaveState>("idle");

  // Author/developer surfaces (import reports, event logs, demos) stay behind ?dev=1.
  const dev = useMemo(
    () =>
      typeof location !== "undefined" && new URLSearchParams(location.search).get("dev") === "1",
    [],
  );
  const currentRef = useRef<AttemptRecord | null>(null),
    plansRef = useRef<StudyPlanRecord[]>([]),
    attemptsRef = useRef<AttemptRecord[]>([]),
    solutionsRef = useRef<Solution[]>([]),
    grading = useRef<string | null>(null),
    saveQueue = useRef(Promise.resolve()),
    input = useRef<HTMLInputElement>(null),
    hasLock = useRef(false);
  const display = useCallback((record: AttemptRecord | null) => {
    currentRef.current = record;
    setCurrent(record);
  }, []);
  const persist = useCallback(
    (record: AttemptRecord) => {
      let checkpoint;
      try {
        checkpoint = checkpointAttempt(record, journal);
      } catch (error) {
        setStorageFailed(true);
        setError(`Could not save recovery data. ${errorText(error)}`);
        return Promise.reject(error);
      }
      display(record);
      attemptsRef.current = [...attemptsRef.current.filter((a) => a.id !== record.id), record];
      setAttempts(attemptsRef.current);
      const operation = saveQueue.current
        .then(() => saveAttempt(record))
        .then((result) => {
          clearCheckpoint(checkpoint, journal);
          return result;
        });
      saveQueue.current = operation
        .then(() => undefined)
        .catch((e) => {
          setStorageFailed(true);
          setError(
            `Could not save this attempt. ${errorText(e)} Keep this tab open and retry saving.`,
          );
        });
      return operation;
    },
    [display, journal, saveAttempt],
  );
  const update = useCallback(
    (change: (session: Session, record: AttemptRecord) => Session) => {
      const record = currentRef.current;
      if (!record || !hasLock.current) return;
      try {
        const expired = tick(record.session, record.exam.exam.rules, record.exam.exam.paper);
        const session = expired.phase !== record.session.phase ? expired : change(expired, record);
        const analysis =
          ["submitted", "review"].includes(session.phase) && solutionsRef.current.length
            ? analyzeAttempt(
                record.exam.exam.rules,
                record.exam.exam.taxonomy,
                record.exam.exam.paper,
                solutionsRef.current,
                session,
              )
            : record.analysis;
        setSaveState("saving");
        void persist({ ...record, session, analysis })
          .then(() => setSaveState("saved"))
          .catch(() => setSaveState("error"));
      } catch (e) {
        setError(errorText(e));
      }
    },
    [persist],
  );
  useEffect(() => {
    let alive = true,
      release: () => void = () => {};
    const lockAbort = new AbortController();
    async function initialize() {
      try {
        const [bundled, saved, storedHistory, storedPlans] = await Promise.all([
          bundledExams(),
          listExams(),
          listAttempts(),
          listPlans(),
        ]);
        if (!alive) return;
        const recovered = recoverPending(storedHistory, storedPlans, journal);
        const history = recovered.attempts,
          savedPlans = recovered.plans;
        if (recovered.tokens.length) {
          await Promise.all([...history.map(saveAttempt), ...savedPlans.map(savePlan)]);
          recovered.tokens.forEach((token) => clearCheckpoint(token, journal));
        }
        const merged = new Map(bundled.exams.map((e) => [e.id, e]));
        saved.forEach((e) => merged.set(e.id, e));
        setLibrary([...merged.values()]);
        attemptsRef.current = history;
        setAttempts(history);
        plansRef.current = savedPlans;
        setPlans(savedPlans);
        // Broken bundled files are an author problem, not a learner one.
        if (bundled.errors.length) {
          console.warn("Exam Workspaces: bundled exams failed to load", bundled.errors);
          if (dev) setError(bundled.errors.join("\n"));
        }
        const active = history
          .filter((a) =>
            ["instructions", "in_progress", "submitting", "reflection"].includes(a.session.phase),
          )
          .sort((a, b) => b.session.createdAt - a.session.createdAt)[0];
        if (active) {
          let session = resumeSession(
            active.session,
            active.exam.exam.rules,
            active.exam.exam.paper,
          );
          if (session.phase === "in_progress")
            session = recordIntegrity(session, active.exam.exam.rules, "tab_visible");
          await persist({ ...active, session });
        }
        setReady(true);
      } catch (e) {
        if (alive) setError(errorText(e));
      }
    }
    if (navigator.locks) {
      void navigator.locks
        .request(examStorage.examWriterLock(scope), { signal: lockAbort.signal }, async () => {
          if (!alive) return;
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          hasLock.current = true;
          await initialize();
          await held;
          hasLock.current = false;
        })
        .catch((error) => {
          if (alive && error.name !== "AbortError") setError(errorText(error));
        });
    } else {
      setError(
        "This browser does not support exclusive local exam storage. Use a current browser.",
      );
    }
    return () => {
      alive = false;
      lockAbort.abort();
      void saveQueue.current.finally(release);
    };
  }, [persist, dev, scope, journal, listExams, listAttempts, listPlans, saveAttempt, savePlan]);
  useEffect(() => {
    let previousTick = Date.now();
    const interval = window.setInterval(() => {
      const record = currentRef.current;
      if (!record) return;
      const timestamp = Date.now(),
        release = Date.parse(record.exam.exam.rules.results.releaseAt ?? "");
      if (
        record.session.phase === "in_progress" ||
        (previousTick < release && timestamp >= release)
      )
        setNow(timestamp);
      previousTick = timestamp;
      const next = observeSession(
        tick(record.session, record.exam.exam.rules, record.exam.exam.paper),
      );
      if (next !== record.session) void persist({ ...record, session: next }).catch(() => {});
    }, 500);
    return () => clearInterval(interval);
  }, [persist]);
  useEffect(() => {
    const phase = current?.session.phase;
    if (
      !current ||
      !["submitting", "reflection", "submitted", "review"].includes(phase!) ||
      solutionsRef.current.length ||
      grading.current === current.id
    )
      return;
    grading.current = current.id;
    const id = current.id;
    void loadSolutions(current.exam, current.session)
      .then(async (loaded) => {
        if (currentRef.current?.id !== id) return;
        solutionsRef.current = loaded.solutions;
        setSolutions(loaded.solutions);
        const record = currentRef.current!,
          r = record.exam.exam.rules,
          reflecting =
            record.session.phase === "submitting"
              ? beginReflection(record.session, r)
              : record.session,
          // Confidence reflection is not part of this product; skip it.
          session =
            reflecting.phase === "reflection"
              ? finishReflection({ ...reflecting, confidence: {} })
              : reflecting;
        const analysis = ["submitted", "review"].includes(session.phase)
          ? analyzeAttempt(
              r,
              record.exam.exam.taxonomy,
              record.exam.exam.paper,
              loaded.solutions,
              session,
            )
          : undefined;
        await persist({ ...record, session, analysis: analysis ?? record.analysis });
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      })
      .catch((e) => {
        setError(`The solutions file couldn't be read.\n${errorText(e)}`);
      })
      .finally(() => {
        if (grading.current === id) grading.current = null;
      });
  }, [current, persist, retry]);
  useEffect(() => {
    function integrity(type: "tab_hidden" | "tab_visible" | "fullscreen_exit") {
      const record = currentRef.current;
      if (record?.session.phase === "in_progress")
        update((s, a) => recordIntegrity(s, a.exam.exam.rules, type));
    }
    const visibility = () => integrity(document.hidden ? "tab_hidden" : "tab_visible");
    const fullscreen = () => {
      if (!document.fullscreenElement) integrity("fullscreen_exit");
    };
    const pagehide = () => integrity("tab_hidden");
    const prevent = (event: Event) => {
      const record = currentRef.current;
      if (record?.session.phase !== "in_progress") return;
      const rules = record.exam.exam.rules.integrity;
      if (event.type === "contextmenu" ? rules.blockContextMenu : rules.blockCopyPaste)
        event.preventDefault();
    };
    const beforeunload = (event: BeforeUnloadEvent) => {
      if (currentRef.current?.session.phase === "in_progress") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("fullscreenchange", fullscreen);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("beforeunload", beforeunload);
    ["copy", "cut", "paste", "contextmenu"].forEach((type) =>
      document.addEventListener(type, prevent),
    );
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("fullscreenchange", fullscreen);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("beforeunload", beforeunload);
      ["copy", "cut", "paste", "contextmenu"].forEach((type) =>
        document.removeEventListener(type, prevent),
      );
    };
  }, [update]);
  function clearCurrent() {
    display(null);
    solutionsRef.current = [];
    setSolutions([]);
    setError("");
    setAck(false);
    setSaveState("idle");
  }
  async function choose(exam: ExamRecord) {
    try {
      const count = attempts.filter(
        (a) =>
          a.session.examId === exam.id &&
          a.session.startedAt !== undefined &&
          !a.session.demo &&
          !a.study,
      ).length;
      if (exam.exam.rules.attempts.max !== null && count >= exam.exam.rules.attempts.max)
        throw new Error("The attempt limit for this exam has been reached.");
      setAck(false);
      solutionsRef.current = [];
      setSolutions([]);
      setError("");
      const session = showInstructions(
        createSession(exam.exam.rules, exam.exam.paper, exam.exam.taxonomy.id),
      );
      await persist({ id: session.id, exam, session });
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function start(scale = 1) {
    const record = currentRef.current;
    if (!record) return;
    setBusy(true);
    try {
      // The initial exam snapshot must exist before the first timed state.
      await saveQueue.current;
      if (record.study) {
        const plan = plansRef.current.find((p) => p.id === record.study!.planId);
        if (!plan) throw new Error("Study plan is unavailable");
        assertStudyStart(plan, record, attemptsRef.current);
      } else {
        assertAttemptLimit(
          record.exam.exam.rules,
          attemptsRef.current.filter((a) => !a.study).map((a) => a.session),
        );
      }
      if (record.exam.exam.rules.integrity.requireFullscreen && !document.fullscreenElement)
        await document.documentElement.requestFullscreen();
      await persist({
        ...record,
        session: startSession(
          scale < 1 ? { ...record.session, timeScale: scale } : record.session,
          record.exam.exam.rules,
          ack,
          !!document.fullscreenElement,
        ),
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  /** One import for everything: a zip or loose plan, exam and practice files. */
  async function importAll(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    try {
      const bundle = await readBundle(files);
      if (bundle.practice.length && !bundle.plan)
        throw new Error(
          "Practice files belong to a day. Open the day and use Practice → Add questions.",
        );
      for (const record of bundle.exams) await saveExam(record);
      const merged = new Map(library.map((e) => [e.id, e]));
      bundle.exams.forEach((e) => merged.set(e.id, e));
      setLibrary([...merged.values()]);
      if (bundle.plan) {
        const plan = await importStudyPlan(
          bundle.plan,
          [...merged.values()],
          Date.now(),
          bundle.practice,
        );
        if (plansRef.current.some((p) => p.id === plan.id))
          throw new Error(
            "This plan is already imported. Keep its progress, or give the new plan a different id.",
          );
        await persistPlan(plan);
      }
      setError("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  /** Step one of a study-plan exam: its rules. Resolves to the plan id. */
  async function createExam(
    setup: ExamSetup,
    content?: (plan: StudyPlanRecord) => Promise<ExamFileContent>,
  ) {
    setBusy(true);
    try {
      let plan = createExamPlan(setup);
      if (content) plan = await attachExamFile(plan, await content(plan));
      await persistPlan(plan);
      setError("");
      return plan.id;
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  /** Step two: the one file with practice, exam, keys and solutions. */
  async function uploadExamFile(planId: string, files: File[]) {
    if (!files.length) return;
    setBusy(true);
    try {
      const plan = plansRef.current.find((p) => p.id === planId);
      if (!plan?.setup) throw new Error("Study plan not found");
      const { name, text, images } = await examUpload(files);
      const content = readExamFile(plan.setup, plan.plan.days[0].examId, text, name, images);
      await persistPlan(await attachExamFile(plan, content));
      setError("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function importExample() {
    const file = await exampleExamFile();
    return createExam(EXAMPLE_SETUP, async (plan) =>
      readExamFile(EXAMPLE_SETUP, plan.plan.days[0].examId, await file.text(), file.name),
    );
  }
  async function downloadExample() {
    try {
      const url = URL.createObjectURL(await exampleExamFile()),
        link = document.createElement("a");
      link.href = url;
      link.download = "example-exam.md";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function addPracticeFiles(planId: string, dayId: string, files: File[]) {
    if (!files.length) return;
    setBusy(true);
    try {
      let sets;
      if (files.some((f) => f.name.endsWith(".practice.md"))) {
        const bundle = await readBundle(files);
        if (!bundle.practice.length || bundle.exams.length || bundle.plan)
          throw new Error("Choose .practice.md files (and any images they use).");
        sets = bundle.practice;
      } else {
        const { name, text, images } = await examUpload(files);
        sets = [readPracticeFile(name.replace(/\.(md|markdown)$/i, ""), text, name, images)];
      }
      planAction(planId, (plan) =>
        sets.reduce((p, set) => addPractice(p, dayId, set, attemptsRef.current), plan),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function persistPlan(record: StudyPlanRecord) {
    let checkpoint;
    try {
      checkpoint = checkpointPlan(record, journal);
    } catch (error) {
      setStorageFailed(true);
      setError(`Could not save study recovery data. ${errorText(error)}`);
      return Promise.reject(error);
    }
    plansRef.current = plansRef.current.some((p) => p.id === record.id)
      ? plansRef.current.map((p) => (p.id === record.id ? record : p))
      : [record, ...plansRef.current];
    setPlans(plansRef.current);
    const operation = saveQueue.current
      .then(() => savePlan(record))
      .then((result) => {
        clearCheckpoint(checkpoint, journal);
        return result;
      });
    saveQueue.current = operation
      .then(() => undefined)
      .catch((error) => {
        setStorageFailed(true);
        setError(
          `Could not save study progress. ${errorText(error)} Keep this tab open and retry.`,
        );
      });
    return operation;
  }
  function planAction(planId: string, change: (plan: StudyPlanRecord) => StudyPlanRecord) {
    try {
      const plan = plansRef.current.find((p) => p.id === planId);
      if (!plan) throw new Error("Study plan not found");
      void persistPlan(change(plan)).catch(() => {});
    } catch (error) {
      setError(errorText(error));
    }
  }
  function openAttempt(attempt: AttemptRecord) {
    solutionsRef.current = [];
    setSolutions([]);
    setError("");
    setAck(false);
    let session = resumeSession(attempt.session, attempt.exam.exam.rules, attempt.exam.exam.paper);
    if (session.phase === "in_progress")
      session = recordIntegrity(session, attempt.exam.exam.rules, "tab_visible");
    void persist({ ...attempt, session }).catch(() => {});
  }
  async function startStudy(planId: string, dayId: string) {
    setBusy(true);
    try {
      const plan = plansRef.current.find((p) => p.id === planId)!;
      const attempt = prepareStudyAttempt(plan, dayId, attemptsRef.current);
      openAttempt(attempt);
      await saveQueue.current;
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  async function rewriteStudy(planId: string, dayId: string, exam?: ExamRecord, files?: File[]) {
    setBusy(true);
    try {
      const plan = plansRef.current.find((p) => p.id === planId)!;
      let imported: ExamRecord[] | undefined;
      if (files && plan.setup) {
        // Same rules as the first paper; only the file's # Exam part is used.
        const { name, text, images } = await examUpload(files),
          id = `${plan.plan.days[0].examId}-${plan.days[dayId].cycles.length + 1}`;
        imported = [readExamFile(plan.setup, id, text, name, images).exam];
      } else if (files) imported = (await readBundle(files)).exams;
      if (imported && imported.length !== 1)
        throw new Error("Select exactly one replacement exam with its companion files.");
      const replacement = exam ?? imported?.[0];
      if (!replacement) throw new Error("Choose a replacement paper");
      const next = await attachRewrite(plan, dayId, replacement, attemptsRef.current);
      // A configured exam's paper lives in its plan, not in the exam library.
      if (imported && !plan.setup) {
        await saveExam(replacement);
        setLibrary((old) => [...old.filter((e) => e.id !== replacement.id), replacement]);
      }
      await persistPlan(next);
      setError("");
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  /** Open an attempt straight at its answer review (Step 4, or a failed try). */
  function reviewAttempt(attempt: AttemptRecord) {
    try {
      openAttempt({
        ...attempt,
        session: openReview(attempt.session, attempt.exam.exam.rules),
      });
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function loadDemo() {
    setBusy(true);
    try {
      const fixture = (await import("../../../exams/gate-2027-da/demo-session.json"))
          .default as Session,
        exam = library.find((e) => e.id === fixture.examId);
      if (!exam) throw new Error("Demo exam is unavailable");
      const session = { ...fixture, id: crypto.randomUUID(), demo: true };
      solutionsRef.current = [];
      setSolutions([]);
      await persist({ id: session.id, exam, session });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const session = current?.session,
    active = session?.phase === "in_progress",
    immersive = active || session?.phase === "instructions" || !!practicing;
  const studyRecord = current?.study
    ? plans.find((p) => p.id === current.study!.planId)
    : undefined;
  const studyDays = studyRecord ? studyProgress(studyRecord, attempts) : [],
    studyIndex = current?.study ? studyDays.findIndex((d) => d.id === current.study!.dayId) : -1,
    studyDay = studyIndex >= 0 ? studyDays[studyIndex] : undefined;
  // Leaving a session, practice or report returns to the one workspace, which
  // re-selects the current topic on its own.
  const go = (_target?: "study" | "library") => {
    clearCurrent();
    setPracticing(null);
  };
  const practicePlan = practicing && plans.find((p) => p.id === practicing.planId),
    practiceDay = practicePlan?.days[practicing!.dayId],
    practiceTitle = practicePlan?.plan.days.find((d) => d.id === practicing!.dayId)?.title ?? "";

  // The one "Continue" banner resumes an unfinished exam. The current topic is
  // already highlighted and selected in the workspace, so it needs no card.
  let continueItem: ContinueItem | undefined;
  const unfinished = attempts
    .filter((a) => a.session.phase === "in_progress" && !a.session.demo)
    .sort((a, b) => b.session.createdAt - a.session.createdAt)[0];
  if (unfinished)
    continueItem = {
      label: "In progress",
      title: unfinished.exam.exam.rules.meta.name,
      meta: `Started ${formatDateTime(unfinished.session.startedAt ?? unfinished.session.createdAt)}`,
      cta: "Resume exam",
      run: () => openAttempt(unfinished),
    };

  const retryAction =
    current || storageFailed ? (
      <Button
        onClick={() => {
          if (storageFailed) {
            void Promise.all([
              ...(current ? [persist(current)] : []),
              ...plansRef.current.map(savePlan),
            ])
              .then(() => {
                setStorageFailed(false);
                setError("");
              })
              .catch(() => {});
          } else {
            setError("");
            setRetry((n) => n + 1);
          }
        }}
      >
        {storageFailed ? "Retry saving" : "Retry"}
      </Button>
    ) : null;

  useEffect(() => {
    onImmersive(immersive);
    return () => onImmersive(false);
  }, [immersive, onImmersive]);
  return (
    <div className="exam-app" data-immersive={immersive}>
      {!ready ? (
        <div className="ex-page" role="status" aria-busy="true">
          <div className="ex-loading">
            <Skeleton height={32} width={220} />
            <p className="ex-small">
              Opening exam storage… If this takes a while, close any other Exam Workspaces tab.
            </p>
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        </div>
      ) : (
        <fieldset disabled={busy || storageFailed} className="exam-root-fieldset">
          {practicing && practicePlan && practiceDay ? (
            <PracticeScreen
              title={practiceTitle}
              sets={practiceDay.practice?.sets ?? []}
              answers={practiceDay.practice?.answers ?? {}}
              onAnswer={(setId, questionId, response: Response) =>
                planAction(practicing.planId, (plan) =>
                  answerPractice(
                    plan,
                    practicing.dayId,
                    setId,
                    questionId,
                    response,
                    attemptsRef.current,
                  ),
                )
              }
              onExit={() => go("study")}
            />
          ) : !current ? (
            <ExamWorkspace
              plans={plans}
              attempts={attempts}
              library={library}
              continueItem={continueItem}
              dev={dev}
              onCreateExam={createExam}
              onUploadExamFile={(planId, files) => void uploadExamFile(planId, files)}
              onImportExample={importExample}
              onDownloadExample={() => void downloadExample()}
              onTask={(planId, dayId, taskId, checked) =>
                planAction(planId, (plan) =>
                  updateStudyTask(plan, dayId, taskId, checked, attemptsRef.current),
                )
              }
              onNote={(planId, dayId, note) =>
                planAction(planId, (plan) =>
                  updateStudyNote(plan, dayId, note, attemptsRef.current),
                )
              }
              onLearned={(planId, dayId) =>
                planAction(planId, (plan) => markLearned(plan, dayId, attemptsRef.current))
              }
              onPractice={(planId, dayId) => setPracticing({ planId, dayId })}
              onAddPractice={(planId, dayId, files) => void addPracticeFiles(planId, dayId, files)}
              onRevision={(planId, dayId) =>
                planAction(planId, (plan) => completeRevision(plan, dayId, attemptsRef.current))
              }
              onStart={(planId, dayId) => void startStudy(planId, dayId)}
              onRewrite={(planId, dayId, exam) => void rewriteStudy(planId, dayId, exam)}
              onRewriteFiles={(planId, dayId, files) =>
                void rewriteStudy(planId, dayId, undefined, files)
              }
              onOpenAttempt={openAttempt}
              onReview={reviewAttempt}
              onStartExam={(exam) => void choose(exam)}
              onImportFiles={(files) => void importAll(files)}
              onLoadDemo={() => void loadDemo()}
            />
          ) : session!.phase === "instructions" ? (
            <InstructionsScreen
              record={current.exam}
              ack={ack}
              busy={busy}
              dev={dev}
              exitLabel={current.study ? "Back to study plan" : "Back to library"}
              onAck={setAck}
              onStart={(scale) => void start(scale)}
              onExit={() => go(current.study ? "study" : "library")}
            />
          ) : active ? (
            <ExamScreen
              exam={current.exam.exam}
              assets={current.exam}
              session={session!}
              now={now}
              saveState={saveState}
              onAnswer={(v) =>
                update((s, a) =>
                  setAnswer(
                    s,
                    a.exam.exam.rules,
                    a.exam.exam.paper.find((q) => q.id === s.currentId)!,
                    v,
                  ),
                )
              }
              onNavigate={(id) =>
                update((s, a) => navigate(s, a.exam.exam.rules, a.exam.exam.paper, id))
              }
              onMark={() =>
                update((s, a) => {
                  const marked = markQuestion(
                      s,
                      a.exam.exam.rules,
                      !questionState(s, s.currentId).marked,
                    ),
                    id = s.order[s.order.indexOf(s.currentId) + 1];
                  if (!id) return marked;
                  try {
                    return navigate(marked, a.exam.exam.rules, a.exam.exam.paper, id);
                  } catch {
                    return marked;
                  }
                })
              }
              onClear={() =>
                update((s, a) =>
                  setAnswer(
                    s,
                    a.exam.exam.rules,
                    a.exam.exam.paper.find((q) => q.id === s.currentId)!,
                    null,
                  ),
                )
              }
              onSubmit={() => update((s) => submitSession(s))}
              onFinishSection={() =>
                update((s, a) => finishSection(s, a.exam.exam.rules, a.exam.exam.paper))
              }
              onPause={() =>
                update((s, a) =>
                  s.pausedAt === undefined
                    ? pauseSession(s, a.exam.exam.rules)
                    : unpauseSession(s, a.exam.exam.rules),
                )
              }
              onConfidence={(c) =>
                update((s, a) => setConfidence(s, a.exam.exam.rules, s.currentId, c))
              }
            />
          ) : session!.phase === "review" && current.analysis && solutions.length ? (
            <ReviewScreen
              attempt={current}
              solutions={solutions}
              dev={dev}
              onBack={() => update((s) => ({ ...s, phase: "submitted" }))}
              onFinish={
                studyDay?.status === "passed" && !studyDay.steps.review
                  ? () => {
                      const { planId, dayId } = current.study!;
                      planAction(planId, (plan) => markReviewed(plan, dayId, attemptsRef.current));
                      go("study");
                    }
                  : undefined
              }
            />
          ) : session!.phase === "submitted" && current.analysis ? (
            <ResultScreen
              attempt={current}
              studyDay={studyDay}
              dev={dev}
              onStudyPlan={() => go("study")}
              onReview={() => update((s, a) => openReview(s, a.exam.exam.rules))}
            />
          ) : (
            <div className="ex-page" role="status">
              <div className="ex-stack" style={{ gap: 16, maxWidth: 560 }}>
                <h1>Submission saved</h1>
                <p className="ex-muted">
                  {error
                    ? "Grading couldn't finish. Your answers are safe."
                    : "Checking your answers…"}
                </p>
                {!error && <Skeleton height={8} width={240} />}
                <div className="ex-row">
                  <Button onClick={() => setRetry((n) => n + 1)}>Retry grading</Button>
                </div>
                {error && (
                  <label className="ex-field" style={{ fontWeight: 500 }}>
                    Replace a malformed solutions file
                    <input
                      className="ex-input"
                      style={{ paddingTop: 10 }}
                      type="file"
                      accept=".md"
                      aria-label="Replace solutions file"
                      onChange={(event) => {
                        const file = event.target.files?.[0],
                          record = currentRef.current;
                        if (!file || !record || record.session.phase !== "submitting") return;
                        solutionsRef.current = [];
                        setSolutions([]);
                        setError("");
                        void persist({
                          ...record,
                          exam: { ...record.exam, solutionFile: file, solutionUrl: undefined },
                        }).catch(() => {});
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
          )}
        </fieldset>
      )}
      <ToastRegion raised={active}>
        {error && (
          <Toast
            actions={
              <>
                {retryAction}
                {!storageFailed && (
                  <Button variant="ghost" onClick={() => setError("")}>
                    Dismiss
                  </Button>
                )}
              </>
            }
          >
            {error}
          </Toast>
        )}
      </ToastRegion>
    </div>
  );
}
