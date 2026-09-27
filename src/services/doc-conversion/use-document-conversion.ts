import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  canConvertToMarkdown,
  CONVERSION_TIMEOUT_MS,
  describeConversionError,
  sameSource,
} from "./types";
import type { ConversionFailure, ConversionResult, ConversionSource } from "./types";

export function useDocumentConversion({
  workspaceId,
  files,
  commit,
}: {
  workspaceId: string | null;
  files: ConversionSource[];
  commit: (
    source: ConversionSource,
    result: ConversionResult,
    workspaceId: string,
  ) => Promise<void>;
}) {
  const [runningId, setRunningId] = useState<string | null>(null);
  const committing = useRef(false);
  const current = useRef({ workspaceId, files, commit });
  current.current = { workspaceId, files, commit };
  const job = useRef<{
    worker: Worker;
    source: ConversionSource;
    workspaceId: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const cancel = useCallback(() => {
    if (!job.current) return;
    job.current.worker.terminate();
    clearTimeout(job.current.timer);
    job.current = null;
    setRunningId(null);
    toast.dismiss("document-conversion");
  }, []);
  useEffect(() => cancel, [workspaceId, cancel]);
  useEffect(() => {
    if (
      job.current &&
      !sameSource(
        files.find((f) => f.id === job.current?.source.id),
        job.current.source,
      )
    )
      cancel();
  }, [files, cancel]);

  const start = useCallback(
    (id: string) => {
      if (job.current || committing.current) {
        toast.info("A conversion is already running. Cancel it before starting another.");
        return;
      }
      const { files, workspaceId } = current.current;
      const source = files.find((file) => file.id === id);
      if (!workspaceId || !source || !canConvertToMarkdown(source)) return;
      try {
        const worker = new Worker(
          new URL("./conversion.worker.ts", import.meta.url),
          { type: "module" },
        );
        const fail = (error: ConversionFailure) => {
          if (job.current?.worker !== worker) return;
          cancel();
          toast.error(describeConversionError(error), { duration: 10000 });
        };
        const timer = setTimeout(() => fail({ code: "timeout" }), CONVERSION_TIMEOUT_MS);
        job.current = { worker, source: { ...source }, workspaceId, timer };
        setRunningId(id);
        toast.loading(`Converting ${source.name} on this device…`, {
          id: "document-conversion",
          description: "Text, tables, and links. Embedded images remain in the original.",
          action: { label: "Cancel", onClick: cancel },
        });
        worker.onerror = () => fail({ code: "startup" });
        worker.onmessage = async (
          event: MessageEvent<{ result?: ConversionResult; error?: ConversionFailure }>,
        ) => {
          if (job.current?.worker !== worker) return;
          if (event.data.error) return fail(event.data.error);
          const result = event.data.result;
          if (!result) return fail({ code: "unknown" });
          cancel();
          if (
            current.current.workspaceId !== workspaceId ||
            !sameSource(
              current.current.files.find((f) => f.id === id),
              source,
            )
          )
            return;
          try {
            committing.current = true;
            setRunningId(id);
            await current.current.commit(source, result, workspaceId);
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : "Could not save the Markdown copy. The original is unchanged.",
            );
          } finally {
            committing.current = false;
            setRunningId(null);
          }
        };
        worker.postMessage({
          id: source.id,
          name: source.name,
          content: source.content,
          data: source.data,
        });
      } catch {
        cancel();
        toast.error(describeConversionError({ code: "startup" }));
      }
    },
    [cancel],
  );
  return { runningId, start, cancel };
}
