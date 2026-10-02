import { createContext, useContext } from "react";
import { getDocumentKind, isEditableKind } from "@/lib/markdown/document-utils";
import type { MdFile } from "@/lib/markdown/markdown-utils";

/**
 * Open a document in its editor — the same action as the sidebar row's "Edit".
 *
 * A context rather than a prop threaded through every viewer: the header's
 * pencil lives in `ViewerFrame`, a dozen components below the app shell, and
 * each viewer already listens for the request this starts
 * (`startInEditFileId`). Absent (null) wherever documents are only previewed,
 * so no pencil appears there.
 */
export const EditFileContext = createContext<((fileId: string) => void) | null>(null);

/**
 * How to start editing `file`, or null when there is no editor behind it (a
 * PDF, an image) or nothing to hand the request to (a preview). Returned as a
 * value rather than rendered, so a header with nothing else in it can tell it
 * is empty and not reserve its height.
 */
export function useEditAction(file: MdFile | undefined): (() => void) | null {
  const editFile = useContext(EditFileContext);
  if (!file || !editFile) return null;
  const kind = file.kind ?? getDocumentKind(file.name, file.mimeType);
  return isEditableKind(kind) ? () => editFile(file.id) : null;
}
