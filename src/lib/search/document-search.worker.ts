import { DocumentSearch, runSearch, type SearchFile } from "./document-search";

let files: SearchFile[] = [];
let generation = 0;
const index = new DocumentSearch();
self.onmessage = (event: MessageEvent<{ files?: SearchFile[]; query?: string; id: number }>) => {
  const request = event.data;
  const current = ++generation;
  if (request.files) files = request.files;
  if (request.query === undefined) return;
  void runSearch(index, files, request.query, () => current !== generation)
    .then((hits) => {
      if (hits && current === generation) self.postMessage({ id: request.id, hits });
    })
    .catch(() => {
      if (current === generation) self.postMessage({ id: request.id, error: true });
    });
};
