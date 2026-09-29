// The main-thread search index, for browsers where the search worker can't
// start or dies. Its own module so the index code is downloaded only then:
// use-search-index imports it dynamically.

import { DocumentIndex } from "./document-index.ts";
import { handleSearchRequest, type SearchRequest } from "./protocol.ts";
import { SearchClosedError, clientOver, type SearchClient, type Send } from "./search-client.ts";

/** Runs the index on this thread, for when a worker isn't available. */
export function createLocalSearchClient(index = new DocumentIndex()): SearchClient {
  let nextReqId = 0;
  let closed = false;
  const send: Send = async (request) => {
    if (closed) throw new SearchClosedError();
    const response = await handleSearchRequest(index, {
      ...request,
      reqId: ++nextReqId,
    } as SearchRequest);
    if (closed) throw new SearchClosedError();
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
