import { DocumentIndex } from "./document-index";
import { handleSearchRequest, type SearchRequest } from "./protocol";

const index = new DocumentIndex();

self.onmessage = (event: MessageEvent<SearchRequest>) => {
  void handleSearchRequest(index, event.data).then((response) => self.postMessage(response));
};
