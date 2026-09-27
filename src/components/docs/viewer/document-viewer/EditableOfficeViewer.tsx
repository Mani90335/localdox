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
  return (
    <>
      {onDocumentSave && !embedded && (
        <div className="flex justify-end px-4 pt-3">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit {kind === "docx" ? "document" : "spreadsheet"}
          </button>
        </div>
      )}
      {kind === "docx" ? <DocxViewer {...props} /> : <SpreadsheetViewer {...props} />}
    </>
  );
}
