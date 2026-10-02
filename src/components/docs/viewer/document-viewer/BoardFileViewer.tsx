import { BoardCanvas } from "@/services/board";
import type { Props } from "./shared";

/**
 * A standalone board (`.board`, or an older `.excalidraw` file). The canvas is
 * the editor — there is no separate edit mode to enter, and no markdown editor
 * is offered for it: a board's source is scene JSON, and letting someone type
 * into it by hand would only corrupt the document.
 */
export function BoardFileViewer({
  file,
  onContentChange,
  onRenameFile,
  fillAvailableHeight,
}: Props) {
  return (
    <div
      className={`min-h-0 min-w-0 overflow-hidden ${
        fillAvailableHeight ? "h-full w-full" : "h-[calc(100dvh-3.5rem)] w-full lg:h-dvh"
      }`}
    >
      {/* No padding, no card, no border: a board is a surface, not a figure on
          a page. Framing it the way a diagram is framed is exactly what made it
          read as an embedded iframe rather than part of the app. */}
      <BoardCanvas
        fileId={file.id}
        fileName={file.name}
        content={file.content}
        onContentChange={
          onContentChange ? (content) => onContentChange(file.id, content) : undefined
        }
        onRename={onRenameFile ? (name) => onRenameFile(file.id, name) : undefined}
      />
    </div>
  );
}
