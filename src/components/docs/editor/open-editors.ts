/**
 * Documents open in a Markdown source editor right now, in any pane.
 *
 * The editor owns its draft once open and only re-reads the document when it
 * switches to another one. A change made to the document from elsewhere while
 * it is open (inserting rough work) would be overwritten by the editor's next
 * autosave of its older draft, so those changes check here first and wait for
 * the reader to leave the editor.
 */
const open = new Map<string, number>();

/** Record an editor open on `fileId`; the returned function closes it. */
export function markEditorOpen(fileId: string): () => void {
  open.set(fileId, (open.get(fileId) ?? 0) + 1);
  return () => {
    const left = (open.get(fileId) ?? 1) - 1;
    if (left > 0) open.set(fileId, left);
    else open.delete(fileId);
  };
}

export function isEditorOpen(fileId: string): boolean {
  return open.has(fileId);
}
