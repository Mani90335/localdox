import { useEffect, useMemo, useRef, useState } from "react";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { DocumentSearch, runSearch, type SearchHit } from "@/lib/search/document-search";

export function useDocumentSearch(files: MdFile[], query: string, open: boolean) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pending, setPending] = useState(false);
  const [fallback, setFallback] = useState(false);
  const worker = useRef<Worker | null>(null);
  const serial = useRef(0);
  const fallbackIndex = useRef<DocumentSearch | null>(null);
  const documents = useMemo(
    () =>
      files
        .filter((file) => !file.deletedAt)
        .map(({ id, name, content }) => ({ id, name, content })),
    [files],
  );

  useEffect(() => {
    if (!open || fallback) return;
    try {
      const instance = new Worker(new URL("../lib/search/document-search.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.current = instance;
      instance.onerror = () => {
        instance.terminate();
        worker.current = null;
        setFallback(true);
      };
      instance.onmessage = (
        event: MessageEvent<{ id: number; hits?: SearchHit[]; error?: boolean }>,
      ) => {
        if (event.data.id !== serial.current) return;
        if (event.data.error) {
          setFallback(true);
          return;
        }
        setHits(event.data.hits ?? []);
        setPending(false);
      };
      return () => {
        instance.terminate();
        worker.current = null;
      };
    } catch {
      setFallback(true);
    }
  }, [open, fallback]);

  useEffect(() => {
    if (open) worker.current?.postMessage({ files: documents, id: ++serial.current });
  }, [documents, open, fallback]);

  useEffect(() => {
    const id = ++serial.current;
    let cancelled = false;
    setHits([]);
    setPending(open && !!query.trim());
    // Cancel worker work immediately, even when clearing the input.
    worker.current?.postMessage({ id });
    if (!open || !query.trim()) return;
    const timer = setTimeout(() => {
      if (worker.current) worker.current.postMessage({ id, query });
      else {
        fallbackIndex.current ??= new DocumentSearch();
        void runSearch(fallbackIndex.current, documents, query, () => cancelled).then((result) => {
          if (result && !cancelled && id === serial.current) {
            setHits(result);
            setPending(false);
          }
        });
      }
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, documents, open, fallback]);

  return { hits, pending };
}
