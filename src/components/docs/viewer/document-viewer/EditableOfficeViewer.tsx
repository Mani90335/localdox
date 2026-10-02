import { lazy, Suspense, useEffect, useState } from "react";
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
  // Entering the editor is the header's pencil (`ViewerFrame`), which sets
  // `startInEditFileId` like the sidebar's Edit; this viewer used to add its own
  // "Edit" button beside it.
  const kind = file.kind ?? getDocumentKind(file.name, file.mimeType);
  return kind === "docx" ? <DocxViewer {...props} /> : <SpreadsheetViewer {...props} />;
}
