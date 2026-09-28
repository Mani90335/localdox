import { useEffect, useRef, useState } from "react";
import { Code2, Eye } from "lucide-react";
import { ESCAPE_DEPTH, useNavEscape } from "@/hooks/use-nav-history";
import { ViewerFrame } from "./shared";
import type { Props } from "./shared";

/** How long typing has to pause before an HTML draft is handed to the parent. */
const HTML_AUTOSAVE_MS = 600;

/**
 * A standalone `.html` / `.htm` document, rendered rather than described.
 *
 * The page runs in a fully sandboxed frame — `sandbox=""`, matching
 * `InlineArtifact` — which is the whole security story here. An uploaded HTML
 * file is untrusted input: granting `allow-same-origin` would put it in the
 * app's own origin, where its scripts could read the entire IndexedDB
 * workspace. An empty sandbox blocks scripts, forms, popups and same-origin
 * access, so the preview shows layout and styling while the document stays
 * inert. `srcDoc` keeps it local — nothing is uploaded to render it.
 *
 * The source toggle is offered because a blocked-script page can look
 * misleadingly empty; seeing the markup explains why.
 *
 * The markup is also editable. An `.html` file is text the reader owns, the
 * same as a `.md` one, and it was the odd case out: the sidebar's "Edit" item
 * was simply absent for it, so a document you could read and whose source you
 * could stare at was the one document you could not change. Editing writes
 * through the same autosave path every other text document uses, and the
 * preview re-renders from the draft as soon as it lands.
 */
export function HtmlFileViewer({
  file,
  isBookmarked,
  onToggleBookmark,
  prevFile,
  nextFile,
  onNavFile,
  onContentChange,
  onOpenPalette,
  startInEditFileId,
  onStartInEditConsumed,
}: Props) {
  // Preview first: rendering the page is the point of opening it. Source is a
  // deliberate step away from that, the way it is in a browser.
  const [showSource, setShowSource] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(file.content);

  // The source Cancel puts back. Captured when the editor opens, not when the
  // document does: autosave has been writing the draft into `file.content`, so
  // a snapshot taken at open time would revert past an earlier session's work.
  const originalRef = useRef(file.content);

  // A new document starts in preview rather than inheriting the previous file's
  // mode — the toggle describes how you are reading *this* page. The draft is
  // re-seeded per document, not per content change, so the parent echoing an
  // autosave back doesn't clobber what has been typed since.
  useEffect(() => {
    setShowSource(false);
    setEditing(false);
    setDraft(file.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  // Autosave, matching the markdown and JSON editors.
  useEffect(() => {
    if (!editing || draft === file.content) return;
    const timer = setTimeout(() => onContentChangeRef.current?.(file.id, draft), HTML_AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, editing, file.content, file.id]);

  const beginEdit = () => {
    originalRef.current = file.content;
    setDraft(file.content);
    setEditing(true);
  };

  const doneEdit = () => setEditing(false);

  const cancelEdit = () => {
    setDraft(originalRef.current);
    onContentChange?.(file.id, originalRef.current);
    setEditing(false);
  };

  // "Edit" from the file's sidebar menu, the same channel the other editors
  // are opened through.
  useEffect(() => {
    if (startInEditFileId !== file.id || editing) return;
    beginEdit();
    onStartInEditConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startInEditFileId, file.id]);

  useNavEscape(editing, cancelEdit, ESCAPE_DEPTH.mode);
  useNavEscape(!editing && showSource, () => setShowSource(false), ESCAPE_DEPTH.mode);

  // While editing, the preview follows the draft rather than the last saved
  // content, so the frame is a live answer to what has just been typed.
  const previewSource = editing ? draft : file.content;

  return (
    <ViewerFrame
      file={file}
      isBookmarked={isBookmarked}
      onToggleBookmark={onToggleBookmark}
      prevFile={prevFile}
      nextFile={nextFile}
      onNavFile={onNavFile}
      onOpenPalette={onOpenPalette}
      action={
        editing ? (
          // The editing session's own controls, the way the JSON editor does
          // it. Entering the editor stays a file action in the sidebar menu.
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={cancelEdit}
              className="flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium text-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doneEdit}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-2.5 text-xs font-medium text-background hover:opacity-90"
            >
              <Eye className="h-3.5 w-3.5" /> Done · Preview
            </button>
          </div>
        ) : editing ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={cancelEdit}
              className="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doneEdit}
              className="inline-flex h-8 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
              title="Save and stop editing"
            >
              Done
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowSource((on) => !on)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-pressed={showSource}
          >
            {showSource ? (
              <>
                <Eye className="h-3.5 w-3.5" /> Preview
              </>
            ) : (
              <>
                <Code2 className="h-3.5 w-3.5" /> Source
              </>
            )}
          </button>
        )
      }
    >
      {editing ? (
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            aria-label="Edit HTML source"
            className="h-[calc(100dvh-16rem)] w-full resize-none rounded-xl border border-hairline bg-surface-sunken p-4 font-mono text-sm leading-6 text-foreground outline-none focus:ring-2 focus:ring-primary/20"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Editing the page source — changes save automatically.
          </p>
          {/* The live result, kept alongside the markup rather than behind a
              toggle: an HTML edit is only meaningful next to what it renders. */}
          <div className="mt-4 overflow-hidden rounded-xl border border-border">
            <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
              Preview
            </div>
            <iframe
              title={`${file.name} preview`}
              srcDoc={previewSource}
              sandbox=""
              className="h-[45dvh] w-full border-0 bg-white"
            />
          </div>
        </div>
      ) : showSource ? (
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
          <pre className="overflow-x-auto rounded-xl border border-border bg-muted/30 p-4 text-xs leading-relaxed">
            <code>{file.content}</code>
          </pre>
        </div>
      ) : (
        <iframe
          title={file.name}
          srcDoc={previewSource}
          sandbox=""
          className="h-[calc(100dvh-7.5rem)] w-full border-0 bg-white"
        />
      )}
    </ViewerFrame>
  );
}
