import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { bundledExams, importFiles } from "./library";
import {
  listExams,
  listAttempts,
  listPlans,
  savePlan,
  saveExam,
  saveAttempt,
  loadSolutions,
  type ExamRecord,
  type AttemptRecord,
} from "./storage";
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
  type SelfTag,
  canReleaseScore,
} from "./session";
import { isAnswered } from "./scoring";
import { ExamImportError } from "./schema";
import type { Solution } from "./parser";
import { ExamMarkdown } from "./ExamMarkdown";
import { ExamScreen, ConfidenceChips } from "./ExamScreen";
import { ResultScreen, ReviewScreen, WeaknessDashboard } from "./Reports";
import { StudyPlans } from "./StudyPlans";
import {
  importStudyPlan,
  prepareStudyAttempt,
  assertStudyStart,
  updateStudyTask,
  updateStudyNote,
  completeRevision,
  attachRewrite,
  studyProgress,
  type StudyPlanRecord,
} from "./study-plan";
import { checkpointAttempt, checkpointPlan, clearCheckpoint, recoverPending } from "./recovery";
import "./exams.css";
const errorText = (error: unknown) =>
  error instanceof ExamImportError
    ? error.issues
        .map((i) => `${i.severity.toUpperCase()} · ${i.location}: ${i.message}`)
        .join("\n")
    : error instanceof Error
      ? error.message
      : String(error);
export default function ExamApp() {
  const [library, setLibrary] = useState<ExamRecord[]>([]),
    [attempts, setAttempts] = useState<AttemptRecord[]>([]),
    [current, setCurrent] = useState<AttemptRecord | null>(null),
    [solutions, setSolutions] = useState<Solution[]>([]),
    [view, setView] = useState<"library" | "dashboard" | "study">("library"),
    [plans, setPlans] = useState<StudyPlanRecord[]>([]),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [ack, setAck] = useState(false),
    [now, setNow] = useState(Date.now()),
    [busy, setBusy] = useState(false),
    [storageFailed, setStorageFailed] = useState(false),
    [retry, setRetry] = useState(0);
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
        checkpoint = checkpointAttempt(record);
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
          clearCheckpoint(checkpoint);
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
    [display],
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
        void persist({ ...record, session, analysis }).catch(() => {});
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
        const recovered = recoverPending(storedHistory, storedPlans);
        const history = recovered.attempts,
          savedPlans = recovered.plans;
        if (recovered.tokens.length) {
          await Promise.all([...history.map(saveAttempt), ...savedPlans.map(savePlan)]);
          recovered.tokens.forEach((token) => clearCheckpoint(token));
        }
        const merged = new Map(bundled.exams.map((e) => [e.id, e]));
        saved.forEach((e) => merged.set(e.id, e));
        setLibrary([...merged.values()]);
        attemptsRef.current = history;
        setAttempts(history);
        plansRef.current = savedPlans;
        setPlans(savedPlans);
        if (savedPlans.length) setView("study");
        if (bundled.errors.length) setError(bundled.errors.join("\n"));
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
        .request("localdox-exam-writer", { signal: lockAbort.signal }, async () => {
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
      release();
    };
  }, [persist]);
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
          session =
            record.session.phase === "submitting"
              ? beginReflection(record.session, r)
              : record.session;
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
        setError(`Exam Import · solutions\n${errorText(e)}`);
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
  async function start() {
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
          record.session,
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
  async function importSelected(files: File[]) {
    setBusy(true);
    try {
      const records = await importFiles(files);
      for (const record of records) await saveExam(record);
      setLibrary((old) => {
        const next = new Map(old.map((e) => [e.id, e]));
        records.forEach((e) => next.set(e.id, e));
        return [...next.values()];
      });
      setError("");
    } catch (e) {
      setError(`Exam Import\n${errorText(e)}`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  function persistPlan(record: StudyPlanRecord) {
    let checkpoint;
    try {
      checkpoint = checkpointPlan(record);
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
        clearCheckpoint(checkpoint);
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
  async function importPlan(source: string) {
    setBusy(true);
    try {
      const plan = await importStudyPlan(source, library);
      if (plansRef.current.some((p) => p.id === plan.id))
        throw new Error(
          "This plan already exists. Use its existing progress, or give a different plan a new ID.",
        );
      await persistPlan(plan);
      setError("");
      setView("study");
    } catch (error) {
      setError(`Plan Import\n${errorText(error)}`);
    } finally {
      setBusy(false);
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
      const imported = files ? await importFiles(files) : undefined;
      if (imported && imported.length !== 1)
        throw new Error("Select exactly one replacement exam with its companion files.");
      const replacement = exam ?? imported?.[0];
      if (!replacement) throw new Error("Choose a replacement paper");
      const plan = plansRef.current.find((p) => p.id === planId)!;
      const next = await attachRewrite(plan, dayId, replacement, attemptsRef.current);
      if (imported) {
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
  function journal(id: string, tag: SelfTag) {
    update((s, record) => {
      const tax = record.exam.exam.taxonomy;
      if (s.phase !== "review" || !record.exam.exam.rules.diagnostics.capture.selfTagging)
        throw new Error("Journal unavailable");
      if (
        (tag.cause && !tax.causes.some((c) => c.id === tag.cause)) ||
        (tag.trap && !tax.traps.some((t) => t.id === tag.trap))
      )
        throw new Error("Unknown journal tag");
      return { ...s, journal: { ...s.journal, [id]: tag } };
    });
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
  const r = current?.exam.exam.rules,
    session = current?.session,
    active = session?.phase === "in_progress";
  const studyRecord = current?.study
    ? plans.find((p) => p.id === current.study!.planId)
    : undefined;
  const studyDay =
    studyRecord && current?.study
      ? studyProgress(studyRecord, attempts).find((d) => d.id === current.study!.dayId)
      : undefined;
  return (
    <div className="exam-app">
      <nav className="exam-topbar">
        <Link
          to="/"
          onClick={(e) => {
            if (active) e.preventDefault();
          }}
        >
          Localdox
        </Link>
        <span>/ Exam Sessions</span>
        {!active && (
          <div className="exam-actions">
            <button
              disabled={storageFailed || !ready}
              aria-current={!current && view === "study" ? "page" : undefined}
              onClick={() => {
                clearCurrent();
                setView("study");
              }}
            >
              Study plans
            </button>
            <button
              disabled={storageFailed || !ready}
              aria-current={!current && view === "library" ? "page" : undefined}
              onClick={() => {
                clearCurrent();
                setView("library");
              }}
            >
              Exam library
            </button>
            <button
              disabled={storageFailed || !ready}
              aria-current={!current && view === "dashboard" ? "page" : undefined}
              onClick={() => {
                clearCurrent();
                setView("dashboard");
              }}
            >
              Weakness Dashboard
            </button>
          </div>
        )}
      </nav>
      <div className="exam-shell">
        {error && (
          <div className="exam-error" role="alert">
            <pre>{error}</pre>
            {(current || storageFailed) && (
              <button
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
                {storageFailed ? "Retry saving" : "Dismiss / retry"}
              </button>
            )}
          </div>
        )}
        {!ready ? (
          <p role="status">Opening exam storage… Close any other Exam Session tab to continue.</p>
        ) : (
          <fieldset disabled={busy || storageFailed} className="exam-root-fieldset">
            {!current ? (
              view === "study" ? (
                <StudyPlans
                  plans={plans}
                  attempts={attempts}
                  library={library}
                  onImport={(source) => void importPlan(source)}
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
                  onRevision={(planId, dayId) =>
                    planAction(planId, (plan) => completeRevision(plan, dayId, attemptsRef.current))
                  }
                  onStart={(planId, dayId) => void startStudy(planId, dayId)}
                  onRewrite={(planId, dayId, exam) => void rewriteStudy(planId, dayId, exam)}
                  onRewriteFiles={(planId, dayId, files) =>
                    void rewriteStudy(planId, dayId, undefined, files)
                  }
                  onOpenAttempt={openAttempt}
                />
              ) : view === "dashboard" ? (
                <WeaknessDashboard attempts={attempts} />
              ) : (
                <div className="exam-stack">
                  <header>
                    <p className="exam-eyebrow">PRACTICE WITH PURPOSE</p>
                    <h1>Exam library</h1>
                    <p className="exam-muted">
                      Timed sessions, transparent scoring, and a clearer picture of what to practice
                      next.
                    </p>
                  </header>
                  <div className="exam-actions">
                    <button className="exam-primary" onClick={() => input.current?.click()}>
                      Import exam files
                    </button>
                    <input
                      ref={input}
                      type="file"
                      multiple
                      accept=".json,.md"
                      className="sr-only"
                      aria-label="Import exam files"
                      onChange={(e) => void importSelected(Array.from(e.target.files ?? []))}
                    />
                    <span className="exam-muted">
                      Select ruleset, paper, solutions and taxonomy together.
                    </span>
                  </div>
                  <button className="study-library-link" onClick={() => setView("study")}>
                    <span>
                      <strong>Build a daily study routine</strong>
                      <small>
                        Import a plan, track your work, and unlock each day by passing its exam.
                      </small>
                    </span>
                    <span aria-hidden="true">→</span>
                  </button>
                  <div className="exam-library-grid">
                    {library.map((e) => (
                      <article className="exam-card" key={e.id}>
                        <p className="exam-eyebrow">
                          {e.exam.rules.sampleMode ? "SAMPLE PAPER" : "EXAM"}
                        </p>
                        <h2>{e.exam.rules.meta.name}</h2>
                        <p>
                          {e.exam.paper.length} questions · {e.exam.rules.timing.durationMinutes}{" "}
                          minutes · {e.exam.rules.timing.mode.replaceAll("_", " ")}
                        </p>
                        <button onClick={() => void choose(e)}>View instructions</button>
                      </article>
                    ))}
                  </div>
                  <section className="exam-card">
                    <h2>Past attempts</h2>
                    {!attempts.length && <p>Your attempts will appear here.</p>}
                    {[...attempts]
                      .sort((a, b) => b.session.createdAt - a.session.createdAt)
                      .map((a) => (
                        <div className="exam-row exam-actions" key={a.id}>
                          <span>
                            {a.exam.exam.rules.meta.name}
                            {a.session.demo ? " · demo" : ""}
                            <small>
                              {new Date(a.session.createdAt).toLocaleString()} ·{" "}
                              {a.session.phase.replaceAll("_", " ")}
                            </small>
                          </span>
                          {a.analysis && canReleaseScore(a.exam.exam.rules) && (
                            <strong>
                              {a.analysis.score.toFixed(a.exam.exam.rules.results.rounding)} /{" "}
                              {a.analysis.totalMarks}
                            </strong>
                          )}
                          <button
                            onClick={() => {
                              solutionsRef.current = [];
                              setSolutions([]);
                              setError("");
                              display({
                                ...a,
                                session: resumeSession(
                                  a.session,
                                  a.exam.exam.rules,
                                  a.exam.exam.paper,
                                ),
                              });
                            }}
                          >
                            Open attempt
                          </button>
                        </div>
                      ))}
                  </section>
                  {import.meta.env.DEV && (
                    <details className="exam-card">
                      <summary>Developer demos</summary>
                      <p>
                        Load a submitted fixture that demonstrates every default diagnostic rule.
                      </p>
                      <button onClick={() => void loadDemo()}>Load diagnostic demo</button>
                    </details>
                  )}
                </div>
              )
            ) : session!.phase === "instructions" ? (
              <div className="exam-stack">
                <h1>{r!.meta.name}</h1>
                <section className="exam-card">
                  <ExamMarkdown source={r!.meta.instructionsMd} />
                </section>
                <section className="exam-card">
                  <h2>Session rules</h2>
                  <p>
                    {r!.timing.durationMinutes} minutes · {r!.timing.mode.replaceAll("_", " ")}{" "}
                    timer ·{" "}
                    {r!.timing.pausable ? "pausing allowed" : "clock continues when you leave"}
                  </p>
                  {r!.sections.map((s) => (
                    <p key={s.id}>
                      {s.name}: {s.questionCount} questions
                      {s.durationMinutes ? ` · ${s.durationMinutes} minutes` : ""}
                    </p>
                  ))}
                  {Object.entries(r!.questionTypes).map(([type, config]) => (
                    <p key={type}>
                      {type.toUpperCase()}:{" "}
                      {config.negativeMarking
                        ? "marks" in config.negativeMarking
                          ? `${config.negativeMarking.marks} marks deducted`
                          : `${config.negativeMarking.fractionOfMarks.join("/")} of question marks deducted`
                        : "no negative marking"}
                      {"scoring" in config ? ` · ${config.scoring.replaceAll("_", " ")}` : ""}
                    </p>
                  ))}
                  <p>
                    {r!.integrity.requireFullscreen ? "Fullscreen required. " : ""}
                    {r!.integrity.blockCopyPaste ? "Copy/paste blocked. " : ""}
                    {r!.navigation.markedForReviewAnswerCounts
                      ? "Answers marked for review count."
                      : "Answers marked for review do not count."}
                  </p>
                  <p>
                    Integrity policy: {r!.integrity.onViolation.replaceAll("_", " ")}; allowed
                    violations: {r!.integrity.maxTabSwitches ?? "unlimited"}.
                  </p>
                </section>
                <section className="exam-card">
                  <h2>Exam Import report</h2>
                  <p>
                    Ruleset and paper validated. Solutions stay sealed until submission; their
                    validation report appears if grading encounters an error.
                  </p>
                  {current.exam.exam.issues.map((issue, i) => (
                    <p key={i}>
                      {issue.location}: {issue.message}
                    </p>
                  ))}
                </section>
                <label className="exam-ack">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />{" "}
                  I have read and acknowledge the exam rules.
                </label>
                <button
                  className="exam-primary"
                  disabled={!ack || busy}
                  onClick={() => void start()}
                >
                  Start exam
                </button>
              </div>
            ) : active ? (
              <ExamScreen
                exam={current.exam.exam}
                session={session!}
                now={now}
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
            ) : session!.phase === "reflection" ? (
              <div className="exam-stack">
                <h1>Before you see the answers</h1>
                <p>
                  How confident were you? This optional reflection helps distinguish guesses from
                  overconfidence.
                </p>
                {current.exam.exam.paper
                  .filter((q) => isAnswered(questionState(session!, q.id).response))
                  .map((q) => (
                    <section key={q.id} className="exam-card">
                      <h2>{q.id}</h2>
                      <ExamMarkdown source={q.body} />
                      <p>Your answer: {String(questionState(session!, q.id).response)}</p>
                      <ConfidenceChips
                        levels={r!.diagnostics.capture.confidence.levels}
                        value={session!.confidence[q.id] ?? "none"}
                        onChange={(c) =>
                          update((s, a) => setConfidence(s, a.exam.exam.rules, q.id, c))
                        }
                      />
                    </section>
                  ))}
                <div className="exam-actions">
                  <button
                    className="exam-primary"
                    disabled={!solutions.length}
                    onClick={() => update((s) => finishReflection(s))}
                  >
                    Show result
                  </button>
                  <button
                    disabled={!solutions.length}
                    onClick={() => update((s) => finishReflection({ ...s, confidence: {} }))}
                  >
                    Skip reflection
                  </button>
                </div>
              </div>
            ) : session!.phase === "review" && current.analysis && solutions.length ? (
              <ReviewScreen
                attempt={current}
                solutions={solutions}
                onJournal={journal}
                onBack={() => update((s) => ({ ...s, phase: "submitted" }))}
              />
            ) : session!.phase === "submitted" && current.analysis ? (
              <ResultScreen
                attempt={current}
                studyDay={studyDay}
                onStudyPlan={() => {
                  clearCurrent();
                  setView("study");
                }}
                onReview={() => update((s, a) => openReview(s, a.exam.exam.rules))}
              />
            ) : (
              <div role="status" className="exam-card">
                <h1>Submission saved</h1>
                <p>Loading and validating solutions before grading…</p>
                <button onClick={() => setRetry((n) => n + 1)}>Retry grading</button>
                {error && (
                  <label>
                    Replace a malformed solutions file
                    <input
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
            )}
          </fieldset>
        )}
      </div>
    </div>
  );
}
