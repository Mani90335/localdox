import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Calculator,
  Check,
  Copy,
  FileInput,
  Info,
  Keyboard,
  Loader2,
  PencilRuler,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { copyText } from "@/lib/workspace/share";
import {
  cancelIdleCallbackSafe,
  hasModKey,
  modKeyLabel,
  requestIdleCallbackSafe,
} from "@/lib/platform/keyboard";
import { prepareInput } from "@/services/compute/input";
import {
  OPERATION_LABELS,
  type ComputeAnswer,
  type ComputeFailure,
  type ComputeOperation,
  type ComputeRequest,
} from "@/services/compute/protocol";
import { resultMarkdown, solutionLatex } from "@/services/compute/result-markdown";
import type { ComputeClient, ComputeErrorKind } from "@/services/compute/compute-client";
import type { MathRendererType } from "@/services/math/types";
import { MathKeyboard } from "../editor/MathKeyboard";
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

type Outcome =
  | { request: ComputeRequest; answer: ComputeAnswer }
  | { request: ComputeRequest; failure: Failure };

// The engine client, imported on first use: its module names the worker, and
// the worker holds the engine (see services/compute/compute.ts).
let clientPromise: Promise<ComputeClient> | null = null;
function loadClient(): Promise<ComputeClient> {
  clientPromise ??= import("@/services/compute/compute").then(
    (module) => module.computeClient,
    (error) => {
      clientPromise = null; // Offline now; a later attempt may succeed.
      throw error;
    },
  );
  return clientPromise;
}

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
  "choose-variable": "Choose an unknown",
  undefined: "Undefined",
  "too-complex": "Too complex",
  "engine-error": "The engine failed",
  timeout: "Took too long",
  crashed: "The engine stopped",
  "load-failed": "Couldn't load the math engine",
  unavailable: "Not available in this browser",
  cancelled: "Cancelled",
};

/** Waits this long before showing "Computing…", so instant answers don't flash it. */
const STATUS_DELAY_MS = 150;
const PREVIEW_MS = 250;

/**
 * The Compute tab: evaluate, simplify, solve and approximate, in a worker.
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
    request: ComputeRequest;
    phase: "loading" | "computing";
    controller: AbortController;
  } | null>(null);
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

  // The engine loads while the reader types the first expression.
  useEffect(() => {
    const handle = requestIdleCallbackSafe(() => {
      loadClient().then(
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

  const run = async (op: ComputeOperation, solveFor = variable) => {
    const request: ComputeRequest = {
      op,
      input,
      ...(op === "solve" ? { variable: solveFor.trim() } : {}),
    };
    running?.controller.abort();
    const controller = new AbortController();
    const token = ++session.run;
    const current = () => token === session.run;
    setRunning({ request, phase: "loading", controller });
    try {
      const client = await loadClient();
      if (client.stats().ready) setRunning((r) => r && { ...r, phase: "computing" });
      const result = await client.run(request, {
        signal: controller.signal,
        onComputing: () => current() && setRunning((r) => r && { ...r, phase: "computing" }),
      });
      if (!current()) return;
      setOutcome(result.ok ? { request, answer: result } : { request, failure: result });
    } catch (error) {
      if (!current()) return;
      const kind =
        error instanceof Error && error.name === "ComputeError"
          ? (error as Error & { kind: Failure["kind"] }).kind
          : "load-failed";
      const message =
        kind === "load-failed" && !(error instanceof Error && error.name === "ComputeError")
          ? "Couldn't load the math engine. It downloads on first use, so check the connection and try again."
          : error instanceof Error
            ? error.message
            : String(error);
      setOutcome({ request, failure: { kind, message } });
    } finally {
      if (current()) setRunning(null);
    }
  };

  const cancel = () => running?.controller.abort();

  const prepared = useDebounced(input, PREVIEW_MS);
  const reading = useMemo(() => (prepared.trim() ? prepareInput(prepared) : null), [prepared]);
  const empty = !input.trim();
  const defaultOp: ComputeOperation = input.includes("=") ? "solve" : "evaluate";

  const padding = variant === "docked" ? "px-3" : "";
  const fieldId = "compute-input";

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
              if (!empty) void run(defaultOp);
            } else if (event.key === "Escape" && (running || outcome)) {
              // Stops the computation, or clears the result; the panel stays open.
              event.preventDefault();
              event.stopPropagation();
              if (running) cancel();
              else setOutcome(null);
            }
          }}
          rows={2}
          aria-label="Expression or equation (LaTeX or plain text)"
          aria-describedby="compute-reading"
          placeholder={
            "1/2 + 1/3,  sqrt(8),  x^2 - 5x + 6 = 0\nor LaTeX: \\frac{1}{2} + \\frac{1}{3}"
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
              <span className="min-w-0 overflow-x-auto text-foreground">
                <NoteMath latex={reading.latex} display={false} />
              </span>
            </div>
          ) : reading && reading.kind !== "empty" ? (
            <span>{reading.message}</span>
          ) : null}
        </div>

        <div className="space-y-1.5" role="group" aria-label="Compute">
          <div className="grid grid-cols-3 gap-1.5">
            {(["evaluate", "simplify", "approximate"] as const).map((op) => (
              <OpButton key={op} disabled={empty} onClick={() => void run(op)}>
                {op === "approximate" ? "Numeric" : OPERATION_LABELS[op]}
              </OpButton>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <OpButton disabled={empty} onClick={() => void run("solve")}>
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
                    void run("solve");
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

        <div aria-live="polite" className="space-y-3">
          {running && showStatus && (
            <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              <span className="flex-1">
                {running.phase === "loading" ? "Loading the math engine…" : "Computing…"}
              </span>
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
              op={outcome.request.op}
              onClear={() => setOutcome(null)}
              onRun={(op, solveFor) => {
                if (solveFor !== undefined) setVariable(solveFor);
                void run(op, solveFor);
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
        Evaluate, simplify and solve, on this device. Results stay here until you copy them, add
        them to rough work or insert them into a document.
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
  const markdown = useMemo(() => resultMarkdown(answer), [answer]);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const rows: { label: string; latex: string }[] = [];
  if (answer.op !== "solve" || answer.exact) {
    if (answer.exact)
      rows.push({ label: answer.op === "solve" ? "Result" : "Exact", latex: answer.exact });
    for (const form of answer.forms ?? []) rows.push({ label: form.label, latex: form.latex });
    if (answer.approx) rows.push({ label: "Approx.", latex: `\\approx ${answer.approx}` });
  }

  return (
    <section
      aria-label={`${OPERATION_LABELS[answer.op]} result`}
      className="rounded-lg border border-border/70 bg-card"
    >
      <header className="flex items-center gap-2 border-b border-border/60 py-1.5 pl-3 pr-1.5">
        <h3 className="flex-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          {OPERATION_LABELS[answer.op]}
        </h3>
        <ClearButton onClick={onClear} />
      </header>
      <dl className="space-y-2.5 px-3 py-2.5 text-sm">
        <Row label="Input">
          <NoteMath latex={answer.input} display={false} />
        </Row>
        {rows.map((row) => (
          <Row
            key={row.label}
            label={row.label}
            emphasis={row.label === "Exact" || row.label === "Result"}
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
                    <span className="min-w-0 overflow-x-auto whitespace-nowrap [&_.katex]:whitespace-nowrap">
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
      </footer>
    </section>
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
      aria-label={`${OPERATION_LABELS[op]}: ${FAILURE_TITLES[failure.kind]}`}
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
              {OPERATION_LABELS[failure.suggest]} instead
            </ActionButton>
          )}
          {failure.variables?.map((name) => (
            <ActionButton key={name} onClick={() => onRun("solve", name)}>
              Solve for <span className="font-mono">{name}</span>
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
        className={`min-w-0 overflow-x-auto ${emphasis ? "text-foreground" : "text-foreground/80"}`}
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
