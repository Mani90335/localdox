import { useEffect, useId, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Calculator,
  Check,
  ChevronRight,
  Copy,
  FileInput,
  Info,
  Loader2,
  PencilRuler,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { copyText } from "@/lib/workspace/share";
import { cancelIdleCallbackSafe, requestIdleCallbackSafe } from "@/lib/platform/keyboard";
import { prepareInput } from "@/services/compute/input";
import {
  OPERATION_LABELS,
  operationLabel,
  type ComputeAnswer,
  type ComputeFailure,
  type ComputeOperation,
  type ComputeRequest,
  type ComputeResult,
  type Step,
} from "@/services/compute/protocol";
import { resultMarkdown, solutionLatex, withLhs } from "@/services/compute/result-markdown";
import type {
  ComputeClient,
  ComputeErrorKind,
  RunOptions,
} from "@/services/compute/compute-client";
import type { MathRendererType } from "@/services/math/types";
import { ComputeComposer, type ComposerHandle } from "./ComputeComposer";
import { asMath, preferredMode, rememberMode, type InputMode } from "./compute-input";
import { hasEmptyBox } from "./math-keys";
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

/** One computation, including whether the primary button chose the operation. */
type Job = { op: ComputeOperation; request: ComputeRequest; automatic?: boolean };

type Outcome = { job: Job; answer: ComputeAnswer } | { job: Job; failure: Failure };

type Client<Request> = Pick<ComputeClient<Request, ComputeResult>, "run" | "stats" | "warm">;

// Import the client on first use, keeping the engine inside its lazy worker.
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
/** Whether worked steps are shown under a result: on, unless the reader hid them. */
const STEPS_KEY = "localdox:compute-steps";
function stepsPreferred(): boolean {
  try {
    return localStorage.getItem(STEPS_KEY) !== "hidden";
  } catch {
    return true;
  }
}
function rememberSteps(shown: boolean) {
  try {
    localStorage.setItem(STEPS_KEY, shown ? "shown" : "hidden");
  } catch {
    // Shown again next time; nothing else depends on it.
  }
}

/**
 * What the tab holds between visits in this session: switching to Notes and
 * back keeps the input and the last result. Nothing here is stored.
 */
const session: {
  input: string;
  variable: string;
  outcome: Outcome | null;
  run: number;
  mode: InputMode | null;
} = {
  input: "",
  variable: "",
  outcome: null,
  run: 0,
  mode: null,
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

/** What computing the input means by default: solving an equation, evaluating anything else. */
function impliedOp(input: string): ComputeOperation {
  return /(?<![<>!:])=(?!=)/.test(input) ? "solve" : "evaluate";
}

/** Waits this long before showing "Computing…", so instant answers don't flash it. */
const STATUS_DELAY_MS = 150;
const PREVIEW_MS = 250;

/** Local math in a lazy worker, with results shared only on request. */
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
  const [showStatus, setShowStatus] = useState(false);
  const [mode, setMode] = useState<InputMode>(() => session.mode ?? preferredMode());
  /** MathLive didn't load (offline on first use): text until it can. */
  const [mathUnavailable, setMathUnavailable] = useState(false);
  const [insert, setInsert] = useState<{ markdown: string; target: InsertTarget | null } | null>(
    null,
  );
  const composerRef = useRef<ComposerHandle>(null);

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

  // Bring a new result or failure into view.
  const outputRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!outcome) return;
    outputRef.current?.firstElementChild?.scrollIntoView?.({
      block: "nearest",
      behavior: "smooth",
    });
  }, [outcome]);

  const jobFor = (op: ComputeOperation, chosen = variable, text = input): Job => ({
    op,
    request: { op, input: text, ...(op === "solve" ? { variable: chosen.trim() } : {}) },
  });

  const start = (job: Job) => {
    // An empty box reads as nothing at all (□ + 1 would be 1): fill it first.
    if (hasEmptyBox(job.request.input)) {
      composerRef.current?.nextBox();
      return;
    }
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
      const client = await basicClient();
      if (client.stats().ready) setRunning((r) => r && { ...r, phase: "computing" });
      let result = await client.run(job.request, options);
      if (
        job.automatic &&
        !result.ok &&
        result.kind === "wrong-operation" &&
        result.suggest === "simplify"
      ) {
        job = { ...job, op: "simplify", request: { ...job.request, op: "simplify" } };
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

  const run = (op: ComputeOperation, chosen?: string) => start(jobFor(op, chosen));
  const cancel = () => running?.controller.abort();

  /** Escape stops the computation, or clears the result; the panel stays open. */
  const escape = () => {
    if (running) cancel();
    else if (outcome) setOutcome(null);
    else return false;
    return true;
  };

  const switchMode = (next: InputMode, remember = true) => {
    if (next === mode) return;
    if (next === "math") {
      const latex = input.trim() ? asMath(input) : "";
      if (latex === null) {
        toast("This stays as text", { description: "Part of it can't be written as math." });
        return;
      }
      setInput(latex);
      setMathUnavailable(false);
    }
    if (remember) rememberMode(next);
    session.mode = next;
    setMode(next);
  };

  const prepared = useDebounced(input, PREVIEW_MS);
  const reading = useMemo(
    () => (prepared.trim() && !/\n|;/.test(prepared) ? prepareInput(prepared) : null),
    [prepared],
  );
  const empty = !input.trim();
  const defaultOp = impliedOp(input);
  const padding = variant === "docked" ? "px-3" : "";

  const statusText = running?.phase === "computing" ? "Computing…" : "Loading the math engine…";

  return (
    <div className={`space-y-3 pb-6 ${padding}`}>
      <ComputeComposer
        ref={composerRef}
        mode={mode}
        onModeChange={(next) => switchMode(next)}
        onMathUnavailable={() => {
          setMathUnavailable(true);
          switchMode("text", false);
        }}
        input={input}
        onInput={setInput}
        primary="Compute"
        // Enter in the math field passes what the field holds right then: its
        // input event can still be on its way when a fast Enter arrives.
        onRun={(latest = input) => {
          start({ ...jobFor(impliedOp(latest), variable, latest), automatic: true });
        }}
        onEscape={escape}
      />

      <NoteRenderContext.Provider value={render}>
        {/* How the input reads, before anything is computed. A math field
            shows that itself, so there only what stands in the way. */}
        <div
          id="compute-reading"
          className={`px-1 text-xs text-muted-foreground ${mode === "text" ? "min-h-5" : "empty:hidden"}`}
          aria-live="off"
        >
          {mathUnavailable && mode === "text" ? (
            <span>Math input couldn't load, so this is text for now.</span>
          ) : mode === "math" && hasEmptyBox(input) ? (
            <span>Fill in the empty boxes, then compute.</span>
          ) : reading?.ok ? (
            mode === "text" && (
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0">Reads as</span>
                <span className="min-w-0 overflow-x-auto overflow-y-hidden py-0.5 text-foreground">
                  <NoteMath latex={reading.latex} display={false} />
                </span>
              </div>
            )
          ) : reading && reading.kind !== "empty" ? (
            <span>{reading.message}</span>
          ) : /\n|;/.test(prepared) ? (
            <span>Compute one expression or equation at a time.</span>
          ) : null}
        </div>

        {/* The other operations; the one the input implies is the composer's button. */}
        {
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Compute">
            {(["evaluate", "simplify", "approximate", "solve"] as const)
              .filter((op) => op !== defaultOp)
              .map((op) => (
                <OpButton key={op} disabled={empty} onClick={() => run(op)}>
                  {op === "approximate" ? "Numeric" : OPERATION_LABELS[op]}
                </OpButton>
              ))}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Solve for
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
                className="h-7 w-14 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring coarse:h-10"
              />
            </label>
          </div>
        }

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

          {outcome && "answer" in outcome && (
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
            />
          )}
          {outcome && "failure" in outcome && (
            <FailureCard
              failure={outcome.failure}
              op={outcome.job.op}
              onClear={() => setOutcome(null)}
              onRun={(op, chosen) => {
                if (chosen !== undefined) setVariable(chosen);
                run(op, chosen);
              }}
            />
          )}
          {!outcome && !running && <Intro />}
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
        Enter your math using the keyboard, then compute. Work with numbers, equations and simple
        derivatives and integrals. Copy the answer or add the steps to rough work.
      </p>
    </div>
  );
}

function ResultCard({
  answer,
  onClear,
  onCopy,
  onAddToRoughWork,
  onInsert,
}: {
  answer: ComputeAnswer;
  onClear: () => void;
  onCopy: (markdown: string) => Promise<boolean>;
  onAddToRoughWork: (markdown: string) => void;
  onInsert: (markdown: string) => void;
}) {
  const [showSteps, setShowSteps] = useState(stepsPreferred);
  const hasSteps = Boolean(answer.steps?.length);
  // What is copied or added is what the card shows: the steps too, when open.
  const markdown = useMemo(() => resultMarkdown(answer, { steps: showSteps }), [answer, showSteps]);
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
        label: answer.op === "solve" ? "Result" : "Exact",
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
      {hasSteps && (
        <StepsSection
          steps={answer.steps!}
          open={showSteps}
          onToggle={() => {
            rememberSteps(!showSteps);
            setShowSteps(!showSteps);
          }}
        />
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
      </footer>
    </section>
  );
}

/** How the result is reached: numbered steps, each with the work for its parts beneath it. */
function StepsSection({
  steps,
  open,
  onToggle,
}: {
  steps: Step[];
  open: boolean;
  onToggle: () => void;
}) {
  const id = useId();
  return (
    <div className="border-t border-border/60">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-2xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          aria-hidden
        />
        Steps
        <span className="font-normal normal-case tabular-nums">{steps.length}</span>
      </button>
      {open && (
        <ol id={id} aria-label="Steps" className="space-y-3 px-3 pb-3 text-sm">
          {steps.map((step, index) => (
            <StepItem key={index} step={step} number={index + 1} depth={0} />
          ))}
        </ol>
      )}
    </div>
  );
}

function StepItem({ step, number, depth }: { step: Step; number?: number; depth: number }) {
  return (
    <li className="flex min-w-0 gap-2">
      {number !== undefined && (
        <span
          aria-hidden
          className="mt-px w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
        >
          {number}
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="docs-note text-xs leading-relaxed text-foreground/90 [&_p]:m-0">
          <ReactMarkdown remarkPlugins={NOTE_PLUGINS} components={NOTE_COMPONENTS}>
            {step.text}
          </ReactMarkdown>
        </div>
        {step.latex && (
          // One line, scrolled rather than broken mid-expression.
          <div className="min-w-0 overflow-x-auto overflow-y-hidden whitespace-nowrap py-0.5 [&_.katex]:whitespace-nowrap">
            <NoteMath latex={`\\displaystyle ${step.latex}`} display={false} />
          </div>
        )}
        {step.substeps && (
          // Past three levels the indent stops growing: the panel is narrow.
          <ul
            className={`mt-1.5 space-y-2 border-l border-border/70 ${depth < 3 ? "pl-3" : "pl-1.5"}`}
          >
            {step.substeps.map((substep, index) => (
              <StepItem key={index} step={substep} depth={depth + 1} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function FailureCard({
  failure,
  op,
  onClear,
  onRun,
}: {
  failure: Failure;
  op: ComputeOperation;
  onClear: () => void;
  onRun: (op: ComputeOperation, variable?: string) => void;
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
      {(failure.suggest || failure.variables?.length) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
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
      className="inline-flex h-7 items-center justify-center rounded-full border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-background coarse:h-10"
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
