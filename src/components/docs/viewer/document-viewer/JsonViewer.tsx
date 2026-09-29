import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ListTree, Network } from "lucide-react";
import { DISCARD_PROMPT } from "@/lib/markdown/document-utils";
import { ESCAPE_DEPTH, useNavEscape } from "@/hooks/use-nav-history";
import { buildMindMap } from "@/services/mindmap";
import { JsonTree } from "../JsonTree";
import { Loading, ViewerFrame, ViewerMasthead } from "./shared";
import type { Props } from "./shared";

// Only readers who actually open a mind map pay for the layout engine and its
// renderer, in keeping with how the spreadsheet and Word viewers load.
const MindMapView = lazy(() =>
  import("@/services/mindmap/MindMapView").then((module) => ({ default: module.MindMapView })),
);

export function JsonViewer({
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
  const [mode, setMode] = useState<"tree" | "mindmap">("tree");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(file.content);

  const formatted = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(file.content), null, 2);
    } catch {
      return file.content;
    }
  }, [file.content]);

  // Parsed once per document, and shared by the tree and the mind map. `null`
  // means the file isn't valid JSON, in which case only the raw views apply.
  const parsed = useMemo<{ value: unknown } | null>(() => {
    try {
      return { value: JSON.parse(file.content) };
    } catch {
      return null;
    }
  }, [file.content]);

  // The draft is re-seeded per document rather than per content change, so a
  // content echo from the parent doesn't clobber what's been typed since.
  useEffect(() => {
    setDraft(file.content);
    setEditing(false);
    setMode("tree");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  const draftError = useMemo(() => {
    if (!editing) return null;
    try {
      JSON.parse(draft);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid JSON";
    }
  }, [draft, editing]);

  // Commit and leave, matching the markdown editor: nothing is written until
  // the reader presses Done. Invalid JSON can't be committed at all, so a
  // document is never persisted in a half-typed state.
  const commitEdit = () => {
    if (draftError) return;
    if (draft !== file.content) onContentChange?.(file.id, draft);
    setEditing(false);
  };

  const beginEdit = () => {
    setDraft(formatted);
    setEditing(true);
    // The editor is itself the raw view, so there is no separate raw mode to
    // switch to — only the mind map has to be left behind.
    setMode("tree");
  };

  // Discard: the draft was never written, so dropping it is the whole job.
  const cancelEdit = () => {
    setDraft(file.content);
    setEditing(false);
  };

  // "Edit" from the file's sidebar menu. Entering the editor is no longer a
  // header button, so this is how the request arrives.
  useEffect(() => {
    if (startInEditFileId !== file.id || editing) return;
    beginEdit();
    onStartInEditConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startInEditFileId, file.id]);

  // Back leaves the editor and the mind map, the same as their own exit
  // controls do — a mode you entered is the last thing you did, so it is the
  // first thing back should undo.
  //
  // Leaving discards, so a draft with real changes in it asks first. Nothing is
  // written on the way out: Done is the only path that saves.
  const escapeEdit = () => {
    if (draft !== file.content && !window.confirm(DISCARD_PROMPT)) return;
    cancelEdit();
  };
  useNavEscape(editing, escapeEdit, ESCAPE_DEPTH.mode);
  useNavEscape(!editing && mode === "mindmap", () => setMode("tree"), ESCAPE_DEPTH.mode);

  const applyFormat = () => {
    try {
      setDraft(JSON.stringify(JSON.parse(draft), null, 2));
    } catch {
      // Unparseable drafts are left exactly as typed; the inline error already
      // says why, and reformatting would have nothing to work from.
    }
  };

  // Built once per document. Invalid JSON, a flat shape, or a file too large to
  // draw all return null, and the action is simply not offered — the viewer
  // below is unchanged in every one of those cases.
  const mindMap = useMemo(
    () => buildMindMap(file.content, file.name.replace(/\.json$/i, "")),
    [file.content, file.name],
  );

  const lines = formatted.split("\n");
  const showMap = mode === "mindmap" && Boolean(mindMap);

  // A two-position toggle showing both destinations at once, so the mind map is
  // visibly available rather than hidden behind a button that renames itself.
  // Tree is the default and stays on the left.
  const modeSwitch =
    !editing && parsed && mindMap ? (
      <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5">
        {(
          [
            { value: "tree", label: "Tree", icon: ListTree },
            { value: "mindmap", label: "Mind map", icon: Network },
          ] as const
        ).map(({ value, label, icon: Icon }) => {
          const active = (value === "mindmap") === showMap;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={active}
              title={value === "mindmap" ? "Show as mind map" : "Show as tree"}
              className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <ViewerFrame
      file={file}
      isBookmarked={isBookmarked}
      onToggleBookmark={onToggleBookmark}
      prevFile={prevFile}
      nextFile={nextFile}
      onNavFile={onNavFile}
      onOpenPalette={onOpenPalette}
      editing={editing}
      navAction={modeSwitch}
      action={
        // Entering the editor is the file's own action and lives in its
        // sidebar menu. What stays here belongs to the editing session itself:
        // reformatting the draft, and leaving.
        editing ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={applyFormat}
              className="flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Format
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            {/* The only write path. Disabled on a draft that isn't valid JSON —
                the inline error below says why. */}
            <button
              type="button"
              onClick={commitEdit}
              disabled={Boolean(draftError)}
              title={draftError ? "Fix the JSON before saving" : "Save and stop editing"}
              className="flex h-8 items-center rounded-md bg-foreground px-2.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Done · Save
            </button>
          </div>
        ) : null
      }
    >
      {showMap ? (
        <Suspense fallback={<Loading label="Building mind map" />}>
          <MindMapView tree={mindMap!} />
        </Suspense>
      ) : (
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
          <ViewerMasthead
            file={file}
            kindLabel="JSON"
            meta={
              parsed && !editing
                ? `${lines.length.toLocaleString()} ${lines.length === 1 ? "line" : "lines"}`
                : undefined
            }
          />
          {editing ? (
            <div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                aria-label="Edit JSON"
                className={`h-[calc(100dvh-13rem)] w-full resize-none rounded-xl border bg-surface-sunken p-4 font-mono text-sm leading-6 text-foreground outline-none focus:ring-2 ${
                  draftError
                    ? "border-destructive focus:ring-destructive/20"
                    : "border-border focus:ring-primary/20"
                }`}
              />
              <p
                className={`mt-2 text-xs ${draftError ? "text-destructive" : "text-muted-foreground"}`}
                role={draftError ? "alert" : undefined}
              >
                {draftError ?? "Valid JSON — Done saves, Cancel discards."}
              </p>
            </div>
          ) : parsed ? (
            <JsonTree value={parsed.value} />
          ) : (
            <pre className="max-h-[calc(100dvh-13rem)] overflow-auto rounded-xl border border-hairline bg-surface-sunken p-4 text-sm leading-6 text-foreground">
              <code>
                {lines.map((line, index) => (
                  <div key={index}>
                    <span className="mr-5 inline-block w-7 select-none text-right text-muted-foreground/70">
                      {index + 1}
                    </span>
                    {line}
                  </div>
                ))}
              </code>
            </pre>
          )}
        </div>
      )}
    </ViewerFrame>
  );
}
