import type { DocumentIndex } from "./document-index.ts";
import type { SearchFile, SearchResults } from "./schema.ts";

// The messages exchanged with the search worker. Every request gets exactly
// one reply carrying its reqId: a result, or a terminal "error" when the
// operation threw, so the caller can always settle the request.

export type SearchRequest =
  | { reqId: number; type: "sync"; workspaceId: string; files: SearchFile[] }
  | { reqId: number; type: "drop"; workspaceId: string }
  | { reqId: number; type: "search"; query: string; workspaceIds: string[] };

export type SearchResponse =
  /** `generation` is the index generation once this mutation has applied. */
  | { reqId: number; type: "ack"; generation: number }
  | ({ reqId: number; type: "hits" } & SearchResults)
  | { reqId: number; type: "error"; message: string };

/** Runs one request against `index`. Never rejects: failures become an
 *  "error" reply. The index applies requests in the order they arrive. */
export async function handleSearchRequest(
  index: DocumentIndex,
  request: SearchRequest,
): Promise<SearchResponse> {
  try {
    switch (request.type) {
      case "sync":
        return {
          reqId: request.reqId,
          type: "ack",
          generation: await index.syncWorkspace(request.workspaceId, request.files),
        };
      case "drop":
        return {
          reqId: request.reqId,
          type: "ack",
          generation: await index.dropWorkspace(request.workspaceId),
        };
      case "search":
        return {
          reqId: request.reqId,
          type: "hits",
          ...(await index.search(request.query, request.workspaceIds)),
        };
    }
  } catch (error) {
    return {
      reqId: request.reqId,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
