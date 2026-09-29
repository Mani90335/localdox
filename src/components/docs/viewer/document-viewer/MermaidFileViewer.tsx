import { useEffect, useRef, useState } from "react";
import { DISCARD_PROMPT } from "@/lib/markdown/document-utils";
import { ESCAPE_DEPTH, useNavEscape } from "@/hooks/use-nav-history";
import { MermaidBlock } from "@/services/diagrams";
import { MarkdownEditor } from "../../editor/MarkdownEditorLazy";
import { ViewerFrame } from "./shared";
import type { Props } from "./shared";

/** A standalone .mmd/.mermaid document. Its source remains portable: optional
 * `flow:` frontmatter is understood by mermaid-animator here and ignored by
 * ordinary Mermaid renderers elsewhere. */
export function MermaidFileViewer({
  file,
  prevFile,
  nextFile,
  onNavFile,
  onContentChange,
  onOpenPalette,
  startInEditFileId,
  onStartInEditConsumed,
}: Props) {
  const [editing, setEditing] = useState(false);
  const originalContentRef = useRef(file.content);

  useEffect(() => {
    originalContentRef.current = file.content;
    setEditing(false);
    // Content echoes from the parent must not replace the snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  useEffect(() => {
    if (startInEditFileId !== file.id || editing) return;
    setEditing(true);
    onStartInEditConsumed?.();
  }, [editing, file.id, onStartInEditConsumed, startInEditFileId]);

  // Leaving discards — nothing is written until Done — so a draft that differs
  // from the file asks first. The editor owns the draft text, so the snapshot
  // taken on entry is what this can compare against.
  useNavEscape(
    editing,
    () => {
      if (file.content !== originalContentRef.current && !window.confirm(DISCARD_PROMPT)) return;
      setEditing(false);
    },
    ESCAPE_DEPTH.mode,
  );

  return (
    <ViewerFrame
      file={file}
      prevFile={prevFile}
      nextFile={nextFile}
      onNavFile={onNavFile}
      onOpenPalette={onOpenPalette}
      // The header's pencil starts the editor, the same as every other
      // viewer's; hidden while the editor is open.
      editing={editing}
    >
      {editing ? (
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
          <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            Add a YAML <code>flow:</code> block before the Mermaid source to choreograph routes,
            waits, parallel packets, and node states. Done saves, Cancel discards.
          </div>
          <MarkdownEditor
            initialContent={file.content}
            fileId={file.id}
            // The editor reports the document the text was typed into, so a
            // commit that lands after a file switch still goes to the right
            // file. `undefined` content means the draft never changed.
            onSave={() => {
              /* This animation editor commits only on Done. */
            }}
            onDone={(_cursorIndex, content) => {
              if (content !== undefined) onContentChange?.(file.id, content);
              setEditing(false);
            }}
            // Nothing was written, so cancelling only leaves.
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <div className="mx-auto max-w-6xl px-4 py-4 md:px-8">
          <MermaidBlock code={file.content} name={file.name} />
        </div>
      )}
    </ViewerFrame>
  );
}
