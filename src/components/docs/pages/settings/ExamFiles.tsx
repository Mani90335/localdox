import { useCallback, useEffect, useState } from "react";
import { Section, Group, Row, Empty } from "./primitives";
import { formatBytes } from "@/lib/workspace/storage-limits";
import type { StoredExamFile } from "@/services/exams/manage";

// Exam Workspaces keeps its own database; its code loads only when this shows.
const manage = () => import("@/services/exams/manage");

/** Exams and study plans uploaded to Exam Workspaces, each deletable. */
export function ExamFiles() {
  const [files, setFiles] = useState<StoredExamFile[] | null>(null),
    [deleting, setDeleting] = useState<string | null>(null),
    [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setFiles(await (await manage()).listExamFiles());
    } catch (e) {
      setFiles([]);
      setError(`Exam files could not be read. ${e instanceof Error ? e.message : ""}`);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function remove(file: StoredExamFile) {
    const attempts = file.attempts
      ? ` and its ${file.attempts} attempt${file.attempts === 1 ? "" : "s"}`
      : "";
    if (!window.confirm(`Permanently delete "${file.name}"${attempts}?`)) return;
    setDeleting(`${file.workspaceId ?? "legacy"}:${file.kind}:${file.id}`);
    setError("");
    try {
      await (await manage()).deleteExamFile(file);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Section
      title="Exam files"
      description="Exams and study plans you uploaded to Exam Workspaces. Deleting one also deletes its attempts and progress."
    >
      <Group>
        {files === null ? (
          <Row label="Exam files" hint="Loading…" />
        ) : files.length === 0 ? (
          <Empty>No uploaded exam files.</Empty>
        ) : (
          files.map((file) => {
            const key = `${file.workspaceId ?? "legacy"}:${file.kind}:${file.id}`;
            return (
              <Row
                key={key}
                label={file.name}
                hint={[
                  file.detail,
                  `${file.attempts} attempt${file.attempts === 1 ? "" : "s"}`,
                  formatBytes(file.bytes),
                ].join(" · ")}
                control={
                  <button
                    onClick={() => void remove(file)}
                    disabled={deleting !== null}
                    aria-label={`Delete ${file.name}`}
                    className="coarse:min-h-11 coarse:px-3 rounded-md px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                  >
                    {deleting === key ? "Deleting…" : "Delete"}
                  </button>
                }
              />
            );
          })
        )}
        {error && (
          <p role="alert" className="px-4 py-3 text-xs leading-relaxed text-destructive">
            {error}
          </p>
        )}
      </Group>
    </Section>
  );
}
