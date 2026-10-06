import { EditButton } from "../EditButton";
import { useEditAction } from "../EditFileContext";
import type { DocumentUpdate } from "@/services/office-editing";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { ViewerHeader, type ViewerNav } from "../../navigation/ViewerHeader";

export interface Props {
  file: MdFile;
  onRemoveFile?: () => void;
  /** Sibling files, so the shared header's prev/next can move between files. */
  prevFile?: MdFile | null;
  nextFile?: MdFile | null;
  onNavFile?: (fileId: string) => void;
  /** Rendered inside markdown content: strip all chrome, show only the content. */
  embedded?: boolean;
  /** Fill a bounded parent (such as a split pane) instead of the viewport. */
  fillAvailableHeight?: boolean;
  /** Persist an edited document. Omitted where the viewer is read-only. */
  onContentChange?: (fileId: string, content: string) => void;
  /** Renames the file in place (boards name themselves from their title). */
  onRenameFile?: (fileId: string, name: string) => void;
  onDocumentSave?: (fileId: string, update: DocumentUpdate) => void;
  onEditorDirtyChange?: (dirty: boolean) => void;
  /** Opens the workspace command palette from the header's search field. */
  onOpenPalette?: () => void;
  /**
   * Document the sidebar asked to edit. Editing is entered from the file's
   * three-dots menu rather than a header button, so the request arrives here
   * the same way it does for markdown. Cleared through `onStartInEditConsumed`.
   */
  startInEditFileId?: string | null;
  onStartInEditConsumed?: () => void;
}
export interface GoogleProps extends Props {
  isSlides: boolean;
}

/**
 * Document name without its extension, for labels. Unlike the markdown
 * viewer's version this drops any trailing extension, since this file serves
 * every document type.
 */
export const stripExt = (name: string) => name.replace(/\.[^./\\]+$/, "");

/** File-level prev/next for the shared header — used by every non-deck viewer. */
export function useFileNav({
  prevFile,
  nextFile,
  onNavFile,
}: Pick<Props, "prevFile" | "nextFile" | "onNavFile">): ViewerNav {
  return {
    onPrev: () => prevFile && onNavFile?.(prevFile.id),
    onNext: () => nextFile && onNavFile?.(nextFile.id),
    prevDisabled: !prevFile || !onNavFile,
    nextDisabled: !nextFile || !onNavFile,
    // The pager names the destination rather than the direction — the arrow
    // already says which way it goes.
    prevLabel: prevFile ? `Previous: ${stripExt(prevFile.name)}` : "Previous file",
    nextLabel: nextFile ? stripExt(nextFile.name) : "Next file",
  };
}

/**
 * The masthead a non-text file opens with.
 *
 * Markdown documents get their title, file name and reading time from the
 * reader's own header. Everything else — a sheet, a JSON file, a deck — opened
 * straight into its content with no name anywhere on screen, on the reasoning
 * that the sidebar already marks the active file. It does, until the sidebar is
 * collapsed, or the window is narrow enough that it becomes a drawer, or the
 * reader simply came back to the tab: then the open document is anonymous.
 *
 * Costs one line, and gives every file type the same opening as a document.
 */
export function ViewerMasthead({
  file,
  kindLabel,
  meta,
  actions,
}: {
  file: MdFile;
  kindLabel: string;
  /** One short fact about the file, e.g. "9 rows · 5 columns". */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span>{kindLabel}</span>
          {meta && (
            <>
              <span aria-hidden className="font-normal text-border">
                ·
              </span>
              <span className="font-medium normal-case tracking-normal">{meta}</span>
            </>
          )}
        </p>
        <h1 className="mt-1 truncate text-lg font-semibold tracking-[-0.015em] text-foreground">
          {file.name}
        </h1>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </header>
  );
}

export function ViewerFrame({
  file,
  embedded,
  children,
  action,
  navAction,
  editing = false,
  minimal = false,
}: {
  file?: MdFile;
  embedded?: boolean;
  children: React.ReactNode;
  action?: React.ReactNode;
  /** The viewer is in its editor; the header's pencil has nothing to start. */
  editing?: boolean;
  minimal?: boolean;
  navAction?: React.ReactNode;
  icon?: React.ReactNode;
} & Pick<Props, "prevFile" | "nextFile" | "onNavFile" | "onOpenPalette">) {
  const edit = useEditAction(editing ? undefined : file);
  if (embedded) return <>{children}</>;
  return (
    <section className="min-h-[calc(100dvh-var(--app-chrome-h))] bg-background">
      {(!minimal || editing) && <ViewerHeader
        navAction={navAction}
        actions={
          // Exporting lives in the sidebar row's ⋮ ▸ Export, with every
          // format; the header keeps to acting on the document itself.
          edit ? (
            <>
              {action}
              <EditButton onEdit={edit} />
            </>
          ) : (
            action
          )
        }
      />}
      {children}
    </section>
  );
}

export function Loading({ label, dark = false }: { label: string; dark?: boolean }) {
  return (
    <div
      className={`flex min-h-[55vh] items-center justify-center text-sm ${dark ? "text-white/60" : "text-muted-foreground"}`}
    >
      <span className="mr-3 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {label}
    </div>
  );
}
export function ErrorState({ message, dark = false }: { message: string; dark?: boolean }) {
  return (
    <div
      className={`flex min-h-[55vh] items-center justify-center px-6 text-center text-sm ${dark ? "text-white/65" : "text-muted-foreground"}`}
    >
      {message}
    </div>
  );
}
