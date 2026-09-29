// Owns one Ask AI output: which request may write to it, cancellation, and how
// often streamed text reaches React. Kept free of React so the ordering rules
// can be tested directly; useAI is a thin binding over it.
//
// Every request gets a generation. Starting, stopping, resetting or disposing
// bumps the generation, and a request only touches state while it still owns
// the current one, so a superseded request's late tokens, errors or
// completion can never alter a newer answer.

import type { AgentResult } from "./agent";

export type AskStatus = "idle" | "streaming" | "done" | "stopped" | "error";

export interface AskState {
  status: AskStatus;
  text: string;
  error: string | null;
  scopeLabel: string | null;
  /** Set when an answer ended but may be incomplete. */
  notice: string | null;
}

export const IDLE: AskState = {
  status: "idle",
  text: "",
  error: null,
  scopeLabel: null,
  notice: null,
};

/** Performs one request, streaming chunks through onToken. */
export type AskRun = (
  signal: AbortSignal,
  onToken: (chunk: string) => void,
) => Promise<AgentResult>;

/** Calls flush later; returns a function that cancels it. */
export type FlushScheduler = (flush: () => void) => () => void;

/**
 * Streamed text reaches React at most this often. Each update re-renders the
 * whole answer as Markdown, so per-token updates grow quadratically with its
 * length. The first chunk still shows immediately.
 */
export const FLUSH_INTERVAL_MS = 50;

const timerScheduler: FlushScheduler = (flush) => {
  const id = setTimeout(flush, FLUSH_INTERVAL_MS);
  return () => clearTimeout(id);
};

const NOTICES: Record<AgentResult["finish"], string | null> = {
  stop: null,
  length: "The answer reached the model's length limit and may be cut off.",
  interrupted: "The connection closed before the answer finished, so it may be incomplete.",
};

export class AskSession {
  private state: AskState = IDLE;
  private generation = 0;
  private controller: AbortController | null = null;
  /** Text received but not yet delivered to onChange. */
  private pending = "";
  private cancelFlush: (() => void) | null = null;
  private active = true;
  private readonly onChange: (state: AskState) => void;
  private readonly schedule: FlushScheduler;

  constructor(onChange: (state: AskState) => void, schedule: FlushScheduler = timerScheduler) {
    this.onChange = onChange;
    this.schedule = schedule;
  }

  get snapshot(): AskState {
    return this.state;
  }

  /**
   * Starts a request, cancelling any in flight. Resolves with the result, or
   * null when the request failed, was stopped or was superseded.
   */
  ask = async (run: AskRun): Promise<AgentResult | null> => {
    if (!this.active) return null;
    this.cancel();
    this.pending = "";
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.set({ ...IDLE, status: "streaming" });
    const owns = () => generation === this.generation;

    try {
      const result = await run(controller.signal, (chunk) => {
        if (owns()) this.append(chunk);
      });
      if (!owns()) return null;
      this.settle({
        status: "done",
        scopeLabel: result.scopeLabel,
        notice: NOTICES[result.finish] ?? null,
      });
      return result;
    } catch (err) {
      if (!owns()) return null;
      if (controller.signal.aborted || (err as Error)?.name === "AbortError") {
        this.settle({ status: "stopped" });
      } else {
        this.settle({ status: "error", error: (err as Error)?.message || "Something went wrong." });
      }
      return null;
    }
  };

  /** Stop button: cancel the request and keep the text received so far. */
  stop = (): void => {
    if (this.state.status !== "streaming") return;
    this.cancel();
    this.settle({ status: "stopped" });
  };

  /** Cancel any request and clear the output. */
  reset = (): void => {
    this.cancel();
    this.pending = "";
    this.set(IDLE);
  };

  /** The owner unmounted: cancel, and ignore everything until activate(). */
  dispose = (): void => {
    this.active = false;
    this.cancel();
    this.pending = "";
  };

  activate = (): void => {
    this.active = true;
  };

  private cancel(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.cancelFlush?.();
    this.cancelFlush = null;
  }

  private append(chunk: string): void {
    if (!chunk) return;
    this.pending += chunk;
    if (!this.state.text) {
      this.flush();
    } else if (!this.cancelFlush) {
      this.cancelFlush = this.schedule(() => {
        this.cancelFlush = null;
        this.flush();
      });
    }
  }

  private flush(): void {
    this.cancelFlush?.();
    this.cancelFlush = null;
    if (!this.pending) return;
    const text = this.state.text + this.pending;
    this.pending = "";
    this.set({ ...this.state, text });
  }

  /** Ends the current request with any undelivered text in one update. */
  private settle(patch: Partial<AskState>): void {
    this.cancelFlush?.();
    this.cancelFlush = null;
    this.controller = null;
    const text = this.state.text + this.pending;
    this.pending = "";
    this.set({ ...this.state, ...patch, text });
  }

  private set(next: AskState): void {
    this.state = next;
    if (this.active) this.onChange(next);
  }
}
