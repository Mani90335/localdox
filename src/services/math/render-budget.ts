// How much typesetting one browser task may do.
//
// KaTeX plus sanitizing is ~0.25 ms per equation on a fast machine, and each
// result is ~4 KB of markup the commit then parses into the page. A document
// with 2,000 equations did all of that at once: every equation waiting for
// KaTeX's module resolved in one microtask burst (a ~960 ms task), and their
// state updates committed together (another ~820 ms). Here every equation,
// whichever path draws it, is charged to a per-task budget. When the budget is
// spent the rest wait for a later task, so input and painting get a turn.

export interface Clock {
  now(): number;
  /** Run `fn` in a later task. */
  later(fn: () => void): void;
}

const browserClock: Clock = {
  now: () => performance.now(),
  later: (fn) => void setTimeout(fn, 0),
};

/**
 * Milliseconds of math spent in the current task.
 *
 * There is no "task started" event, so the count is reset by a callback that
 * the first charge schedules for the next task. A task that begins before that
 * callback runs sees a spent budget and defers its math a little early; it
 * never lets a task run long.
 */
export class TaskBudget {
  private spent = 0;
  private armed = false;
  private readonly budgetMs: number;
  private readonly clock: Clock;

  constructor(budgetMs: number, clock: Clock = browserClock) {
    this.budgetMs = budgetMs;
    this.clock = clock;
  }

  available(): boolean {
    return this.spent < this.budgetMs;
  }

  /** Run `fn` and charge its duration to this task. */
  measure<T>(fn: () => T): T {
    const start = this.clock.now();
    try {
      return fn();
    } finally {
      this.charge(this.clock.now() - start);
    }
  }

  /** Called at the start of a task this module scheduled itself. */
  startTask(): void {
    this.spent = 0;
  }

  private charge(ms: number): void {
    this.spent += ms;
    if (this.armed) return;
    this.armed = true;
    this.clock.later(() => {
      this.armed = false;
      this.spent = 0;
    });
  }
}

/**
 * First in, first out, as much per task as the budget allows.
 *
 * Equations mount in document order, so the ones at the top of the page are
 * drawn first. Each task runs at least one job, so the queue always drains.
 */
export class SlicedQueue {
  private readonly jobs: Array<() => void> = [];
  private scheduled = false;
  private readonly budget: TaskBudget;
  private readonly clock: Clock;

  constructor(budget: TaskBudget, clock: Clock = browserClock) {
    this.budget = budget;
    this.clock = clock;
  }

  get size(): number {
    return this.jobs.length;
  }

  /** Run `fn` (synchronous work) in a later slice; settles with its result. */
  run<T>(fn: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.jobs.push(() => {
        try {
          resolve(this.budget.measure(fn));
        } catch (error) {
          reject(error);
        }
      });
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.clock.later(this.drain);
  }

  private readonly drain = (): void => {
    this.scheduled = false;
    this.budget.startTask();
    do this.jobs.shift()!();
    while (this.jobs.length > 0 && this.budget.available());
    if (this.jobs.length > 0) this.schedule();
  };
}
