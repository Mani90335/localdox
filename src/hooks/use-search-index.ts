import { useEffect, useMemo, useRef, useState } from "react";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { persistence } from "@/lib/workspace/persistence";
import type { SearchHit } from "@/lib/search/schema";
import {
  createLocalSearchClient,
  createWorkerSearchClient,
  SearchClosedError,
  type SearchClient,
} from "@/lib/search/search-client";

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

/** One index backend and what has been sent to it. Replacing the backend
 *  (panel reopened, worker failed) starts a fresh session, so nothing
 *  believes a workspace is indexed in an index that never saw it. */
interface Session {
  client: SearchClient;
  /** Workspaces this session has been asked to index and not to drop. */
  indexed: Set<string>;
}

export type SearchError = "search" | "index" | null;

/** Owns the search Worker (with a main-thread fallback), keeps the current
 *  workspace's index in sync with `files`, and — only while `crossWorkspace`
 *  is on — lazily fetches and indexes every other workspace, dropping them
 *  again the moment the toggle turns back off.
 *
 *  Requests settle on every path (result, error reply, worker failure or
 *  close); the query reruns whenever an acknowledged mutation advances the
 *  index generation. */
export function useSearchIndex({
  active,
  currentWorkspaceId,
  files,
  workspaces,
  query,
  crossWorkspace,
}: Options) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [pending, setPending] = useState(false);
  const [loadingIds, setLoadingIds] = useState<string[]>([]);
  const [fallback, setFallback] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [generation, setGeneration] = useState(0);
  const [readyWorkspaceId, setReadyWorkspaceId] = useState<string | null>(null);
  const [error, setError] = useState<SearchError>(null);
  const [retry, setRetry] = useState(0);

  const searchReqId = useRef(0);
  const loadCounts = useRef(new Map<string, number>());
  const currentIdRef = useRef(currentWorkspaceId);
  currentIdRef.current = currentWorkspaceId;

  useEffect(() => {
    if (!active) return;
    let client: SearchClient;
    if (fallback) client = createLocalSearchClient();
    else {
      try {
        const worker = new Worker(
          new URL("../lib/search/document-index.worker.ts", import.meta.url),
          { type: "module" },
        );
        client = createWorkerSearchClient(worker, () => setFallback(true));
      } catch {
        setFallback(true);
        return;
      }
    }
    const next: Session = { client, indexed: new Set() };
    setSession(next);
    setGeneration(0);
    setReadyWorkspaceId(null);
    setError(null);
    return () => {
      client.close();
      setSession((current) => (current === next ? null : current));
    };
  }, [active, fallback]);

  const otherWorkspaces = useMemo(
    () => (crossWorkspace ? workspaces.filter((w) => w.id !== currentWorkspaceId) : []),
    [crossWorkspace, workspaces, currentWorkspaceId],
  );

  // Keep the indexed set of workspaces equal to "current, plus every other
  // workspace only while cross-workspace search is on" — this one
  // reconciliation loop handles toggling on/off and switching the current
  // workspace without any special-cased branches. The index applies
  // requests in the order they are sent, so a drop sent after a sync always
  // wins and a search sent after a sync sees it.
  useEffect(() => {
    if (!session) return;
    const { client, indexed } = session;
    const acknowledge = (next: number) => {
      if (!client.closed) setGeneration((current) => Math.max(current, next));
    };
    const failed = (reason: unknown) => {
      if (reason instanceof SearchClosedError || client.closed) return;
      console.warn("Search indexing failed", reason);
      setError("index");
    };

    if (currentWorkspaceId) {
      const workspaceId = currentWorkspaceId;
      indexed.add(workspaceId);
      client.sync(workspaceId, toSearchFiles(files)).then((next) => {
        acknowledge(next);
        if (!client.closed) setReadyWorkspaceId(workspaceId);
      }, failed);
    }

    const desired = new Set(otherWorkspaces.map((w) => w.id));
    for (const id of [...indexed]) {
      if (id === currentWorkspaceId || desired.has(id)) continue;
      indexed.delete(id);
      client.drop(id).then(acknowledge, failed);
    }

    const changeLoading = (id: string, delta: number) => {
      const count = (loadCounts.current.get(id) ?? 0) + delta;
      if (count > 0) loadCounts.current.set(id, count);
      else loadCounts.current.delete(id);
      setLoadingIds([...loadCounts.current.keys()]);
    };
    // A load is not abandoned when this effect re-runs (every edit re-runs
    // it): it checks, once the workspace has been read, whether this session
    // still wants it, so a claim is never left without a sync behind it.
    const load = async (id: string) => {
      changeLoading(id, 1);
      try {
        const record = await persistence.getWorkspace(id);
        // Dropped meanwhile, or now the current workspace, whose live files
        // are newer than this stored copy.
        if (client.closed || !indexed.has(id) || id === currentIdRef.current) return;
        if (!record) return;
        acknowledge(await client.sync(id, toSearchFiles(record.files)));
      } catch (reason) {
        if (reason instanceof SearchClosedError || client.closed) return;
        // Let a later pass retry this workspace.
        indexed.delete(id);
        failed(reason);
      } finally {
        changeLoading(id, -1);
      }
    };
    for (const summary of otherWorkspaces) {
      if (indexed.has(summary.id)) continue;
      indexed.add(summary.id);
      void load(summary.id);
    }
  }, [session, currentWorkspaceId, files, otherWorkspaces, retry]);

  useEffect(() => {
    const id = ++searchReqId.current;
    if (!session || !query.trim() || !currentWorkspaceId) {
      setHits([]);
      setTotal(0);
      setPending(false);
      setError((current) => (current === "search" ? null : current));
      return;
    }
    setPending(true);
    const timer = setTimeout(() => {
      const workspaceIds = [currentWorkspaceId, ...otherWorkspaces.map((w) => w.id)];
      session.client.search(query, workspaceIds).then(
        (next) => {
          if (id !== searchReqId.current) return;
          setHits(next.hits);
          setTotal(next.total);
          setPending(false);
          setError((current) => (current === "search" ? null : current));
        },
        (reason) => {
          // A closed client is always followed by a new session (or by
          // search closing), which re-runs this effect.
          if (id !== searchReqId.current || reason instanceof SearchClosedError) return;
          console.warn("Search failed", reason);
          setHits([]);
          setTotal(0);
          setPending(false);
          setError("search");
        },
      );
    }, 120);
    return () => clearTimeout(timer);
  }, [query, session, currentWorkspaceId, otherWorkspaces, generation, retry]);

  const loadingWorkspaces = useMemo(
    () => loadingIds.filter((id) => otherWorkspaces.some((w) => w.id === id)),
    [loadingIds, otherWorkspaces],
  );

  return {
    hits,
    /** Every match, including those past the returned hits. */
    total,
    pending,
    loadingWorkspaces,
    /** The current workspace's rows aren't in the index yet. */
    indexing: !!session && !!currentWorkspaceId && readyWorkspaceId !== currentWorkspaceId,
    error,
    retry: () => {
      setError(null);
      setRetry((count) => count + 1);
    },
  };
}
