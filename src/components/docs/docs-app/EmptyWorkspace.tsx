import type { ReactNode, RefObject } from "react";
import { FilePlus, PenTool, Upload } from "lucide-react";

import { Header } from "./Header";
import { SUPPORTED_ACCEPT } from "@/lib/markdown/document-utils";

/**
 * The first-run screen: no documents in the workspace yet. Shares the header
 * and every app-level dialog with the reader view (drag overlay, share
 * link import, settings, cross-workspace move) so a deep link into any of
 * them resolves before the reader has ever opened a document.
 */
export function EmptyWorkspace({
  onHome,
  workspaces,
  currentWorkspaceId,
  onSwitchWorkspace,
  onOpenSettings,
  inputRef,
  onFileInputChange,
  onCreateFile,
  onCreateBoardFile,
  dragOverlay,
  shareDialog,
  settingsDialog,
  moveDialog,
  statusBanner,
}: {
  onHome: () => void;
  workspaces: { id: string; name: string }[];
  currentWorkspaceId: string | null;
  onSwitchWorkspace: (id: string) => void;
  onOpenSettings: (tab?: "workspace") => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onFileInputChange: (files: FileList | null) => void;
  onCreateFile: (folderId: string | null) => void;
  onCreateBoardFile: (folderId: string | null) => void;
  dragOverlay: ReactNode;
  shareDialog: ReactNode;
  settingsDialog: ReactNode;
  moveDialog: ReactNode;
  /** Save / conflict state that must stay visible on every screen. */
  statusBanner?: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background">
      <Header
        onMenu={null}
        hideMenu
        onOpenPalette={() => {}}
        hasFiles={false}
        onHome={onHome}
        workspaces={workspaces}
        currentWorkspaceId={currentWorkspaceId}
        onSwitchWorkspace={onSwitchWorkspace}
        onOpenSettings={onOpenSettings}
      />
      <div className="flex min-h-[calc(100dvh-4rem)] flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm text-center">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="group flex w-full flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-border bg-card/40 px-8 py-14 shadow-sm transition-all duration-200 ease-out hover:border-primary/50 hover:bg-primary/5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-transform duration-200 ease-out group-hover:scale-105">
              <Upload className="h-6 w-6" />
            </span>
            <span className="space-y-1">
              <span className="block text-lg font-semibold text-foreground">
                Drop files here, or click to upload
              </span>
              <span className="block text-sm text-muted-foreground">
                Markdown, PDFs, spreadsheets, slides, images & more
              </span>
            </span>
          </button>

          <div className="mt-6 flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
            or start something new
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>

          {/* Nothing to right-click yet, so the sidebar's New menu is out of
              reach — a blank document has to be startable from here too. The
              same applies to a board: without this the only way to reach one
              is to first create some other file just to make the sidebar
              appear. */}
          <div className="mt-5 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => onCreateFile(null)}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors duration-150 hover:border-primary/40 hover:bg-accent"
            >
              <FilePlus className="h-4 w-4 text-muted-foreground" />
              New file
            </button>
            <button
              type="button"
              onClick={() => onCreateBoardFile(null)}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors duration-150 hover:border-primary/40 hover:bg-accent"
            >
              <PenTool className="h-4 w-4 text-muted-foreground" />
              New board
            </button>
          </div>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={SUPPORTED_ACCEPT}
        className="hidden"
        onChange={(e) => {
          onFileInputChange(e.target.files);
          e.target.value = "";
        }}
      />
      {dragOverlay}
      {shareDialog}
      {settingsDialog}
      {moveDialog}
      {statusBanner}
    </div>
  );
}
