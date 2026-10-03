import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Download,
  Upload,
  Layers3,
  LoaderCircle,
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square,
  Terminal,
  X,
  Cpu,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  ExternalLink,
} from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { LANGUAGES, traceSchema, type Language, type Trace } from "@/services/code-studio/protocol";
import { importPythonTutor } from "@/services/code-studio/python-tutor";
import { LESSONS, lessonTrace } from "@/services/code-studio/lessons";
import { explain, OPERATIONS } from "@/services/code-studio/operations";
import { execute } from "@/services/code-studio/client";
import { CodeEditor } from "./CodeEditor";
import { Computer, Memory, Structures } from "./Visualizations";
import { FirstProgram } from "./Teaching";
import { TEACHING } from "@/services/code-studio/teaching";
import { presentTrace } from "@/services/code-studio/presentation";
import "./code-studio.css";

const MemoryDiagram = lazy(() =>
  import("./MemoryDiagram").then((m) => ({ default: m.MemoryDiagram })),
);
const INITIAL = LESSONS[0];
type Tab = "structure" | "memory" | "connections" | "computer";
export function CodeStudio() {
  const [language, setLanguage] = useState<Language>("javascript"),
    [source, setSource] = useState(INITIAL.code.javascript),
    [stdin, setStdin] = useState("");
  const [lessonId, setLessonId] = useState(INITIAL.id),
    [recording, setTrace] = useState<Trace>(() => lessonTrace(INITIAL, "javascript")),
    [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [tab, setTab] = useState<Tab>("structure"),
    [course, setCourse] = useState(true),
    [sidebar, setSidebar] = useState(false),
    [moreViews, setMoreViews] = useState(false);
  const [running, setRunning] = useState(false),
    [error, setError] = useState(""),
    [answer, setAnswer] = useState<number | null>(null),
    [completed, setCompleted] = useState<string[]>([]),
    [library, setLibrary] = useState(false),
    [saved, setSaved] = useState(true);
  const [mobile, setMobile] = useState(false),
    [ready, setReady] = useState(false);
  const controller = useRef<AbortController | null>(null),
    runVersion = useRef(0);
  const importInput = useRef<HTMLInputElement>(null);
  const lesson = LESSONS.find((l) => l.id === lessonId) ?? INITIAL;
  const teaching = TEACHING[lesson.id];
  const trace = useMemo(() => presentTrace(recording), [recording]);
  const guided = course && trace.origin === "lesson";
  const step = trace.steps[Math.min(index, trace.steps.length - 1)],
    previous = trace.steps[index - 1];
  const explanation = explain(previous, step),
    stale = trace.source !== source || trace.language !== language;
  const cancel = useCallback(() => {
    runVersion.current++;
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
    setPlaying(false);
  }, []);
  useEffect(() => {
    const media = matchMedia("(max-width: 900px)");
    const resize = () => setMobile(media.matches);
    resize();
    media.addEventListener("change", resize);
    try {
      const stored = JSON.parse(localStorage.getItem("localdox-code-studio-v1") ?? "null");
      if (stored) {
        if (
          ["javascript", "python", "cpp"].includes(stored.language) &&
          typeof stored.source === "string" &&
          stored.source.length <= 50000
        ) {
          setLanguage(stored.language);
          setSource(stored.source);
          const restored =
            LESSONS.find((l) => l.id === stored.lessonId) ??
            LESSONS.find((l) => l.code[stored.language as Language] === stored.source) ??
            INITIAL;
          setLessonId(restored.id);
          setTrace(lessonTrace(restored, stored.language));
          setCourse(
            stored.course !== false && restored.code[stored.language as Language] === stored.source,
          );
        }
        if (Array.isArray(stored.completed))
          setCompleted(stored.completed.filter((id: unknown) => typeof id === "string"));
      }
    } catch {
      /* Storage is optional. */
    }
    setReady(true);
    return () => {
      media.removeEventListener("change", resize);
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          "localdox-code-studio-v1",
          JSON.stringify({ language, source, completed, lessonId, course }),
        );
        setSaved(true);
      } catch {
        setSaved(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [language, source, completed, lessonId, course, ready]);
  useEffect(() => {
    if (!playing || stale) return;
    const timer = setInterval(
      () => {
        if (document.hidden) return;
        setIndex((i) => {
          if (i >= trace.steps.length - 1) {
            setPlaying(false);
            return i;
          }
          return i + 1;
        });
      },
      (guided ? 5500 : 1500) / speed,
    );
    return () => clearInterval(timer);
  }, [playing, speed, trace, stale, guided]);
  const run = useCallback(async () => {
    cancel();
    const version = ++runVersion.current;
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setError("");
    try {
      const result = await execute(language, source, stdin, abort.signal);
      if (runVersion.current === version) {
        setTrace(result);
        setIndex(0);
        setPlaying(false);
      }
    } catch (e) {
      if (runVersion.current === version && !abort.signal.aborted)
        setError(e instanceof Error ? e.message : "Could not run this program.");
    } finally {
      if (runVersion.current === version) {
        setRunning(false);
        controller.current = null;
      }
    }
  }, [language, source, stdin, cancel]);
  const seek = useCallback(
    (i: number) => {
      if (stale || running) return;
      setPlaying(false);
      setIndex(Math.max(0, Math.min(trace.steps.length - 1, i)));
    },
    [trace.steps.length, stale, running],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest("input,textarea,select,button,a,[contenteditable=true]")
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!stale) setPlaying((p) => !p);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        seek(index + 1);
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek(index - 1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index, seek, stale]);
  const selectLesson = (id: string) => {
    const next = LESSONS.find((l) => l.id === id)!;
    cancel();
    setLessonId(id);
    setSource(next.code[language]);
    setTrace(lessonTrace(next, language));
    setIndex(0);
    setError("");
    setAnswer(null);
    setCourse(true);
    setMoreViews(false);
    setTab("structure");
    setSidebar(false);
  };
  const changeLanguage = (value: Language) => {
    cancel();
    setLanguage(value);
    setError("");
    if (source === lesson.code[language]) {
      setSource(lesson.code[value]);
      setTrace(lessonTrace(lesson, value));
      setIndex(0);
    }
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(recording, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${LANGUAGES[trace.language].file}.trace.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importTrace = async (file: File) => {
    cancel();
    const version = runVersion.current;
    try {
      if (file.size > 16000000) throw new Error("Choose a trace smaller than 16 MB.");
      const data = JSON.parse(await file.text());
      if (version !== runVersion.current) return;
      const next = data.version === 1 ? traceSchema.parse(data) : importPythonTutor(data, language);
      setTrace(next);
      setSource(next.source);
      setLanguage(next.language);
      setCourse(false);
      setIndex(0);
      setError("");
    } catch {
      if (version !== runVersion.current) return;
      setError(
        "Could not import this file. Choose a valid Code Studio or Python Tutor JSON trace, up to 16 MB.",
      );
    }
  };
  return (
    <div className={`code-studio ${course ? "cs-guided-mode" : ""}`}>
      <fieldset className="cs-interactive" disabled={!ready} aria-busy={!ready}>
        <header className="cs-header">
          <div className="cs-brand">
            <Link to="/" aria-label="Back to Localdox">
              <ArrowLeft size={17} />
              <span>Localdox</span>
            </Link>
            <span className="cs-slash">/</span>
            <span className="cs-brand-mark">
              <Code2 size={17} />
            </span>
            <strong>Code Studio</strong>
            <span className="cs-preview-tag">PREVIEW</span>
          </div>
          <div className="cs-header-right">
            <input
              ref={importInput}
              type="file"
              accept=".json,application/json"
              hidden
              aria-label="Import execution trace"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importTrace(file);
                e.target.value = "";
              }}
            />
            <button
              className="cs-icon-button"
              onClick={() => importInput.current?.click()}
              title="Import Code Studio or Python Tutor trace"
              aria-label="Import trace"
            >
              <Upload size={17} />
            </button>
            <span className="cs-save-status">
              <i />
              {saved ? "Saved on this device" : "Storage unavailable"}
            </span>
            <button
              className="cs-icon-button"
              onClick={download}
              title="Download this trace"
              aria-label="Download this trace"
            >
              <Download size={17} />
            </button>
          </div>
        </header>
        <div className="cs-shell">
          {sidebar && (
            <aside className="cs-sidebar">
              <div className="cs-sidebar-top">
                <span className="cs-eyebrow">YOUR EXPLORATION</span>
                <button
                  className="cs-icon-button"
                  onClick={() => setSidebar(false)}
                  aria-label="Hide foundations"
                >
                  <PanelLeftClose size={16} />
                </button>
              </div>
              <button
                className={`cs-nav-item ${!course ? "is-selected" : ""}`}
                onClick={() => setCourse(false)}
              >
                <Code2 size={17} />
                <span>Try my own code</span>
                <span className="cs-shortcut">⌘ ↵</span>
              </button>
              <button
                className={`cs-nav-item ${course ? "is-selected" : ""}`}
                onClick={() => selectLesson(lessonId)}
              >
                <BookOpen size={17} />
                <span>Learn step by step</span>
                <small>
                  {completed.length}/{LESSONS.length}
                </small>
              </button>
              <div className="cs-course-heading">
                <h2>Small steps. Big ideas.</h2>
                <p>Learn by watching things happen.</p>
              </div>
              <nav aria-label="Foundation lessons" className="cs-lessons">
                {LESSONS.map((l, i) => (
                  <div key={l.id}>
                    {(i === 0 || l.chapter !== LESSONS[i - 1].chapter) && <h3>{l.chapter}</h3>}
                    <button
                      className={`cs-lesson-button ${lessonId === l.id ? "is-current" : ""}`}
                      onClick={() => selectLesson(l.id)}
                    >
                      <span
                        className={`cs-lesson-number ${completed.includes(l.id) ? "is-complete" : ""}`}
                      >
                        {completed.includes(l.id) ? (
                          <Check size={12} />
                        ) : (
                          String(i + 1).padStart(2, "0")
                        )}
                      </span>
                      <span>{l.title}</span>
                    </button>
                  </div>
                ))}
              </nav>
              <div className="cs-sidebar-bottom">
                <div className="cs-progress-track">
                  <span style={{ width: `${(completed.length / LESSONS.length) * 100}%` }} />
                </div>
                <p>
                  {completed.length} of {LESSONS.length} lessons completed.
                </p>
                <button className="cs-nav-item" onClick={() => setLibrary(true)}>
                  <Layers3 size={16} />
                  <span>Operation library</span>
                  <ArrowRight size={15} />
                </button>
              </div>
            </aside>
          )}
          <main className="cs-main">
            <div className="cs-title-row">
              <div>
                {!sidebar && (
                  <button
                    className="cs-lessons-toggle"
                    onClick={() => setSidebar(true)}
                    aria-label="Show foundations"
                  >
                    <PanelLeftOpen size={18} />
                    Lessons
                  </button>
                )}
                <h1>{course ? lesson.title : "See what your code does."}</h1>
              </div>
              <div className="cs-mode-switch" role="group" aria-label="Learning mode">
                <button
                  aria-pressed={course}
                  onClick={() => {
                    if (!course) {
                      setSidebar(true);
                      return;
                    }
                    setCourse(true);
                    setPlaying(false);
                    setTab("structure");
                  }}
                >
                  <BookOpen size={16} /> Learn step by step
                </button>
                <button
                  aria-pressed={!course}
                  onClick={() => {
                    setCourse(false);
                    setPlaying(false);
                  }}
                >
                  <Code2 size={16} /> Try my own code
                </button>
              </div>
            </div>
            <section className="cs-workbench" aria-label="Code visualization workspace">
              <ResizablePanelGroup
                key={mobile ? "mobile" : "desktop"}
                orientation={mobile ? "vertical" : "horizontal"}
                style={{ height: mobile ? 740 : "clamp(500px, calc(100dvh - 240px), 850px)" }}
              >
                <ResizablePanel
                  defaultSize={mobile ? "34%" : "40%"}
                  minSize={mobile ? "230px" : "28%"}
                >
                  <div className="cs-editor-pane">
                    <div className="cs-pane-toolbar">
                      <div className="cs-file-label">
                        <Code2 size={15} />
                        {LANGUAGES[language].file}
                        <span className="cs-dot" />
                      </div>
                      <label className="cs-language-select">
                        <span className="sr-only">Programming language</span>
                        <select
                          value={language}
                          onChange={(e) => changeLanguage(e.target.value as Language)}
                        >
                          {Object.entries(LANGUAGES).map(([id, v]) => (
                            <option key={id} value={id}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <CodeEditor
                      source={source}
                      language={language}
                      line={
                        stale
                          ? 0
                          : guided
                            ? (teaching.lines?.[language]?.[index] ?? 0)
                            : trace.origin === "lesson"
                              ? 0
                              : step.line
                      }
                      onChange={(text) => {
                        setSource(text);
                        setCourse(false);
                        cancel();
                      }}
                      onRun={run}
                    />
                    <details className="cs-input">
                      <summary>
                        Program input <span>if your code asks for a value</span>
                      </summary>
                      <textarea
                        aria-label="Program input"
                        placeholder="One input per line"
                        value={stdin}
                        onChange={(e) => setStdin(e.target.value)}
                      />
                    </details>
                    <div className="cs-editor-footer">
                      <button className="cs-run-button" onClick={running ? cancel : run}>
                        {running ? (
                          <>
                            <Square size={13} />
                            Stop
                          </>
                        ) : (
                          <>
                            <Play size={13} fill="currentColor" />
                            Run code<kbd>⌘ ↵</kbd>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel minSize={mobile ? "350px" : "34%"}>
                  <div className="cs-visual-pane">
                    <div className="cs-viz-toolbar">
                      {
                        <button
                          className="cs-more-views"
                          aria-expanded={moreViews}
                          onClick={() => {
                            setMoreViews(!moreViews);
                            setTab("structure");
                          }}
                        >
                          {moreViews ? "Back to the picture" : "Look inside the computer"}
                          <ChevronRight size={15} />
                        </button>
                      }
                      <div
                        role="tablist"
                        aria-label="Visualization view"
                        onKeyDown={(event) => {
                          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
                            return;
                          const buttons = Array.from(
                            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
                          );
                          const current = buttons.indexOf(event.target as HTMLButtonElement);
                          const next =
                            event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? buttons.length - 1
                                : (current +
                                    (event.key === "ArrowRight" ? 1 : -1) +
                                    buttons.length) %
                                  buttons.length;
                          event.preventDefault();
                          buttons[next].focus();
                          buttons[next].click();
                        }}
                      >
                        {(
                          [
                            { id: "structure", label: "Structure", icon: Layers3 },
                            { id: "memory", label: "Memory", icon: Terminal },
                            { id: "connections", label: "Connections", icon: GitBranch },
                            { id: "computer", label: "Computer", icon: Cpu },
                          ] as const
                        )
                          .filter((t) => moreViews || t.id === "structure")
                          .map((t) => (
                            <button
                              id={`cs-tab-${t.id}`}
                              key={t.id}
                              role="tab"
                              aria-controls={`cs-panel-${t.id}`}
                              aria-selected={tab === t.id}
                              tabIndex={tab === t.id ? 0 : -1}
                              onClick={() => setTab(t.id)}
                            >
                              <t.icon size={14} />
                              <span>{t.id === "structure" ? "Watch it happen" : t.label}</span>
                            </button>
                          ))}
                      </div>
                    </div>
                    <div className="cs-trace-kind sr-only">
                      <span>
                        <i className={trace.origin === "execution" ? "is-live" : ""} />
                        {trace.origin === "lesson" ? "Guided animation" : "Recorded execution"}
                      </span>
                      <span>
                        {trace.origin === "lesson"
                          ? "Example walkthrough"
                          : `Line ${step.line} · ${step.event}`}
                      </span>
                    </div>
                    {stale && (
                      <div className="cs-stale" role="status">
                        Code changed. Run it to update the visualization.
                      </div>
                    )}
                    {error && (
                      <div className="cs-error" role="alert">
                        <span>{error}</span>
                        <button
                          className="cs-icon-button"
                          onClick={() => setError("")}
                          aria-label="Dismiss error"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                    <div
                      className="cs-stage"
                      role="tabpanel"
                      id={`cs-panel-${tab}`}
                      aria-labelledby={`cs-tab-${tab}`}
                      aria-busy={running}
                    >
                      {running ? (
                        <div className="cs-running">
                          <LoaderCircle className="cs-spin" />
                          <h3>Recording each step…</h3>
                        </div>
                      ) : tab === "structure" ? (
                        guided && lesson.id === "first-instruction" ? (
                          <FirstProgram step={step} />
                        ) : (
                          <Structures step={step} previous={previous} />
                        )
                      ) : tab === "memory" ? (
                        <Memory step={step} />
                      ) : tab === "computer" ? (
                        <Computer step={step} previous={previous} />
                      ) : (
                        <Suspense
                          fallback={<p className="cs-loading">Loading the diagram engine…</p>}
                        >
                          <MemoryDiagram step={step} />
                        </Suspense>
                      )}
                    </div>
                    <div
                      className="cs-explanation cs-caption"
                      aria-live={playing ? "off" : "polite"}
                    >
                      <div>
                        <h3>{explanation.title}</h3>
                        {["error", "limit"].includes(step.event) && <p>{step.message}</p>}
                      </div>
                    </div>
                    {step.stdout && (
                      <div className="cs-scene-output" key={step.stdout}>
                        <Terminal size={17} aria-hidden="true" />
                        <pre aria-label="Program output">{step.stdout}</pre>
                      </div>
                    )}
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
              <div className="cs-transport">
                <div className="cs-playback-buttons">
                  <button
                    className="cs-icon-button"
                    disabled={index === 0 || running || stale}
                    onClick={() => seek(0)}
                    aria-label="First step"
                  >
                    <SkipBack size={15} />
                  </button>
                  <button
                    className="cs-back-step"
                    disabled={index === 0 || running || stale}
                    onClick={() => seek(index - 1)}
                    aria-label="Previous step"
                  >
                    <ChevronLeft size={18} />
                    <span>Back</span>
                  </button>
                  <button
                    className="cs-play-button"
                    disabled={stale || running}
                    onClick={() => {
                      if (index === trace.steps.length - 1) setIndex(0);
                      setPlaying((p) => !p);
                    }}
                    aria-label={playing ? "Pause playback" : "Play visualization"}
                  >
                    {playing ? (
                      <Pause size={15} fill="currentColor" />
                    ) : index === trace.steps.length - 1 ? (
                      <RotateCcw size={16} />
                    ) : (
                      <Play size={15} fill="currentColor" />
                    )}
                    <span>
                      {playing ? "Pause" : index === trace.steps.length - 1 ? "Replay" : "Play"}
                    </span>
                  </button>
                  <button
                    className="cs-next-step"
                    disabled={index === trace.steps.length - 1 || running || stale}
                    onClick={() => seek(index + 1)}
                    aria-label="Next step"
                  >
                    <span>Next step</span>
                    <ChevronRight size={18} />
                  </button>
                  <button
                    className="cs-icon-button"
                    disabled={index === trace.steps.length - 1 || running || stale}
                    onClick={() => seek(trace.steps.length - 1)}
                    aria-label="Last step"
                  >
                    <SkipForward size={15} />
                  </button>
                </div>
                <span className="cs-step-count">
                  Step {index + 1}
                  <span> / {trace.steps.length}</span>
                </span>
                <input
                  aria-label="Execution step"
                  disabled={stale || running}
                  type="range"
                  min={0}
                  max={trace.steps.length - 1}
                  value={index}
                  onChange={(e) => seek(Number(e.target.value))}
                />
                <select
                  aria-label="Playback speed"
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                >
                  {[0.5, 1, 1.5, 2, 3].map((s) => (
                    <option key={s} value={s}>
                      {s}×
                    </option>
                  ))}
                </select>
              </div>
            </section>
            {guided && !stale && index === trace.steps.length - 1 && (
              <section className="cs-checkpoint">
                <span className="cs-eyebrow">YOUR TURN</span>
                <h2>{lesson.question}</h2>
                <div>
                  {lesson.answers.map((a, i) => (
                    <button
                      key={a}
                      className={
                        answer === i ? (i === lesson.correct ? "is-correct" : "is-incorrect") : ""
                      }
                      onClick={() => {
                        setAnswer(i);
                        if (i === lesson.correct)
                          setCompleted((v) => (v.includes(lesson.id) ? v : [...v, lesson.id]));
                      }}
                    >
                      {a}
                      {answer === i && i === lesson.correct && <Check size={16} />}
                    </button>
                  ))}
                </div>
                {answer !== null && (
                  <p role="status">
                    {answer === lesson.correct ? "That's right. " : "Try again. "}
                    {lesson.reason}
                  </p>
                )}
                {answer === lesson.correct &&
                  LESSONS.findIndex((l) => l.id === lesson.id) < LESSONS.length - 1 && (
                    <button
                      className="cs-next-lesson"
                      onClick={() =>
                        selectLesson(LESSONS[LESSONS.findIndex((l) => l.id === lesson.id) + 1].id)
                      }
                    >
                      Next lesson
                      <ArrowRight size={16} />
                    </button>
                  )}
              </section>
            )}
            <footer className="cs-bottom-note">
              <details>
                <summary>Scope & credits</summary>
                <p>{trace.notes[0]}</p>
                <p>
                  Memory labels such as 0x1 are stable picture labels, not real machine addresses.
                  Computer animations are teaching models.
                </p>
                <p>
                  JavaScript: synchronous programs in an isolated browser worker. Python and C++: a
                  separately configured isolated runner. DOM, network, asynchronous JavaScript,
                  multithreading, and external packages are not supported. Native-library internals
                  and individual machine instructions are not traced. Snapshot and runtime limits
                  apply.
                </p>
                <p>
                  Logical object views cover arrays, maps, sets, classes, and arbitrary connected
                  structures. Specialized semantic animations are provided by the foundation
                  lessons; not every data structure or micro-operation can be inferred from
                  arbitrary source code.
                </p>
                <p>
                  Architecture informed by{" "}
                  <a
                    href="https://github.com/pathrise-eng/pathrise-python-tutor"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Python Tutor <ExternalLink size={11} />
                  </a>{" "}
                  and{" "}
                  <a href="https://github.com/midudev/alg0.dev" target="_blank" rel="noreferrer">
                    alg0.dev <ExternalLink size={11} />
                  </a>
                  .{" "}
                  <a href="/code-studio-notices.txt" target="_blank" rel="noreferrer">
                    Attribution & license
                  </a>
                  .
                </p>
              </details>
            </footer>
          </main>
        </div>
      </fieldset>
      <Dialog.Root open={library} onOpenChange={setLibrary}>
        <Dialog.Portal>
          <Dialog.Overlay className="cs-modal-backdrop" />
          <Dialog.Content
            className="code-studio cs-library"
            aria-describedby="cs-library-description"
          >
            <div>
              <span className="cs-eyebrow">THE BUILDING BLOCKS</span>
              <button
                autoFocus
                className="cs-icon-button"
                onClick={() => setLibrary(false)}
                aria-label="Close operation library"
              >
                <X size={19} />
              </button>
            </div>
            <Dialog.Title>Small operations. Endless possibilities.</Dialog.Title>
            <Dialog.Description id="cs-library-description">
              A reusable vocabulary for teaching computer science. Recorded execution identifies
              observable changes; the lesson models can explicitly name higher-level operations.
            </Dialog.Description>
            <div className="cs-operation-grid">
              {Object.entries(OPERATIONS).map(([id, [title, copy]]) => (
                <article key={id}>
                  <span>{id}</span>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </article>
              ))}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
