import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, FileCog } from "lucide-react";
import { LEGACY_EXAM_WORKSPACE } from "@/lib/workspace/kinds";
import * as examStorage from "./storage";
import { workspaceRecoveryStore } from "./recovery";
import { readExamFile } from "./exam-setup";
import { loadSolutions, type AttemptRecord } from "./storage";
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
import { ExamScreen, type SaveState } from "./ExamScreen";
import { ResultScreen } from "./Reports";
import { InstructionsScreen, InstructionsSummary } from "./Instructions";
import { ExamPanel } from "./ExamPanel";
import { topicList } from "./topics";
import { Button, EmptyState, LinkButton, Skeleton, Toast, ToastRegion } from "./ui/kit";
import { describeImportIssues, sameResponse, setupFacts } from "./ui/display";
import { isAnswered } from "./scoring";
import { paperPlanId, sourceFingerprint, syncPaperPlan, type RulesLookup } from "./paper-plan";
import {
  prepareStudyAttempt,
  assertStudyStart,
  completeRevision,
  attachRewrite,
  studyProgress,
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
interface TextFile {
  id: string;
  name: string;
  content: string;
}
/**
 * Sitting one `.xam` file, inside the reader. The reader shows this in the
 * paper's place; a timed exam, its result or its review takes over the
 * screen. Keys are read only after submission. What used to be chosen from a
 * list (which exam, which rules) comes from the files.
 */
export default function ExamApp({
  workspaceId,
  paper,
  rules,
  rulesets,
  images,
  onOpenRules,
  onUseRules,
  onCreateRules,
}: {
  workspaceId: string;
  paper: TextFile;
  rules: RulesLookup<TextFile>;
  /** Every ruleset in the workspace, for a paper that needs one chosen. */
  rulesets: { name: string; title: string }[];
  /** Images in the workspace, by file name, for papers that show them. */
  images?: Record<string, Blob>;
  /** Show a ruleset where it is edited (Settings ▸ Exam rules). */
  onOpenRules: (fileId: string) => void;
  /** Name `rulesName` in the paper's header. */
  onUseRules: (rulesName: string) => void;
  /** Make a ruleset with the default rules and name it in the paper. */
  onCreateRules: () => void;
}) {
  const scope = workspaceId === LEGACY_EXAM_WORKSPACE ? undefined : workspaceId;
  const journal = useMemo(() => workspaceRecoveryStore(scope), [scope]);
  const { listAttempts, listPlans, saveAttempt, savePlan } = useMemo(
    () => ({
      listAttempts: () => examStorage.listAttempts(scope),
      listPlans: () => examStorage.listPlans(scope),
      saveAttempt: (record: AttemptRecord) => examStorage.saveAttempt(record, scope),
      savePlan: (record: StudyPlanRecord) => examStorage.savePlan(record, scope),
    }),
    [scope],
  );
  const planId = paperPlanId(paper.id);
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]),
    [current, setCurrent] = useState<AttemptRecord | null>(null),
    [solutions, setSolutions] = useState<Solution[]>([]),
    [plans, setPlans] = useState<StudyPlanRecord[]>([]),
    /** How the paper's plan relates to its files; null until first read. */
    [sync, setSync] = useState<
      { kind: "ok" | "pinned" } | { kind: "error"; message: string } | null
    >(null),
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
    imagesRef = useRef(images),
    hasLock = useRef(false);
  imagesRef.current = images;
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
        const [storedHistory, storedPlans] = await Promise.all([listAttempts(), listPlans()]);
        if (!alive) return;
        const recovered = recoverPending(storedHistory, storedPlans, journal);
        const history = recovered.attempts,
          savedPlans = recovered.plans;
        if (recovered.tokens.length) {
          await Promise.all([...history.map(saveAttempt), ...savedPlans.map(savePlan)]);
          recovered.tokens.forEach((token) => clearCheckpoint(token, journal));
        }
        attemptsRef.current = history;
        setAttempts(history);
        plansRef.current = savedPlans;
        setPlans(savedPlans);
        // An unfinished attempt on this paper resumes when the paper opens.
        const active = history
          .filter(
            (a) =>
              a.study?.planId === planId &&
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
  }, [persist, planId, scope, journal, listAttempts, listPlans, saveAttempt, savePlan]);
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
  // Keep this paper's plan in step with its files. Runs once storage is open
  // and again whenever the paper or its rules are saved.
  const rulesFile = rules.kind === "found" ? rules.file : null;
  useEffect(() => {
    if (!ready || !rulesFile) return;
    let alive = true;
    syncPaperPlan(
      plansRef.current.find((p) => p.id === planId),
      {
        fileId: paper.id,
        paper: { name: paper.name, text: paper.content },
        rules: { name: rulesFile.name, text: rulesFile.content },
        images: imagesRef.current,
      },
      attemptsRef.current,
    )
      .then(async (result) => {
        if (!alive) return;
        if (result.kind === "built") await persistPlan(result.plan);
        if (alive) setSync({ kind: result.kind === "pinned" ? "pinned" : "ok" });
      })
      .catch((e) => {
        if (alive) setSync({ kind: "error", message: errorText(e) });
      });
    return () => {
      alive = false;
    };
    // persistPlan reads refs only; the files are the inputs that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, planId, paper.id, paper.name, paper.content, rulesFile?.name, rulesFile?.content]);
  function clearCurrent() {
    display(null);
    solutionsRef.current = [];
    setSolutions([]);
    setError("");
    setAck(false);
    setSaveState("idle");
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
  async function startExam(dayId: string) {
    setBusy(true);
    try {
      const plan = plansRef.current.find((p) => p.id === planId);
      if (!plan) throw new Error("This paper's plan is unavailable.");
      const attempt = prepareStudyAttempt(plan, dayId, attemptsRef.current);
      openAttempt(attempt);
      await saveQueue.current;
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  /**
   * A new paper after the attempts ran out: the file's current questions,
   * under the rules the first paper was given (rules never change mid-plan).
   * It must still pass the rewrite rules (new questions, enough hard ones).
   */
  async function takeEditedPaper(dayId: string) {
    setBusy(true);
    try {
      const plan = plansRef.current.find((p) => p.id === planId);
      if (!plan?.setup) throw new Error("This paper's plan is unavailable.");
      const id = `${plan.plan.days[0].examId}-${plan.days[dayId].cycles.length + 1}`,
        replacement = readExamFile(
          plan.setup,
          id,
          paper.content,
          paper.name,
          imagesRef.current,
        ).exam,
        revised =
          plan.days[dayId].cycles.at(-1)?.revisionCompletedAt !== undefined
            ? plan
            : completeRevision(plan, dayId, attemptsRef.current),
        next = await attachRewrite(revised, dayId, replacement, attemptsRef.current);
      const fingerprint =
        rules.kind === "found" ? sourceFingerprint(rules.file.content, paper.content) : "";
      await persistPlan({ ...next, source: { fileId: paper.id, fingerprint } });
      setSync({ kind: "ok" });
      setError("");
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  /** Open a submitted attempt straight at its answer review. */
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
  // Only the timed part covers the screen. Afterwards the result and its
  // answers sit in the reader, beside the workspace.
  const session = current?.session,
    active = session?.phase === "in_progress",
    immersive = active || session?.phase === "instructions",
    reporting = !!current && !immersive;
  const studyRecord = current?.study
    ? plans.find((p) => p.id === current.study!.planId)
    : undefined;
  const studyDays = studyRecord ? studyProgress(studyRecord, attempts) : [],
    studyIndex = current?.study ? studyDays.findIndex((d) => d.id === current.study!.dayId) : -1,
    studyDay = studyIndex >= 0 ? studyDays[studyIndex] : undefined;
  // Leaving a session or report returns to the paper.
  const backToPaper = clearCurrent;

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

  const paperRecord = plans.find((p) => p.id === planId);
  const item = paperRecord ? topicList([paperRecord], attempts)[0] : undefined;

  let panel: ReactNode;
  if (rules.kind === "missing" || rules.kind === "ambiguous")
    panel = (
      <EmptyState
        icon={<FileCog size={24} />}
        title={
          rules.kind === "ambiguous"
            ? "Choose this paper's rules"
            : rules.tagged
              ? "This paper's rules are missing"
              : "This paper needs rules"
        }
        actions={<RulesPicker rulesets={rulesets} onUse={onUseRules} onCreate={onCreateRules} />}
      >
        {rules.kind === "ambiguous" ? (
          <>
            {rules.files.map((f) => f.name).join(", ")} could all apply. Pick one and the paper will
            name it.
          </>
        ) : rules.tagged ? (
          <>
            It uses <code>{rules.tagged}</code>, which isn't in this workspace. Restore it from the
            Bin, or pick other rules.
          </>
        ) : (
          <>
            Time, pass mark, attempts and marking come from a ruleset. Pick one, or start a new one
            and adjust it in Settings ▸ Exam rules.
          </>
        )}
      </EmptyState>
    );
  else if (sync?.kind === "error")
    panel = (
      <section className="ex-surface xp-step-panel xf-problems" role="alert">
        <p className="xf-problems-title">
          <CircleAlert size={16} aria-hidden="true" /> This exam can't open yet
        </p>
        <p className="xf-problems-list">{sync.message}</p>
        <div className="ex-row">
          <Button onClick={() => onOpenRules(rules.file.id)}>Edit {rules.file.name}</Button>
        </div>
      </section>
    );
  else if (!item || !sync)
    panel = (
      <div className="ex-stack" role="status" aria-busy="true" style={{ gap: 16 }}>
        <Skeleton height={56} />
        <Skeleton height={160} />
      </div>
    );
  else
    panel = (
      <>
        <p className="ex-meta tabular xf-facts">
          {paperRecord?.setup &&
            setupFacts(paperRecord.setup).map((fact) => <span key={fact}>{fact}</span>)}
          <span>
            Rules:{" "}
            <LinkButton onClick={() => onOpenRules(rules.file.id)}>{rules.file.name}</LinkButton>
          </span>
        </p>
        {sync.kind === "pinned" && (
          <p className="ex-small xf-pinned" role="note">
            Edited since your first attempt. Scores and attempt limits keep the version you started
            with; to start over with these files, duplicate the paper.
          </p>
        )}
        <ExamPanel
          item={item}
          paperName={paper.name}
          onStart={() => void startExam(item.topic.id)}
          onUseEditedPaper={() => void takeEditedPaper(item.topic.id)}
          onOpenAttempt={openAttempt}
          onReview={reviewAttempt}
        />
      </>
    );

  const immersiveContent =
    !current || !immersive ? null : session!.phase === "instructions" ? (
      <InstructionsScreen
        record={current.exam}
        ack={ack}
        busy={busy}
        dev={dev}
        exitLabel="Back to paper"
        onAck={setAck}
        onStart={(scale) => void start(scale)}
        onExit={backToPaper}
      />
    ) : active ? (
      <ExamScreen
        exam={current.exam.exam}
        assets={current.exam}
        session={session!}
        now={now}
        saveState={saveState}
        instructions={
          <InstructionsSummary
            record={current.exam}
            dev={false}
            scale={current.session.timeScale ?? 1}
          />
        }
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
        onNavigate={(id) => update((s, a) => navigate(s, a.exam.exam.rules, a.exam.exam.paper, id))}
        onSave={(response, step) =>
          // Save & next and Mark for review & next are one step, saved together.
          update((s, a) => {
            const rules = a.exam.exam.rules,
              paper = a.exam.exam.paper,
              q = paper.find((q) => q.id === s.currentId)!;
            let next = s;
            if (
              response !== undefined &&
              !sameResponse(response, questionState(next, q.id).response) &&
              (isAnswered(response) || rules.navigation.clearResponse)
            )
              next = setAnswer(next, rules, q, response);
            if (
              step.mark !== undefined &&
              rules.navigation.markForReview &&
              step.mark !== questionState(next, q.id).marked
            )
              next = markQuestion(next, rules, step.mark);
            if (step.nextId)
              try {
                next = navigate(next, rules, paper, step.nextId);
              } catch {
                // The last question the rules let you reach: stay on it, saved.
              }
            return next;
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
        onConfidence={(c) => update((s, a) => setConfidence(s, a.exam.exam.rules, s.currentId, c))}
      />
    ) : null;

  const graded = reporting && ["submitted", "review"].includes(session!.phase) && current!.analysis;
  const reportContent = !reporting ? null : graded ? (
    <ResultScreen
      attempt={current!}
      solutions={solutions}
      studyDay={studyDay}
      focusAnswers={session!.phase === "review"}
      dev={dev}
      onBack={backToPaper}
    />
  ) : (
    <div className="ex-page" role="status">
      <div className="ex-stack" style={{ gap: 16, maxWidth: 560 }}>
        <h1>Submission saved</h1>
        <p className="ex-muted">
          {error ? "Grading couldn't finish. Your answers are safe." : "Checking your answers…"}
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
  );

  const toasts = (
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
  );

  if (!ready)
    return (
      <div className="exam-app exam-app--embedded" role="status" aria-busy="true">
        <div className="ex-loading">
          <Skeleton height={56} />
          <p className="ex-small">
            Opening exam storage… If this takes a while, close this workspace in other tabs or
            panes.
          </p>
          <Skeleton height={160} />
        </div>
        {toasts}
      </div>
    );
  // The instructions and the running exam take the whole screen, above the
  // reader, the way the exam hall does; the paper's panel stays underneath.
  // The result and its answers replace the panel in place.
  return (
    <>
      <div className="exam-app exam-app--embedded">
        <fieldset
          disabled={busy || storageFailed || immersive}
          className="exam-root-fieldset"
          key={reporting ? "report" : "paper"}
        >
          {reporting ? reportContent : panel}
        </fieldset>
        {!immersive && toasts}
      </div>
      {immersive &&
        createPortal(
          <div className="exam-app exam-overlay" data-immersive="true">
            <fieldset disabled={busy || storageFailed} className="exam-root-fieldset">
              {immersiveContent}
            </fieldset>
            {toasts}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Choose the ruleset a paper runs under. Choosing writes its name into the
 * paper's header, the same link the New exam dialog makes.
 */
function RulesPicker({
  rulesets,
  onUse,
  onCreate,
}: {
  rulesets: { name: string; title: string }[];
  onUse: (rulesName: string) => void;
  onCreate: () => void;
}) {
  const [chosen, setChosen] = useState(rulesets[0]?.name ?? "");
  const value = rulesets.some((r) => r.name === chosen) ? chosen : (rulesets[0]?.name ?? "");
  if (!rulesets.length)
    return (
      <Button variant="primary" onClick={onCreate}>
        New ruleset
      </Button>
    );
  return (
    <>
      <select
        className="ex-select"
        aria-label="Ruleset"
        value={value}
        onChange={(e) => setChosen(e.target.value)}
      >
        {rulesets.map((r) => (
          <option key={r.name} value={r.name}>
            {r.title === r.name.replace(/\.xrule$/i, "") ? r.name : `${r.title} (${r.name})`}
          </option>
        ))}
      </select>
      <Button variant="primary" onClick={() => onUse(value)}>
        Use these rules
      </Button>
      <Button variant="ghost" onClick={onCreate}>
        New ruleset
      </Button>
    </>
  );
}
