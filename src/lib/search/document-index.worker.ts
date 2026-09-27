import { DocumentIndex } from "./document-index";
import type { SearchFile, SearchHit } from "./schema";

export type WorkerRequest =
  | { reqId: number; type: "sync"; workspaceId: string; files: SearchFile[] }
  | { reqId: number; type: "drop"; workspaceId: string }
  | { reqId: number; type: "search"; query: string; workspaceIds: string[] };

export type WorkerResponse =
  | { reqId: number; type: "ack" }
  | { reqId: number; type: "hits"; hits: SearchHit[] }
  | { reqId: number; type: "error" };

const index = new DocumentIndex();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  void handle(request)
    .then((response) => self.postMessage(response))
    .catch(() =>
      self.postMessage({ reqId: request.reqId, type: "error" } satisfies WorkerResponse),
    );
};

async function handle(request: WorkerRequest): Promise<WorkerResponse> {
  switch (request.type) {
    case "sync":
      await index.syncWorkspace(request.workspaceId, request.files);
      return { reqId: request.reqId, type: "ack" };
    case "drop":
      await index.dropWorkspace(request.workspaceId);
      return { reqId: request.reqId, type: "ack" };
    case "search": {
      const hits = await index.search(request.query, request.workspaceIds);
      return { reqId: request.reqId, type: "hits", hits };
    }
  }
}
