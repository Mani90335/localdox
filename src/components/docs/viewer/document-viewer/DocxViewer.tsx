import { useEffect, useState } from "react";
import { dataUrlToArrayBuffer } from "@/lib/markdown/document-utils";
import { ErrorState, Loading, ViewerFrame } from "./shared";
import type { Props } from "./shared";

interface MammothBrowser {
  convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
}

export function DocxViewer({
  file,
  isBookmarked,
  onToggleBookmark,
  prevFile,
  nextFile,
  onNavFile,
  onOpenPalette,
}: Props) {
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const buffer = dataUrlToArrayBuffer(file.data);
    if (!buffer) {
      setError("This Word file is missing its document data.");
      return;
    }
    void (async () => {
      try {
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
      isBookmarked={isBookmarked}
      onToggleBookmark={onToggleBookmark}
      prevFile={prevFile}
      nextFile={nextFile}
      onNavFile={onNavFile}
      onOpenPalette={onOpenPalette}
    >
      {error ? (
        <ErrorState message={error} />
      ) : !html ? (
        <Loading label="Formatting Word document" />
      ) : (
        <article
          className="docx-prose mx-auto max-w-4xl px-5 py-10 md:px-10"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </ViewerFrame>
  );
}
