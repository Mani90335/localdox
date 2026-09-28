import { useState, useEffect } from "react";
import { Database, Folder, Palette, Sparkles, Star, X } from "lucide-react";
import { AiSettings } from "@/services/ai";
import { AppearanceSettings } from "./settings/AppearanceTab";
import { WorkspaceSettings } from "./settings/WorkspaceTab";
import { SavedSettings, HighlightSettings, BinSettings } from "./settings/SavedTab";
import { StorageSettings } from "./settings/StorageTab";
import type { Highlight } from "@/lib/markdown/dom-highlighter";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import type { ThemePref, ReadingMode, ReadingFont } from "@/lib/workspace/persistence";
import type { MathRendererType } from "@/services/math";
import type { SavedEntry, SavedItem } from "@/lib/workspace/saved-items";

export interface SettingsPageProps {
  showEmbedMedia: boolean;
  onSetShowEmbedMedia: (show: boolean) => void;
  workspaces: { id: string; name: string }[];
  currentWorkspaceId: string | null;
  onRenameWorkspace: (id: string, name: string) => void;
  onDeleteWorkspace: (id: string) => void;
  onNewWorkspace: (name: string) => void;
  onClearStorage: () => void;
  saved: SavedEntry[];
  onOpenSaved: (item: SavedItem) => void;
  onRemoveSaved: (id: string) => void;
  onClearSaved: () => void;
  highlights: Highlight[];
  onRemoveHighlight: (id: string) => void;
  onClearHighlights: () => void;
  onNavigate: (fileId: string, subtopicId?: string) => void;
  files: MdFile[];
  onOpenWorkspace: (id: string) => void;
  theme: ThemePref;
  onSetTheme: (theme: ThemePref) => void;
  readingMode: ReadingMode;
  onSetReadingMode: (mode: ReadingMode) => void;
  contentWidth: number;
  onSetContentWidth: (percent: number) => void;
  readingFont: ReadingFont;
  onSetReadingFont: (font: ReadingFont) => void;
  googleFont: string | null;
  onSetGoogleFont: (family: string | null) => void;
  diagramColors: boolean;
  onSetDiagramColors: (on: boolean) => void;
  diagramCamera: boolean;
  onSetDiagramCamera: (on: boolean) => void;
  diagramFollowNumbers: boolean;
  onSetDiagramFollowNumbers: (on: boolean) => void;
  diagramNumbers: boolean;
  onSetDiagramNumbers: (on: boolean) => void;
  aiEnabled: boolean;
  onSetAiEnabled: (on: boolean) => void;
  mathRenderer: MathRendererType;
  onSetMathRenderer: (renderer: MathRendererType) => void;
  mathNumbering: boolean;
  onSetMathNumbering: (on: boolean) => void;
  mathExplorer: boolean;
  onSetMathExplorer: (on: boolean) => void;
  /** Bring a binned document back into the workspace. */
  onRestoreFromBin: (id: string) => void;
  /** Delete one binned document for good. */
  onDeleteForever: (id: string) => void;
  /** Empty the Bin entirely. */
  onEmptyBin: () => void;
  /** Workspace file actions, moved here out of the workspace menus. */
  onImportWorkspace: (file: File) => void;
  onExportWorkspace: () => void;
  onShareWorkspace: () => void;
  /** Section to open on. Defaults to appearance. */
  initialTab?: TabId;
  /** Dismiss the dialog. */
  onClose: () => void;
}

type TabId = "appearance" | "ai" | "workspace" | "saved" | "storage";

const TABS = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "ai", label: "Ask AI", icon: Sparkles },
  { id: "workspace", label: "Workspace", icon: Folder },
  { id: "saved", label: "Saved", icon: Star },
  { id: "storage", label: "Storage", icon: Database },
] as const satisfies readonly { id: TabId; label: string; icon: typeof Palette }[];

/** The AI tab disappears entirely when AI is switched off, rather than being
 *  shown as a dead entry — the point of the switch is not to see it. */
function visibleTabs(aiEnabled: boolean) {
  return TABS.filter((tab) => tab.id !== "ai" || aiEnabled);
}

export function SettingsPage({
  showEmbedMedia,
  onSetShowEmbedMedia,
  workspaces,
  currentWorkspaceId,
  onRenameWorkspace,
  onDeleteWorkspace,
  onNewWorkspace,
  onClearStorage,
  saved,
  onOpenSaved,
  onRemoveSaved,
  onClearSaved,
  highlights,
  onRemoveHighlight,
  onClearHighlights,
  onNavigate,
  files,
  onOpenWorkspace,
  theme,
  onSetTheme,
  readingMode,
  onSetReadingMode,
  contentWidth,
  onSetContentWidth,
  readingFont,
  onSetReadingFont,
  googleFont,
  onSetGoogleFont,
  diagramColors,
  onSetDiagramColors,
  diagramCamera,
  onSetDiagramCamera,
  diagramFollowNumbers,
  onSetDiagramFollowNumbers,
  diagramNumbers,
  onSetDiagramNumbers,
  aiEnabled,
  onSetAiEnabled,
  mathRenderer,
  onSetMathRenderer,
  mathNumbering,
  onSetMathNumbering,
  mathExplorer,
  onSetMathExplorer,
  onRestoreFromBin,
  onDeleteForever,
  onEmptyBin,
  onImportWorkspace,
  onExportWorkspace,
  onShareWorkspace,
  initialTab,
  onClose,
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab ?? "appearance");

  // The dialog survives across opens, so seeding state at mount is not enough:
  // asking for a section on a later open has to move the tab too.
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  // Escape closes it, like every other dismissable layer in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The page underneath must not scroll while the dialog is over it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-(--z-overlay) flex items-center justify-center p-0 sm:p-6">
      {/* Click-away. The dialog itself stops propagation by being a sibling
          rather than a child, so no click inside it can reach this. */}
      <div
        className="absolute inset-0 bg-foreground/30 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={onClose}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="relative flex h-full w-full flex-col overflow-hidden border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-150 sm:h-[min(640px,90vh)] sm:max-w-4xl sm:rounded-2xl sm:border"
      >
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
          <h1 className="text-base font-semibold tracking-tight text-foreground">Settings</h1>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="-mr-1 flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground coarse:h-11 coarse:w-11"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* Left rail on desktop; a scrollable chip row on phones, where a
              vertical rail would eat half the dialog. */}
          {/* The rail marks the current section with a hairline and weight
              rather than a filled pill. Five pills stacked down the side read
              as five competing buttons; the reader only needs to know which
              one they are in. */}
          <nav
            role="tablist"
            aria-label="Settings sections"
            className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border px-2 py-2 scrollbar-hide sm:w-56 sm:flex-col sm:gap-px sm:overflow-x-visible sm:overflow-y-auto sm:border-b-0 sm:border-r sm:px-3 sm:py-4"
          >
            {visibleTabs(aiEnabled).map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 py-2 text-[13px] transition-colors coarse:min-h-11 coarse:px-3.5 sm:w-full ${
                    active
                      ? "font-medium text-foreground sm:bg-accent/40"
                      : "font-normal text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${active ? "text-foreground" : "text-muted-foreground/70"}`}
                  />
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7 sm:py-6">
            {activeTab === "appearance" && (
              <AppearanceSettings
                theme={theme}
                onSetTheme={onSetTheme}
                readingMode={readingMode}
                onSetReadingMode={onSetReadingMode}
                contentWidth={contentWidth}
                onSetContentWidth={onSetContentWidth}
                readingFont={readingFont}
                onSetReadingFont={onSetReadingFont}
                googleFont={googleFont}
                onSetGoogleFont={onSetGoogleFont}
                diagramColors={diagramColors}
                onSetDiagramColors={onSetDiagramColors}
                diagramCamera={diagramCamera}
                onSetDiagramCamera={onSetDiagramCamera}
                diagramFollowNumbers={diagramFollowNumbers}
                onSetDiagramFollowNumbers={onSetDiagramFollowNumbers}
                diagramNumbers={diagramNumbers}
                onSetDiagramNumbers={onSetDiagramNumbers}
                aiEnabled={aiEnabled}
                onSetAiEnabled={onSetAiEnabled}
                mathRenderer={mathRenderer}
                onSetMathRenderer={onSetMathRenderer}
                mathNumbering={mathNumbering}
                onSetMathNumbering={onSetMathNumbering}
                mathExplorer={mathExplorer}
                onSetMathExplorer={onSetMathExplorer}
              />
            )}
            {/* Guarded as well as hidden from the rail: the dialog can be
                opened straight onto a tab, and a stored "ai" would otherwise
                land the reader on a pane that no longer has a way back. */}
            {activeTab === "ai" && aiEnabled && <AiSettings />}
            {activeTab === "ai" && !aiEnabled && (
              <AppearanceSettings
                theme={theme}
                onSetTheme={onSetTheme}
                readingMode={readingMode}
                onSetReadingMode={onSetReadingMode}
                contentWidth={contentWidth}
                onSetContentWidth={onSetContentWidth}
                readingFont={readingFont}
                onSetReadingFont={onSetReadingFont}
                googleFont={googleFont}
                onSetGoogleFont={onSetGoogleFont}
                diagramColors={diagramColors}
                onSetDiagramColors={onSetDiagramColors}
                diagramCamera={diagramCamera}
                onSetDiagramCamera={onSetDiagramCamera}
                diagramFollowNumbers={diagramFollowNumbers}
                onSetDiagramFollowNumbers={onSetDiagramFollowNumbers}
                diagramNumbers={diagramNumbers}
                onSetDiagramNumbers={onSetDiagramNumbers}
                aiEnabled={aiEnabled}
                onSetAiEnabled={onSetAiEnabled}
                mathRenderer={mathRenderer}
                onSetMathRenderer={onSetMathRenderer}
                mathNumbering={mathNumbering}
                onSetMathNumbering={onSetMathNumbering}
                mathExplorer={mathExplorer}
                onSetMathExplorer={onSetMathExplorer}
              />
            )}
            {activeTab === "workspace" && (
              <WorkspaceSettings
                showEmbedMedia={showEmbedMedia}
                onSetShowEmbedMedia={onSetShowEmbedMedia}
                workspaces={workspaces}
                currentWorkspaceId={currentWorkspaceId}
                onRename={onRenameWorkspace}
                onDelete={onDeleteWorkspace}
                onNew={onNewWorkspace}
                onOpenWorkspace={onOpenWorkspace}
                onImport={onImportWorkspace}
                onExport={onExportWorkspace}
                onShare={onShareWorkspace}
              />
            )}
            {/* Saved gathers everything the reader kept: starred items, their
                highlights, and the files they archived out of the sidebar. */}
            {activeTab === "saved" && (
              <div className="space-y-10">
                <SavedSettings
                  saved={saved}
                  onOpen={onOpenSaved}
                  onRemove={onRemoveSaved}
                  onClearAll={onClearSaved}
                />
                <HighlightSettings
                  highlights={highlights}
                  files={files}
                  onRemove={onRemoveHighlight}
                  onClearAll={onClearHighlights}
                  onNavigate={onNavigate}
                />
                <BinSettings
                  files={files}
                  onRestore={onRestoreFromBin}
                  onDeleteForever={onDeleteForever}
                  onEmptyBin={onEmptyBin}
                />
              </div>
            )}
            {activeTab === "storage" && (
              <StorageSettings
                onClearStorage={onClearStorage}
                binCount={files.filter((f) => typeof f.deletedAt === "number").length}
                onEmptyBin={onEmptyBin}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
