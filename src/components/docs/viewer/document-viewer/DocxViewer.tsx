import { useEffect, useState } from "react";
import { dataUrlToArrayBuffer } from "@/lib/markdown/document-utils";
import { ErrorState, Loading, ViewerFrame, ViewerMasthead } from "./shared";
import type { Props } from "./shared";

interface MammothBrowser {
  convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
}

export function DocxViewer({
  file,
  embedded,
  isBookmarked,
  onToggleBookmark,
  prevFile,
  nextFile,
  onNavFile,
  onOpenPalette,
}: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setHtml(null);
    setError("");
    void (async () => {
      try {
        const buffer = await dataUrlToArrayBuffer(file.data);
        if (!alive) return;
        if (!buffer) throw new Error("Missing document data");
        const module = (await import("mammoth/mammoth.browser")) as unknown as {
          default?: MammothBrowser;
        } & MammothBrowser;
        const mammoth = module.default ?? module;
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
        // mammoth's output is HTML derived from an untrusted file, and it goes
        // straight into `dangerouslySetInnerHTML` below. mammoth does not
        // promise a safe subset — a crafted .docx can carry through markup that
        // executes — so the string is sanitized before it is ever mounted.
        // Dropped in its own chunk alongside mammoth, so readers who never open
        // a Word file pay nothing for it.
        const { default: DOMPurify } = await import("dompurify");
        const safe = DOMPurify.sanitize(result.value);
        if (alive) setHtml(safe);
      } catch {
        if (alive) setError("This Word document could not be read in the browser.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [file.data]);
  return (
    <ViewerFrame
      file={file}
      embedded={embedded}
      isBookmarked={isBookmarked}
      onToggleBookmark={onToggleBookmark}
      prevFile={prevFile}
      nextFile={nextFile}
      onNavFile={onNavFile}
      onOpenPalette={onOpenPalette}
    >
      {error ? (
        <ErrorState message={error} />
      ) : html === null ? (
        <Loading label="Formatting Word document" />
      ) : (
        <div className="mx-auto max-w-5xl p-4 md:p-7">
          {!embedded && <ViewerMasthead file={file} kindLabel="Word document" />}
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-(--shadow-1)">
            {html ? (
              <article
                className="docx-prose mx-auto max-w-4xl px-5 py-8 md:px-12 md:py-12"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <p className="px-5 py-16 text-center text-sm text-muted-foreground">
                This document is empty.
              </p>
            )}
          </div>
        </div>
      )}
    </ViewerFrame>
  );
}
