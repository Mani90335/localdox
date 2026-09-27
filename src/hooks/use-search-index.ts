import { useEffect, useMemo, useRef, useState } from "react";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { persistence } from "@/lib/workspace/persistence";
import { DocumentIndex } from "@/lib/search/document-index";
import type { SearchHit } from "@/lib/search/schema";
import type { WorkerRequest, WorkerResponse } from "@/lib/search/document-index.worker";

function toSearchFiles(
  files: { id: string; name: string; content: string; deletedAt?: number | null }[],
) {
  return files
    .filter((file) => !file.deletedAt)
    .map(({ id, name, content }) => ({ id, name, content }));
}

interface Options {
  active: boolean;
  currentWorkspaceId: string | null;
  files: MdFile[];
  workspaces: { id: string; name: string }[];
  query: string;
  crossWorkspace: boolean;
}

/** Owns the search Worker (with a synchronous main-thread fallback), keeps
 *  the current workspace's index in sync with `files`, and — only while
 *  `crossWorkspace` is on — lazily fetches and indexes every other
 *  workspace, dropping them again the moment the toggle turns back off. */
export function useSearchIndex({
  active,
  currentWorkspaceId,
  files,
  workspaces,
  query,
  crossWorkspace,
}: Options) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pending, setPending] = useState(false);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState<string[]>([]);
  const [fallback, setFallback] = useState(false);
  const [indexVersion, setIndexVersion] = useState(0);

  const worker = useRef<Worker | null>(null);
  const fallbackIndex = useRef<DocumentIndex | null>(null);
  const reqId = useRef(0);
  const searchReqId = useRef(0);
  const syncedIds = useRef(new Set<string>());

  const post = (request: WorkerRequest): Promise<WorkerResponse> => {
    if (worker.current) {
      const instance = worker.current;
      return new Promise((resolve) => {
        const onMessage = (event: MessageEvent<WorkerResponse>) => {
          if (event.data.reqId !== request.reqId) return;
          instance.removeEventListener("message", onMessage);
          resolve(event.data);
        };
        instance.addEventListener("message", onMessage);
        instance.postMessage(request);
      });
    }
    fallbackIndex.current ??= new DocumentIndex();
    const index = fallbackIndex.current;
    switch (request.type) {
      case "sync":
        return index
          .syncWorkspace(request.workspaceId, request.files)
          .then(() => ({ reqId: request.reqId, type: "ack" as const }));
      case "drop":
        return index
          .dropWorkspace(request.workspaceId)
          .then(() => ({ reqId: request.reqId, type: "ack" as const }));
      case "search":
        return index
          .search(request.query, request.workspaceIds)
          .then((hits) => ({ reqId: request.reqId, type: "hits" as const, hits }));
    }
  };

  useEffect(() => {
    if (!active || fallback) return;
    try {
      const instance = new Worker(
        new URL("../lib/search/document-index.worker.ts", import.meta.url),
        { type: "module" },
      );
      instance.onerror = () => {
        instance.terminate();
        worker.current = null;
        syncedIds.current.clear();
        setFallback(true);
      };
      worker.current = instance;
      return () => {
        instance.terminate();
        worker.current = null;
      };
    } catch {
      setFallback(true);
    }
  }, [active, fallback]);

  const otherWorkspaces = useMemo(
    () => (crossWorkspace ? workspaces.filter((w) => w.id !== currentWorkspaceId) : []),
    [crossWorkspace, workspaces, currentWorkspaceId],
  );

  // Keep the indexed set of workspaces equal to "current, plus every other
  // workspace only while cross-workspace search is on" — this one
  // reconciliation loop handles toggling on/off and switching the current
  // workspace without any special-cased branches.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      if (currentWorkspaceId) {
        syncedIds.current.add(currentWorkspaceId);
        const response = await post({
          reqId: ++reqId.current,
          type: "sync",
          workspaceId: currentWorkspaceId,
          files: toSearchFiles(files),
        });
        // The query may have already run against the previous index (or an
        // empty one during startup). Refresh it only after the rows are ready.
        if (!cancelled && response.type === "ack") setIndexVersion((version) => version + 1);
      }
      if (cancelled) return;

      const desiredOtherIds = new Set(otherWorkspaces.map((w) => w.id));
      const toDrop = [...syncedIds.current].filter(
        (id) => id !== currentWorkspaceId && !desiredOtherIds.has(id),
      );
      for (const id of toDrop) {
        syncedIds.current.delete(id);
        void post({ reqId: ++reqId.current, type: "drop", workspaceId: id });
      }

      const toLoad = otherWorkspaces.filter((w) => !syncedIds.current.has(w.id));
      if (!toLoad.length) return;
      setLoadingWorkspaces((prev) => [...new Set([...prev, ...toLoad.map((w) => w.id)])]);
      await Promise.all(
        toLoad.map(async (summary) => {
          const record = await persistence.getWorkspace(summary.id);
          if (cancelled || !record) return;
          syncedIds.current.add(summary.id);
          const response = await post({
            reqId: ++reqId.current,
            type: "sync",
            workspaceId: summary.id,
            files: toSearchFiles(record.files),
          });
          if (!cancelled && response.type === "ack") setIndexVersion((version) => version + 1);
          if (!cancelled) setLoadingWorkspaces((prev) => prev.filter((id) => id !== summary.id));
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [active, currentWorkspaceId, files, otherWorkspaces, fallback]);

  useEffect(() => {
    const id = ++searchReqId.current;
    if (!active || !query.trim() || !currentWorkspaceId) {
      setHits([]);
      setPending(false);
      return;
    }
    setPending(true);
    const timer = setTimeout(() => {
      const workspaceIds = [currentWorkspaceId, ...otherWorkspaces.map((w) => w.id)];
      void post({ reqId: ++reqId.current, type: "search", query, workspaceIds }).then(
        (response) => {
          if (id !== searchReqId.current || response.type !== "hits") return;
          setHits(response.hits);
          setPending(false);
        },
      );
    }, 120);
    return () => clearTimeout(timer);
  }, [query, active, currentWorkspaceId, otherWorkspaces, fallback, indexVersion]);

  return { hits, pending, loadingWorkspaces };
}
