import type { SearchRequest, SearchResponse } from "./protocol.ts";
import type { SearchFile, SearchResults } from "./schema.ts";

/** The client was closed (or its worker died) before the request settled. */
export class SearchClosedError extends Error {
  constructor(message = "Search index closed") {
    super(message);
    this.name = "SearchClosedError";
  }
}

/** The index replied that this request failed. */
export class SearchRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchRequestError";
  }
}

/** One search index session. Every promise it returns settles: with the
 *  result, a SearchRequestError, or a SearchClosedError once closed. */
export interface SearchClient {
  sync(workspaceId: string, files: SearchFile[]): Promise<number>;
  drop(workspaceId: string): Promise<number>;
  search(query: string, workspaceIds: string[]): Promise<SearchResults>;
  close(): void;
  readonly closed: boolean;
}

type Payload<T> = T extends unknown ? Omit<T, "reqId"> : never;
export type Send = (request: Payload<SearchRequest>) => Promise<SearchResponse>;

/** A SearchClient over any request/response transport. */
export function clientOver(send: Send, close: () => void, isClosed: () => boolean): SearchClient {
  const expect = async <T extends SearchResponse["type"]>(
    request: Payload<SearchRequest>,
    type: T,
  ): Promise<Extract<SearchResponse, { type: T }>> => {
    const response = await send(request);
    if (response.type === "error") throw new SearchRequestError(response.message);
    if (response.type !== type) throw new SearchRequestError(`Unexpected ${response.type} reply`);
    return response as Extract<SearchResponse, { type: T }>;
  };
  return {
    sync: async (workspaceId, files) =>
      (await expect({ type: "sync", workspaceId, files }, "ack")).generation,
    drop: async (workspaceId) => (await expect({ type: "drop", workspaceId }, "ack")).generation,
    search: async (query, workspaceIds) => {
      const { hits, total } = await expect({ type: "search", query, workspaceIds }, "hits");
      return { hits, total };
    },
    close,
    get closed() {
      return isClosed();
    },
  };
}

export type SearchWorker = Pick<
  Worker,
  "postMessage" | "addEventListener" | "removeEventListener" | "terminate"
>;

/** Talks to a search worker. A worker error or undeliverable message is
 *  fatal: the worker is terminated, every outstanding request rejects with
 *  SearchClosedError, and `onFailure` runs once so the caller can replace
 *  the backend. */
export function createWorkerSearchClient(
  worker: SearchWorker,
  onFailure: (reason: unknown) => void,
): SearchClient {
  const pending = new Map<
    number,
    { resolve: (response: SearchResponse) => void; reject: (error: unknown) => void }
  >();
  let nextReqId = 0;
  let closed = false;

  const onMessage = (event: MessageEvent<SearchResponse>) => {
    const entry = pending.get(event.data?.reqId);
    if (!entry) return;
    pending.delete(event.data.reqId);
    entry.resolve(event.data);
  };
  const onError = (event: Event) => {
    if (closed) return;
    shutdown("Search worker failed");
    onFailure(event);
  };
  const shutdown = (reason: string) => {
    if (closed) return;
    closed = true;
    worker.removeEventListener("message", onMessage);
    worker.removeEventListener("error", onError);
    worker.removeEventListener("messageerror", onError);
    worker.terminate();
    const error = new SearchClosedError(reason);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onError);
  worker.addEventListener("messageerror", onError);

  const send: Send = (request) => {
    if (closed) return Promise.reject(new SearchClosedError());
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
    () => shutdown("Search index closed"),
    () => closed,
  );
}
