import { SpreadsheetEngine, type Xlsx } from "./engine.ts";
import type { RowWindow, SheetLayout, SheetSort, SpreadsheetSource, ViewInfo } from "./engine.ts";
import {
  handleSpreadsheetRequest,
  type SpreadsheetRequest,
  type SpreadsheetResponse,
} from "./protocol.ts";

/** The client was closed (or its worker died) before the request settled. */
export class SpreadsheetClosedError extends Error {
  constructor(message = "Spreadsheet closed") {
    super(message);
    this.name = "SpreadsheetClosedError";
  }
}

/** The engine replied that this request failed (an unreadable file, say). */
export class SpreadsheetRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpreadsheetRequestError";
  }
}

/** One open spreadsheet. Every promise settles: with the result, a
 *  SpreadsheetRequestError, or a SpreadsheetClosedError once closed. */
export interface SpreadsheetClient {
  open(source: SpreadsheetSource): Promise<string[]>;
  layout(sheet: number): Promise<SheetLayout>;
  /** Null when a newer view request overtook this one. */
  view(sheet: number, query: string, sort: SheetSort): Promise<ViewInfo | null>;
  /** Null when the view has since been replaced. */
  rows(
    viewId: number,
    start: number,
    end: number,
    columnStart: number,
    columnEnd: number,
  ): Promise<RowWindow | null>;
  close(): void;
  readonly closed: boolean;
}

type Payload<T> = T extends unknown ? Omit<T, "reqId"> : never;
type Send = (request: Payload<SpreadsheetRequest>) => Promise<SpreadsheetResponse>;

function clientOver(send: Send, close: () => void, isClosed: () => boolean): SpreadsheetClient {
  const expect = async <T extends SpreadsheetResponse["type"]>(
    request: Payload<SpreadsheetRequest>,
    type: T,
  ): Promise<Extract<SpreadsheetResponse, { type: T }> | null> => {
    const response = await send(request);
    if (response.type === "error") throw new SpreadsheetRequestError(response.message);
    if (response.type === "superseded" || response.type === "stale") return null;
    if (response.type !== type) throw new SpreadsheetRequestError(`Unexpected ${response.type}`);
    return response as Extract<SpreadsheetResponse, { type: T }>;
  };
  const required = <T>(value: T | null): T => {
    if (value == null) throw new SpreadsheetRequestError("Unexpected empty reply");
    return value;
  };
  return {
    open: async (source) => required(await expect({ type: "open", source }, "opened")).sheets,
    layout: async (sheet) => required(await expect({ type: "layout", sheet }, "layout")).layout,
    view: async (sheet, query, sort) =>
      (await expect({ type: "view", sheet, query, sort }, "view"))?.view ?? null,
    rows: async (viewId, start, end, columnStart, columnEnd) =>
      (await expect({ type: "rows", viewId, start, end, columnStart, columnEnd }, "rows"))
        ?.window ?? null,
    close,
    get closed() {
      return isClosed();
    },
  };
}

export type SpreadsheetWorker = Pick<
  Worker,
  "postMessage" | "addEventListener" | "removeEventListener" | "terminate"
>;

/** Talks to a spreadsheet worker. A worker error or undeliverable message is
 *  fatal: the worker is terminated, every outstanding request rejects with
 *  SpreadsheetClosedError, and `onFailure` runs once. */
export function createWorkerSpreadsheetClient(
  worker: SpreadsheetWorker,
  onFailure: (reason: unknown) => void,
): SpreadsheetClient {
  const pending = new Map<
    number,
    { resolve: (response: SpreadsheetResponse) => void; reject: (error: unknown) => void }
  >();
  let nextReqId = 0;
  let closed = false;

  const onMessage = (event: MessageEvent<SpreadsheetResponse>) => {
    const entry = pending.get(event.data?.reqId);
    if (!entry) return;
    pending.delete(event.data.reqId);
    entry.resolve(event.data);
  };
  const onError = (event: Event) => {
    if (closed) return;
    shutdown("Spreadsheet worker failed");
    onFailure(event);
  };
  const shutdown = (reason: string) => {
    if (closed) return;
    closed = true;
    worker.removeEventListener("message", onMessage);
    worker.removeEventListener("error", onError);
    worker.removeEventListener("messageerror", onError);
    // Terminating frees the parsed workbook with the worker's heap.
    worker.terminate();
    const error = new SpreadsheetClosedError(reason);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onError);
  worker.addEventListener("messageerror", onError);

  const send: Send = (request) => {
    if (closed) return Promise.reject(new SpreadsheetClosedError());
    const reqId = ++nextReqId;
    return new Promise((resolve, reject) => {
      pending.set(reqId, { resolve, reject });
      try {
        worker.postMessage({ ...request, reqId });
      } catch (error) {
        pending.delete(reqId);
        reject(error);
      }
    });
  };
  return clientOver(
    send,
    () => shutdown("Spreadsheet closed"),
    () => closed,
  );
}

/** Runs the engine on this thread, for when a worker isn't available. */
export function createLocalSpreadsheetClient(loadXlsx: () => Promise<Xlsx>): SpreadsheetClient {
  let engine: Promise<SpreadsheetEngine> | null = null;
  let nextReqId = 0;
  let closed = false;
  const send: Send = async (request) => {
    if (closed) throw new SpreadsheetClosedError();
    engine ??= loadXlsx().then((xlsx) => new SpreadsheetEngine(xlsx));
    const response = await handleSpreadsheetRequest(await engine, {
      ...request,
      reqId: ++nextReqId,
    } as SpreadsheetRequest);
    if (closed) throw new SpreadsheetClosedError();
    return response;
  };
  return clientOver(
    send,
    () => {
      closed = true;
    },
    () => closed,
  );
}
