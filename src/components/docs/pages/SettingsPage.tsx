import { type WorkspaceKind } from "@/lib/workspace/kinds";
import { useState, useEffect, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import {
  BookOpen,
  Database,
  FileCog,
  Folder,
  GitBranch,
  Palette,
  Sigma,
  Sparkles,
  X,
} from "lucide-react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { AiSettings } from "@/services/ai";
import { AppearanceSettings } from "./settings/AppearanceTab";
import { ReadingSettings } from "./settings/ReadingTab";
import { DiagramSettings } from "./settings/DiagramsTab";
import { MathSettings } from "./settings/MathTab";
import { WorkspaceSettings } from "./settings/WorkspaceTab";
import { BinSettings } from "./settings/SavedTab";
import { StorageSettings } from "./settings/StorageTab";
import { ExamRulesSettings } from "./settings/ExamRulesTab";
import "./settings/settings.css";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import type { ThemePref, ReadingMode, ReadingFont } from "@/lib/workspace/persistence";
import type { MathRendererType } from "@/services/math";

export interface SettingsPageProps {
  showEmbedMedia: boolean;
  onSetShowEmbedMedia: (show: boolean) => void;
  workspaces: { id: string; name: string; kind?: WorkspaceKind }[];
  currentWorkspaceId: string | null;
  onRenameWorkspace: (id: string, name: string) => void;
  onDeleteWorkspace: (id: string) => void;
  onNewWorkspace: (name: string, kind?: WorkspaceKind) => void;
  onClearStorage: () => void;
  files: MdFile[];
  /** The open workspace's notes and rough work, for the storage total. */
  writing?: {
    notes: readonly { content: string }[];
    scratchpads: readonly { title: string; content: string }[];
  };
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
  /** Save a ruleset edited in Exam rules. */
  onSaveFile: (fileId: string, content: string) => void;
  /** A new ruleset with the default rules; returns its id and file name. */
  onCreateRules: (name: string) => { id: string; name: string };
  /** Move files to the Bin (a ruleset, from Exam rules). */
  onBinFile: (fileIds: string[]) => void;
  /** Section to open on. Defaults to appearance. */
  initialTab?: TabId;
  /** With the exams tab: the ruleset to open for editing. */
  initialRulesId?: string;
  /** Dismiss the dialog. */
  onClose: () => void;
}

type TabId =
  "appearance" | "reading" | "diagrams" | "math" | "ai" | "workspace" | "exams" | "storage";

const SECTIONS = [
  {
    id: "appearance",
    label: "Appearance",
    description: "A space that feels like yours.",
    icon: Palette,
    group: "Preferences",
  },
  {
    id: "reading",
    label: "Reading",
    description: "Find your rhythm, one page at a time.",
    icon: BookOpen,
    group: "Preferences",
  },
  {
    id: "diagrams",
    label: "Diagrams",
    description: "Bring a little clarity to complex ideas.",
    icon: GitBranch,
    group: "Preferences",
  },
  {
    id: "math",
    label: "Equations",
    description: "Make every expression easy to read.",
    icon: Sigma,
    group: "Preferences",
  },
  {
    id: "ai",
    label: "Ask AI",
    description: "Connect your preferred providers and choose a model.",
    icon: Sparkles,
    group: "Preferences",
  },
  {
    id: "workspace",
    label: "Workspace",
    description: "Organize your spaces and take your work with you.",
    icon: Folder,
    group: "Your library",
  },
  {
    id: "exams",
    label: "Exam rules",
    description: "Set how your exams run, once, for every paper that uses them.",
    icon: FileCog,
    group: "Your library",
  },
  {
    id: "storage",
    label: "Storage",
    description: "Manage this device's data and offline access.",
    icon: Database,
    group: "Your library",
  },
] as const;

export function SettingsPage(props: SettingsPageProps) {
  const { initialTab, onClose, aiEnabled } = props;
  const [activeTab, setActiveTab] = useState<TabId>(initialTab ?? "appearance");
  const isNarrow = useMediaQuery("(max-width: 639px)");
  const returnFocus = useRef<HTMLElement | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const selectedTab = activeTab === "ai" && !aiEnabled ? "appearance" : activeTab;
  const sections = SECTIONS.filter((section) => section.id !== "ai" || aiEnabled);
  const current = SECTIONS.find((section) => section.id === selectedTab)!;

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="settings-overlay fixed inset-0 z-(--z-overlay) bg-foreground/25 backdrop-blur-sm" />
        <Dialog.Content
          className="settings-dialog fixed inset-0 z-(--z-overlay) flex flex-col overflow-hidden bg-background text-foreground shadow-2xl outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-[min(720px,90dvh)] sm:w-[min(960px,calc(100vw-48px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[22px] sm:border sm:border-border"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            sidebarRef.current?.querySelector<HTMLElement>('[data-state="active"]')?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus.current?.isConnected && returnFocus.current !== document.body) {
              returnFocus.current.focus({ preventScroll: true });
              return;
            }
            document.querySelector<HTMLElement>('button[aria-label="Settings"]')?.focus();
          }}
          onEscapeKeyDown={(event) => {
            // A workspace draft handles Escape locally before the modal closes.
            if (
              event.target instanceof HTMLElement &&
              event.target.matches("[data-settings-draft]")
            ) {
              event.preventDefault();
            }
          }}
        >
          <Dialog.Title className="sr-only">Settings</Dialog.Title>
          <Dialog.Description className="sr-only">
            Customize your reading experience and manage your library. Changes apply immediately.
          </Dialog.Description>
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-hairline px-5 sm:hidden">
            <span aria-hidden="true" className="text-lg font-semibold tracking-tight">
              Settings
            </span>
            <CloseButton />
          </div>
          <Tabs.Root
            value={selectedTab}
            onValueChange={(value) => setActiveTab(value as TabId)}
            orientation={isNarrow ? "horizontal" : "vertical"}
            className="flex min-h-0 flex-1 flex-col sm:flex-row"
          >
            <aside className="flex shrink-0 flex-col border-b border-hairline bg-surface-sunken sm:w-[216px] sm:border-b-0 sm:border-r">
              <div className="hidden px-6 pb-7 pt-8 sm:block">
                <div aria-hidden="true" className="text-xl font-semibold tracking-tight">
                  Settings
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">Make yourself at home.</p>
              </div>
              <Tabs.List
                ref={sidebarRef}
                aria-label="Settings sections"
                className="flex gap-1 overflow-x-auto px-3 py-2 scrollbar-hide sm:min-h-0 sm:flex-1 sm:flex-col sm:gap-1 sm:overflow-x-hidden sm:overflow-y-auto sm:px-3 sm:py-0"
              >
                {sections.map((section, index) => {
                  const Icon = section.icon;
                  const startsGroup = index === 0 || section.group !== sections[index - 1].group;
                  return (
                    <div key={section.id} className="shrink-0">
                      {startsGroup && (
                        <p
                          aria-hidden="true"
                          className={
                            index === 0
                              ? "mb-2 hidden px-3 text-2xs font-medium text-muted-foreground sm:block"
                              : "mb-2 mt-6 hidden px-3 text-2xs font-medium text-muted-foreground sm:block"
                          }
                        >
                          {section.group}
                        </p>
                      )}
                      <Tabs.Trigger
                        value={section.id}
                        className="flex min-h-10 w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-[state=active]:bg-card data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-xs coarse:min-h-11"
                      >
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        {section.label}
                      </Tabs.Trigger>
                    </div>
                  );
                })}
              </Tabs.List>
              <div className="hidden px-6 pb-6 pt-8 sm:block">
                <p className="text-xs font-medium text-foreground">Localdox</p>
                <p className="mt-1 text-2xs text-muted-foreground">
                  Your own little reading space.
                </p>
              </div>
            </aside>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-sunken/35">
              <header className="shrink-0 px-5 pb-6 pt-6 sm:px-9 sm:pb-7 sm:pt-8">
                <div className="mx-auto flex max-w-[580px] items-start justify-between gap-4">
                  <div>
                    <h2
                      id="settings-section-title"
                      className="text-2xl font-semibold tracking-tight"
                    >
                      {current.label}
                    </h2>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                      {current.description}
                    </p>
                  </div>
                  <div className="hidden sm:block">
                    <CloseButton />
                  </div>
                </div>
              </header>
              {sections.map((section) => (
                <Tabs.Content
                  key={section.id}
                  value={section.id}
                  className="settings-panel min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-9"
                >
                  <div className="mx-auto max-w-[580px]">
                    {section.id === "appearance" && <AppearanceSettings {...props} />}
                    {section.id === "reading" && <ReadingSettings {...props} />}
                    {section.id === "diagrams" && <DiagramSettings {...props} />}
                    {section.id === "math" && <MathSettings {...props} />}
                    {section.id === "ai" && <AiSettings />}
                    {section.id === "workspace" && (
                      <WorkspaceSettings
                        showEmbedMedia={props.showEmbedMedia}
                        onSetShowEmbedMedia={props.onSetShowEmbedMedia}
                        workspaces={props.workspaces}
                        currentWorkspaceId={props.currentWorkspaceId}
                        onRename={props.onRenameWorkspace}
                        onDelete={props.onDeleteWorkspace}
                        onNew={props.onNewWorkspace}
                        onOpenWorkspace={props.onOpenWorkspace}
                        onImport={props.onImportWorkspace}
                        onExport={props.onExportWorkspace}
                        onShare={props.onShareWorkspace}
                      />
                    )}
                    {section.id === "exams" && (
                      <ExamRulesSettings
                        files={props.files}
                        initialRulesId={props.initialRulesId}
                        onSave={props.onSaveFile}
                        onCreate={props.onCreateRules}
                        onBin={props.onBinFile}
                      />
                    )}
                    {section.id === "storage" && (
                      <div className="space-y-7">
                        <StorageSettings
                          onClearStorage={props.onClearStorage}
                          workspaceId={props.currentWorkspaceId}
                          files={props.files}
                          writing={props.writing}
                          binCount={
                            props.files.filter((file) => typeof file.deletedAt === "number").length
                          }
                          onEmptyBin={props.onEmptyBin}
                        />
                        <BinSettings
                          files={props.files}
                          onRestore={props.onRestoreFromBin}
                          onDeleteForever={props.onDeleteForever}
                          onEmptyBin={props.onEmptyBin}
                        />
                      </div>
                    )}
                  </div>
                </Tabs.Content>
              ))}
              <footer className="shrink-0 border-t border-hairline bg-background/80 px-5 py-3 sm:px-9">
                <div className="mx-auto flex max-w-[580px] items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">Changes apply immediately</p>
                  <Dialog.Close className="min-h-9 rounded-lg bg-foreground px-5 text-xs font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 coarse:min-h-11">
                    Done
                  </Dialog.Close>
                </div>
              </footer>
            </div>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CloseButton() {
  return (
    <Dialog.Close
      aria-label="Close settings"
      className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:size-11"
    >
      <X className="size-4" aria-hidden="true" />
    </Dialog.Close>
  );
}
