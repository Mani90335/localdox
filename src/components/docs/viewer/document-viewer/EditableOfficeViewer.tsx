import { lazy, Suspense, useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { getDocumentKind } from "@/lib/markdown/document-utils";
import { Loading } from "./shared";
import type { Props } from "./shared";
import { DocxViewer } from "./DocxViewer";
import { SpreadsheetViewer } from "./SpreadsheetViewer";

const OfficeEditor = lazy(() =>
  import("@/services/office-editing/OfficeEditor").then((module) => ({
    default: module.OfficeEditor,
  })),
);

export function EditableOfficeViewer(props: Props) {
  const { file, onDocumentSave, embedded, startInEditFileId, onStartInEditConsumed } = props;
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (startInEditFileId === file.id && onDocumentSave && !embedded) {
      setEditing(true);
      onStartInEditConsumed?.();
    }
  }, [startInEditFileId, file.id, onDocumentSave, embedded, onStartInEditConsumed]);
  if (editing && onDocumentSave)
    return (
      <Suspense fallback={<Loading label="Loading editor" />}>
        <OfficeEditor
          file={file}
          onSave={onDocumentSave}
          onDone={() => setEditing(false)}
          onDirtyChange={props.onEditorDirtyChange}
        />
      </Suspense>
    );
  const kind = file.kind ?? getDocumentKind(file.name, file.mimeType);
  const viewerAction =
    onDocumentSave && !embedded ? (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={kind === "docx" ? "Edit document" : "Edit spreadsheet"}
        className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground coarse:h-11"
      >
        <Pencil className="h-4 w-4" />
        Edit
      </button>
    ) : undefined;
  return kind === "docx" ? (
    <DocxViewer {...props} viewerAction={viewerAction} />
  ) : (
    <SpreadsheetViewer {...props} viewerAction={viewerAction} />
  );
}
