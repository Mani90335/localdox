import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Calculator,
  Check,
  Copy,
  Cpu,
  FileInput,
  Info,
  Keyboard,
  Loader2,
  PencilRuler,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PYODIDE_DOWNLOAD_BYTES } from "virtual:pyodide-assets";
import { copyText } from "@/lib/workspace/share";
import {
  cancelIdleCallbackSafe,
  hasModKey,
  modKeyLabel,
  requestIdleCallbackSafe,
} from "@/lib/platform/keyboard";
import { prepareInput } from "@/services/compute/input";
import { needsAdvanced } from "@/services/compute/advanced/routing";
import {
  OPERATION_LABELS,
  operationLabel,
  type AdvancedOperation,
  type AdvancedParams,
  type AdvancedRequest,
  type AnyOperation,
  type ComputeAnswer,
  type ComputeFailure,
  type ComputeOperation,
  type ComputeRequest,
  type ComputeResult,
} from "@/services/compute/protocol";
import { resultMarkdown, solutionLatex, withLhs } from "@/services/compute/result-markdown";
import type {
  ComputeClient,
  ComputeErrorKind,
  RunOptions,
} from "@/services/compute/compute-client";
import type { MathRendererType } from "@/services/math/types";
import { MathKeyboard } from "../editor/MathKeyboard";
import { AdvancedTools } from "./AdvancedTools";
import { NoteMath } from "./note-blocks";
import { NOTE_COMPONENTS, NOTE_PLUGINS } from "./note-components";
import { NoteRenderContext, type NoteRenderSettings } from "./note-render-context";
import { InsertDialog, type InsertRequest, type InsertTarget } from "./RoughWorkPanel";

export interface ComputeProps {
  /** Adds a block to the end of the open scratchpad (or a new one). */
  onAddToRoughWork: (markdown: string) => void;
  insertTarget: () => InsertTarget | null;
  onInsert: (request: InsertRequest) => void;
}

/** An engine failure, or one of the worker itself (or a cancellation) shaped like one. */
type Failure = Omit<ComputeFailure, "ok" | "op" | "kind"> & {
  kind: ComputeFailure["kind"] | ComputeErrorKind;
};

/** One computation: which engine, and exactly what it was asked. */
type Job =
  | { engine: "basic"; op: ComputeOperation; request: ComputeRequest }
  | { engine: "advanced"; op: AnyOperation; request: AdvancedRequest };

type Outcome = { job: Job; answer: ComputeAnswer } | { job: Job; failure: Failure };

type Client<Request> = Pick<ComputeClient<Request, ComputeResult>, "run" | "stats" | "warm">;

// The engine clients, imported on first use: each module names its worker,
// and the worker holds the engine (services/compute/compute.ts, advanced/advanced.ts).
function lazyClient<Request>(load: () => Promise<Client<Request>>) {
  let promise: Promise<Client<Request>> | null = null;
  return () =>
    (promise ??= load().catch((error) => {
      promise = null; // Offline now; a later attempt may succeed.
      throw error;
    }));
}
const basicClient = lazyClient(() =>
  import("@/services/compute/compute").then((m) => m.computeClient),
);
const advancedClient = lazyClient(() =>
  import("@/services/compute/advanced/advanced").then((m) => m.advancedClient),
);

/** The reader agreed to the advanced engine's download, on this device. */
const CONSENT_KEY = "localdox:advanced-math";
function consented(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === "accepted";
  } catch {
    return false;
  }
}
function rememberConsent() {
  try {
    localStorage.setItem(CONSENT_KEY, "accepted");
  } catch {
    // Asked again next time; nothing else depends on it.
  }
}

const DOWNLOAD_MB = (PYODIDE_DOWNLOAD_BYTES / 1_000_000).toFixed(1);

/**
 * What the tab holds between visits in this session: switching to Notes and
 * back keeps the input and the last result. Nothing here is stored.
 */
const session: { input: string; variable: string; outcome: Outcome | null; run: number } = {
  input: "",
  variable: "",
  outcome: null,
  run: 0,
};

const FAILURE_TITLES: Record<Failure["kind"], string> = {
  empty: "Nothing to compute",
  syntax: "Can't read this",
  unsupported: "Not supported yet",
  "wrong-operation": "Try another operation",
  "choose-variable": "Choose a variable",
  undefined: "Undefined",
  "too-complex": "Too complex",
  "engine-error": "The engine failed",
  timeout: "Took too long",
  crashed: "The engine stopped",
  "load-failed": "Couldn't load the math engine",
  unavailable: "Not available in this browser",
  cancelled: "Cancelled",
};

/** What the advanced engine is doing while the reader waits. */
const STAGES: Record<string, string> = {
  runtime: `Loading Python (the first time downloads ${DOWNLOAD_MB} MB)…`,
  sympy: "Loading SymPy…",
};

/** Waits this long before showing "Computing…", so instant answers don't flash it. */
const STATUS_DELAY_MS = 150;
const PREVIEW_MS = 250;
const BASIC_OPS: readonly string[] = ["evaluate", "simplify", "approximate", "solve"];

/**
 * The Compute tab: evaluate, simplify, solve and approximate, in a worker,
 * with an advanced engine (SymPy) for calculus, linear algebra, probability,
 * statistics and transforms, downloaded only after the reader agrees.
 *
 * What the reader wrote and what the engine computed stay apart. The input
 * is never changed by a result; a result names its own input and operation;
 * and a result reaches rough work or a document only through an explicit
 * action (Add to rough work, Insert into document…, which asks first).
 */
export function ComputePanel({
  onAddToRoughWork,
  insertTarget,
  onInsert,
  mathRenderer,
  variant,
}: ComputeProps & { mathRenderer: MathRendererType; variant: "docked" | "sheet" }) {
  const [input, setInputState] = useState(session.input);
  const [variable, setVariableState] = useState(session.variable);
  const [outcome, setOutcomeState] = useState<Outcome | null>(session.outcome);
  const [running, setRunning] = useState<{
    job: Job;
    phase: "loading" | "computing";
    stage?: string;
    controller: AbortController;
  } | null>(null);
  /** An advanced job waiting for the reader to agree to the download. */
  const [asking, setAsking] = useState<Job | null>(null);
  const [showStatus, setShowStatus] = useState(false);
  const [mathOpen, setMathOpen] = useState(false);
  const [insert, setInsert] = useState<{ markdown: string; target: InsertTarget | null } | null>(
    null,
  );
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  const setInput = (value: string) => {
    session.input = value;
    setInputState(value);
  };
  const setVariable = (value: string) => {
    session.variable = value;
    setVariableState(value);
  };
  const setOutcome = (value: Outcome | null) => {
    session.outcome = value;
    setOutcomeState(value);
  };

  // The basic engine loads while the reader types the first expression.
  useEffect(() => {
    const handle = requestIdleCallbackSafe(() => {
      basicClient().then(
        (client) => client.warm(),
        () => {}, // Reported when a computation is asked for.
      );
    }, 1000);
    return () => cancelIdleCallbackSafe(handle);
  }, []);

  useEffect(() => {
    setShowStatus(false);
    if (!running) return;
    const timer = setTimeout(() => setShowStatus(true), STATUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [running]);

  const render = useMemo<NoteRenderSettings>(
    () => ({ renderer: mathRenderer, visible: true }),
    [mathRenderer],
  );

  // A new result, failure or question is brought into view: with the advanced
  // section open it can land below the fold.
  const outputRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!outcome && !asking) return;
    outputRef.current?.firstElementChild?.scrollIntoView?.({
      block: "nearest",
      behavior: "smooth",
    });
  }, [outcome, asking]);

  /** The job for an operation on the current input, on the engine that can do it. */
  const jobFor = (op: AnyOperation, params: AdvancedParams = {}): Job => {
    const solveFor = params.variable ?? (op === "solve" ? variable.trim() : undefined);
    if (BASIC_OPS.includes(op) && !needsAdvanced(input)) {
      return {
        engine: "basic",
        op: op as ComputeOperation,
        request: {
          op: op as ComputeOperation,
          input,
          ...(op === "solve" ? { variable: solveFor } : {}),
        },
      };
    }
    return advancedJob(op, { ...params, variable: solveFor || undefined });
  };
  const advancedJob = (op: AnyOperation, params: AdvancedParams = {}): Job => ({
    engine: "advanced",
    op,
    request: { op, input, params },
  });

  const start = (job: Job) => {
    if (job.engine === "advanced" && !consented()) {
      running?.controller.abort();
      setAsking(job);
      return;
    }
    setAsking(null);
    void execute(job);
  };

  const execute = async (job: Job) => {
    running?.controller.abort();
    const controller = new AbortController();
    const token = ++session.run;
    const current = () => token === session.run;
    setRunning({ job, phase: "loading", controller });
    const options: RunOptions = {
      signal: controller.signal,
      onComputing: () => current() && setRunning((r) => r && { ...r, phase: "computing" }),
      onProgress: (stage) => current() && setRunning((r) => r && { ...r, stage }),
    };
    try {
      let result: ComputeResult;
      if (job.engine === "basic") {
        const client = await basicClient();
        if (client.stats().ready) setRunning((r) => r && { ...r, phase: "computing" });
        result = await client.run(job.request, options);
        // What the basic engine can't read, the advanced one may: once the
        // reader has agreed to it, without asking again.
        if (!result.ok && result.kind === "unsupported" && consented() && current()) {
          setRunning(null);
          return void execute(advancedJob(job.op));
        }
      } else {
        const client = await advancedClient();
        if (client.stats().ready) setRunning((r) => r && { ...r, phase: "computing" });
        result = await client.run(job.request, options);
      }
      if (!current()) return;
      setOutcome(result.ok ? { job, answer: result } : { job, failure: result });
    } catch (error) {
      if (!current()) return;
      const computeError = error instanceof Error && error.name === "ComputeError";
      const kind = computeError ? (error as Error & { kind: Failure["kind"] }).kind : "load-failed";
      const message = computeError
        ? (error as Error).message
        : "Couldn't load the math engine. It downloads on first use, so check the connection and try again.";
      setOutcome({ job, failure: { kind, message } });
    } finally {
      if (current()) setRunning(null);
    }
  };

  const run = (op: AnyOperation, params?: AdvancedParams) => start(jobFor(op, params));
  const cancel = () => running?.controller.abort();

  const prepared = useDebounced(input, PREVIEW_MS);
  const advancedInput = useMemo(() => needsAdvanced(prepared), [prepared]);
  const reading = useMemo(
    () =>
      prepared.trim() && !/\n|;/.test(prepared)
        ? prepareInput(prepared, { advanced: advancedInput })
        : null,
    [prepared, advancedInput],
  );
  const empty = !input.trim();
  const defaultOp: ComputeOperation = /(?<![<>!:])=(?!=)/.test(input) ? "solve" : "evaluate";

  const padding = variant === "docked" ? "px-3" : "";
  const fieldId = "compute-input";

  const statusText = !running
    ? ""
    : running.phase === "computing"
      ? running.job.engine === "advanced"
        ? "Computing with SymPy…"
        : "Computing…"
      : running.job.engine === "advanced"
        ? (STAGES[running.stage ?? "runtime"] ?? STAGES.runtime)
        : "Loading the math engine…";

  return (
    <div className={`space-y-3 pb-6 ${padding}`}>
      <div className="overflow-hidden rounded-lg border border-border bg-muted/30 focus-within:border-primary/50">
        <textarea
          id={fieldId}
          ref={fieldRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && hasModKey(event.nativeEvent)) {
              event.preventDefault();
              if (!empty) run(defaultOp);
            } else if (event.key === "Escape" && (running || outcome || asking)) {
              // Stops the computation, or clears the result; the panel stays open.
              event.preventDefault();
              event.stopPropagation();
              if (running) cancel();
              else if (asking) setAsking(null);
              else setOutcome(null);
            }
          }}
          rows={2}
          aria-label="Expression or equation (LaTeX or plain text)"
          aria-describedby="compute-reading"
          placeholder={
            "1/2 + 1/3,  x^2 - 5x + 6 = 0,  \\int_0^1 x^2 dx\nX ~ N(0, 1) on one line, P(X < 1) on the next"
          }
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="block min-h-16 w-full resize-y bg-transparent p-3 font-mono text-xs leading-relaxed outline-none placeholder:text-muted-foreground/70 coarse:text-sm"
        />
        <div className="flex items-center gap-1 border-t border-border/70 bg-background/90 px-1.5 py-1">
          <button
            type="button"
            onClick={() => setMathOpen(true)}
            title="Math keyboard"
            aria-label="Math keyboard"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-10 coarse:w-10"
          >
            <Keyboard className="h-4 w-4" />
          </button>
          <span className="ml-auto pr-1.5 text-2xs text-muted-foreground coarse:hidden">
            <kbd className="font-sans">{modKeyLabel}↵</kbd>{" "}
            {OPERATION_LABELS[defaultOp].toLowerCase()}
          </span>
        </div>
      </div>

      <MathKeyboard
        open={mathOpen}
        onOpenChange={setMathOpen}
        initialLatex={reading?.ok ? reading.latex : ""}
        initialDisplay={false}
        onInsert={(latex) => {
          setInput(latex);
          requestAnimationFrame(() => fieldRef.current?.focus({ preventScroll: true }));
        }}
      />

      <NoteRenderContext.Provider value={render}>
        {/* How the input reads, before anything is computed. */}
        <div
          id="compute-reading"
          className="min-h-5 px-1 text-xs text-muted-foreground"
          aria-live="off"
        >
          {reading?.ok ? (
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0">Reads as</span>
              <span className="min-w-0 overflow-x-auto overflow-y-hidden py-0.5 text-foreground">
                <NoteMath latex={reading.latex} display={false} />
              </span>
            </div>
          ) : reading && reading.kind !== "empty" ? (
            <span>{reading.message}</span>
          ) : /\n|;/.test(prepared) ? (
            <span>Several statements: definitions first, then what to compute.</span>
          ) : null}
        </div>

        <div className="space-y-1.5" role="group" aria-label="Compute">
          <div className="grid grid-cols-3 gap-1.5">
            {(["evaluate", "simplify", "approximate"] as const).map((op) => (
              <OpButton key={op} disabled={empty} onClick={() => run(op)}>
                {op === "approximate" ? "Numeric" : OPERATION_LABELS[op]}
              </OpButton>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <OpButton disabled={empty} onClick={() => run("solve")}>
              Solve
            </OpButton>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              for
              <input
                id="compute-variable"
                name="compute-variable"
                value={variable}
                onChange={(e) => setVariable(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !empty) {
                    event.preventDefault();
                    run("solve");
                  }
                }}
                maxLength={12}
                placeholder="auto"
                aria-label="Unknown to solve for (leave empty to choose automatically)"
                spellCheck={false}
                autoCapitalize="off"
                className="h-8 w-16 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring coarse:h-11"
              />
            </label>
          </div>
        </div>

        <AdvancedTools
          disabled={empty}
          onRun={(op: AdvancedOperation, params) => start(advancedJob(op, params))}
          onTemplate={(text) => {
            const next = input.trim() ? `${input.replace(/\s+$/, "")}\n${text}` : text;
            setInput(next);
            requestAnimationFrame(() => fieldRef.current?.focus({ preventScroll: true }));
          }}
        />

        <div ref={outputRef} aria-live="polite" className="space-y-3">
          {running && showStatus && (
            <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
              <span className="flex-1">{statusText}</span>
              <button
                type="button"
                onClick={cancel}
                className="rounded-md px-2 py-1 font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cancel
              </button>
            </div>
          )}

          {asking && (
            <ConsentCard
              op={asking.op}
              onAccept={() => {
                rememberConsent();
                const job = asking;
                setAsking(null);
                void execute(job);
              }}
              onDecline={() => setAsking(null)}
            />
          )}

          {!asking && outcome && "answer" in outcome && (
            <ResultCard
              answer={outcome.answer}
              onClear={() => setOutcome(null)}
              onCopy={async (markdown) => {
                const ok = await copyText(markdown);
                if (!ok) toast.error("Couldn't copy the result.");
                return ok;
              }}
              onAddToRoughWork={onAddToRoughWork}
              onInsert={(markdown) => setInsert({ markdown, target: insertTarget() })}
              // An incomplete basic answer: SymPy may find every solution.
              onAdvanced={
                outcome.job.engine === "basic" &&
                outcome.answer.op === "solve" &&
                outcome.answer.complete === false
                  ? () => start(advancedJob("solve", { variable: variable.trim() || undefined }))
                  : undefined
              }
            />
          )}
          {!asking && outcome && "failure" in outcome && (
            <FailureCard
              failure={outcome.failure}
              op={outcome.job.op}
              onClear={() => setOutcome(null)}
              onRun={(op, chosen) => {
                if (outcome.job.engine === "advanced") {
                  const params = { ...outcome.job.request.params, variable: chosen };
                  return start(
                    advancedJob(op, chosen === undefined ? outcome.job.request.params : params),
                  );
                }
                if (chosen !== undefined) setVariable(chosen);
                run(op, chosen === undefined ? undefined : { variable: chosen });
              }}
              onAdvanced={
                outcome.job.engine === "basic" &&
                (outcome.failure.kind === "unsupported" || outcome.failure.kind === "syntax")
                  ? () => start(advancedJob(outcome.job.op))
                  : undefined
              }
            />
          )}
          {!outcome && !running && !asking && <Intro />}
        </div>
      </NoteRenderContext.Provider>

      <InsertDialog
        request={insert}
        mathRenderer={mathRenderer}
        onCancel={() => setInsert(null)}
        onConfirm={(point) => {
          if (!insert?.target) return;
          onInsert({
            markdown: insert.markdown,
            fileId: insert.target.fileId,
            point,
            base: insert.target.base,
          });
          setInsert(null);
        }}
      />
    </div>
  );
}

function Intro() {
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center">
      <Calculator className="mb-3 h-5 w-5 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium text-foreground">Compute</p>
      <p className="mt-1.5 max-w-64 text-xs leading-relaxed text-muted-foreground">
        Evaluate, simplify and solve, on this device. Results stay here until you copy them, add
        them to rough work or insert them into a document.
      </p>
    </div>
  );
}

/** Asks before the advanced engine's one-time download. */
function ConsentCard({
  op,
  onAccept,
  onDecline,
}: {
  op: AnyOperation;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <section
      aria-label="Advanced engine"
      className="space-y-2 rounded-lg border border-border/70 bg-card px-3 py-3 text-sm"
    >
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-muted-foreground" aria-hidden />
        <p className="font-medium text-foreground">
          {operationLabel(op)} needs the advanced engine
        </p>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        SymPy, a full computer algebra system, runs here on your device: calculus, linear algebra,
        probability, statistics and transforms. The first use downloads {DOWNLOAD_MB} MB; after that
        it works offline. What you type never leaves the device.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          autoFocus
          onClick={onAccept}
          className="inline-flex h-8 items-center rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 coarse:h-11"
        >
          Download and compute
        </button>
        <button
          type="button"
          onClick={onDecline}
          className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent coarse:h-11"
        >
          Not now
        </button>
      </div>
    </section>
  );
}

function ResultCard({
  answer,
  onClear,
  onCopy,
  onAddToRoughWork,
  onInsert,
  onAdvanced,
}: {
  answer: ComputeAnswer;
  onClear: () => void;
  onCopy: (markdown: string) => Promise<boolean>;
  onAddToRoughWork: (markdown: string) => void;
  onInsert: (markdown: string) => void;
  /** Offered when the basic engine's answer may be incomplete. */
  onAdvanced?: () => void;
}) {
  const markdown = useMemo(() => resultMarkdown(answer), [answer]);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const label = operationLabel(answer.op);
  const rows: { label: string; latex: string }[] = [];
  if (answer.lhs) {
    // \det(A) = −2, x ∈ {…}, ∫ … dx = …: the result as a statement.
    if (answer.exact) {
      rows.push({
        label: answer.op === "solve" ? "Solutions" : "Result",
        latex: withLhs(answer.lhs, answer.exact),
      });
    }
  } else if (answer.op !== "solve" || answer.exact) {
    if (answer.exact) {
      rows.push({
        label: answer.op === "solve" ? "Result" : answer.engine === "advanced" ? "Result" : "Exact",
        latex: answer.exact,
      });
    }
  }
  if (answer.op !== "solve" || answer.exact) {
    for (const form of answer.forms ?? []) rows.push({ label: form.label, latex: form.latex });
    if (answer.approx) rows.push({ label: "Approx.", latex: `\\approx ${answer.approx}` });
  }

  return (
    <section aria-label={`${label} result`} className="rounded-lg border border-border/70 bg-card">
      <header className="flex items-center gap-2 border-b border-border/60 py-1.5 pl-3 pr-1.5">
        <h3 className="flex-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </h3>
        {answer.engine === "advanced" && (
          <span
            title="Computed by SymPy, on this device"
            className="rounded bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground"
          >
            SymPy
          </span>
        )}
        <ClearButton onClick={onClear} />
      </header>
      <dl className="space-y-2.5 px-3 py-2.5 text-sm">
        {answer.given?.map((given, index) => (
          <Row key={`given-${index}`} label={index === 0 ? "Given" : ""}>
            <NoteMath latex={given} display={false} />
          </Row>
        ))}
        <Row label="Input">
          <NoteMath latex={answer.input} display={false} />
        </Row>
        {rows.map((row, index) => (
          <Row
            key={`${row.label}-${index}`}
            label={row.label}
            emphasis={row.label === "Exact" || row.label === "Result" || row.label === "Solutions"}
            stacked={row.label.length > 9 || row.latex.length > 60}
          >
            <NoteMath latex={row.latex} display={false} />
          </Row>
        ))}
        {answer.op === "solve" && !answer.exact && (
          <Row label={answer.complete ? "Solutions" : "Found"} emphasis stacked>
            {answer.solutions?.length ? (
              <ul className="space-y-1">
                {answer.solutions.map((solution, index) => (
                  <li key={index} className="flex min-w-0 items-baseline gap-2">
                    {/* One line per solution, scrolled rather than broken mid-number. */}
                    <span className="min-w-0 overflow-x-auto overflow-y-hidden whitespace-nowrap py-0.5 [&_.katex]:whitespace-nowrap">
                      <NoteMath
                        latex={solutionLatex(answer.variable ?? "x", solution)}
                        display={false}
                      />
                    </span>
                    {solution.complex && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
                        complex
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">
                {answer.complete ? "No solution" : "None found"}
              </span>
            )}
          </Row>
        )}
      </dl>
      {answer.notes.length > 0 && (
        <div className="space-y-1 border-t border-border/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {answer.notes.map((note, index) => (
            <div key={index} className="flex gap-1.5">
              <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <div className="docs-note min-w-0 [&_p]:m-0">
                <ReactMarkdown remarkPlugins={NOTE_PLUGINS} components={NOTE_COMPONENTS}>
                  {note}
                </ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      )}
      <footer className="flex flex-wrap gap-1.5 border-t border-border/60 px-3 py-2">
        <ActionButton
          onClick={async () => {
            if (await onCopy(markdown)) setCopied(true);
          }}
          title="Copy as Markdown, with the math as LaTeX"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </ActionButton>
        <ActionButton onClick={() => onAddToRoughWork(markdown)}>
          <PencilRuler className="h-3.5 w-3.5" /> Add to rough work
        </ActionButton>
        <ActionButton onClick={() => onInsert(markdown)}>
          <FileInput className="h-3.5 w-3.5" /> Insert into document…
        </ActionButton>
        {onAdvanced && (
          <ActionButton onClick={onAdvanced} title="Solve again with SymPy">
            <Cpu className="h-3.5 w-3.5" /> Try the advanced engine
          </ActionButton>
        )}
      </footer>
    </section>
  );
}

function FailureCard({
  failure,
  op,
  onClear,
  onRun,
  onAdvanced,
}: {
  failure: Failure;
  op: AnyOperation;
  onClear: () => void;
  onRun: (op: AnyOperation, variable?: string) => void;
  /** Offered when the basic engine couldn't read the input. */
  onAdvanced?: () => void;
}) {
  const quiet = failure.kind === "cancelled" || failure.kind === "empty";
  return (
    <section
      aria-label={`${operationLabel(op)}: ${FAILURE_TITLES[failure.kind]}`}
      className={`rounded-lg border px-3 py-2.5 text-sm ${
        quiet ? "border-border/70 bg-card" : "border-amber-500/40 bg-amber-500/10"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium text-foreground">{FAILURE_TITLES[failure.kind]}</p>
          <div className="docs-note text-xs leading-relaxed text-foreground [&_p]:m-0">
            <ReactMarkdown remarkPlugins={NOTE_PLUGINS} components={NOTE_COMPONENTS}>
              {failure.message}
            </ReactMarkdown>
          </div>
          {failure.hint && <p className="text-xs text-muted-foreground">{failure.hint}</p>}
        </div>
        <ClearButton onClick={onClear} />
      </div>
      {(failure.suggest || failure.variables?.length || onAdvanced) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {onAdvanced && (
            <ActionButton onClick={onAdvanced}>
              <Cpu className="h-3.5 w-3.5" /> Use the advanced engine
            </ActionButton>
          )}
          {failure.suggest && (
            <ActionButton onClick={() => onRun(failure.suggest!)}>
              {operationLabel(failure.suggest)} instead
            </ActionButton>
          )}
          {failure.variables?.map((name) => (
            <ActionButton key={name} onClick={() => onRun(op, name)}>
              {op === "solve" ? "Solve for" : "Use"} <span className="font-mono">{name}</span>
            </ActionButton>
          ))}
        </div>
      )}
    </section>
  );
}

function Row({
  label,
  emphasis,
  stacked,
  children,
}: {
  label: string;
  emphasis?: boolean;
  /** Label above the value, which then gets the card's full width. */
  stacked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        stacked ? "space-y-1" : "grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-2"
      }
    >
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`min-w-0 overflow-x-auto overflow-y-hidden py-0.5 ${emphasis ? "text-foreground" : "text-foreground/80"}`}
      >
        {children}
      </dd>
    </div>
  );
}

function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Clear result"
      title="Clear result"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-10 coarse:w-10"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

function OpButton({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-background coarse:h-11"
    >
      {children}
    </button>
  );
}

function ActionButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-10 coarse:px-3"
    >
      {children}
    </button>
  );
}

function useDebounced(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (value === settled) return;
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, settled, ms]);
  return settled;
}
