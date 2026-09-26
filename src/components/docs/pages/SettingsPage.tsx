import { useState, useEffect, useRef } from "react";
import {
  Trash2,
  Star,
  Folder,
  Database,
  ArrowRight,
  Palette,
  Check,
  ScrollText,
  Files,
  Sparkles,
  Sigma,
  Pencil,
  X,
} from "lucide-react";
import {
  CUSTOM_FONT_ACCEPT,
  CUSTOM_FONT_FAMILY,
  deleteCustomFont,
  getCustomFont,
  isSupportedFontFile,
  putCustomFont,
  registerCustomFont,
  unregisterCustomFont,
} from "@/lib/fonts/custom-font";
import { isValidGoogleFamily, loadGoogleFont, unloadGoogleFont } from "@/lib/fonts/google-font";
import { AiSettings } from "@/services/ai";
import { Section, Group, Row, Empty, IconButton } from "./settings/primitives";
import { Switch } from "@/components/ui/switch";
import type { Highlight } from "@/lib/markdown/dom-highlighter";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import type { ThemePref, ReadingMode, ReadingFont } from "@/lib/workspace/persistence";
import type { MathRendererType } from "@/services/math";
import { BIN_RETENTION_MS } from "@/lib/workspace/persistence";
import { savedTypeLabel, type SavedEntry, type SavedItem } from "@/lib/workspace/saved-items";
import { STORAGE_QUOTA_FRACTION, formatBytes } from "@/lib/workspace/storage-limits";

export interface SettingsPageProps {
  workspaces: { id: string; name: string }[];
  currentWorkspaceId: string | null;
  onRenameWorkspace: (id: string, name: string) => void;
  onDeleteWorkspace: (id: string) => void;
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
  workspaces,
  currentWorkspaceId,
  onRenameWorkspace,
  onDeleteWorkspace,
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
                workspaces={workspaces}
                currentWorkspaceId={currentWorkspaceId}
                onRename={onRenameWorkspace}
                onDelete={onDeleteWorkspace}
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

// Swatch previews approximate each theme so the picker reads at a glance; the
// applied theme itself is driven by the CSS token sets in styles.css. Two
// entries only: one palette per ambient light level, both WCAG-checked.
const READER_THEME_META: {
  id: ThemePref;
  label: string;
  bg: string;
  fg: string;
  muted: string;
}[] = [
  { id: "light", label: "Light", bg: "#ffffff", fg: "#1c1c28", muted: "#6b7280" },
  { id: "dark", label: "Dark", bg: "#0f1420", fg: "#eceef2", muted: "#9aa3b2" },
];

const READING_MODE_META: { id: ReadingMode; label: string; hint: string; icon: typeof Files }[] = [
  { id: "paginated", label: "Paged sections", hint: "Prev / next per section", icon: Files },
  { id: "single", label: "Single page", hint: "Everything on one scroll", icon: ScrollText },
];

/**
 * The engine choice, written for a reader rather than for someone who already
 * knows what KaTeX is. "Automatic" leads because it is right for nearly
 * everyone — the others exist for a document full of exotic LaTeX, or for a
 * screen reader that navigates MathML better than KaTeX's HTML.
 */
const MATH_RENDERER_META: { id: MathRendererType; label: string; hint: string }[] = [
  {
    id: "auto",
    label: "Automatic",
    hint: "Fast typesetting, with a heavier engine loaded only for equations the fast one cannot draw. Recommended.",
  },
  {
    id: "katex",
    label: "Fast only",
    hint: "KaTeX for everything it supports. Still falls back rather than showing a broken equation.",
  },
  {
    id: "mathjax",
    label: "Maximum coverage",
    hint: "MathJax for every equation. Slower and ~1 MB to download, but handles the widest range of LaTeX.",
  },
  {
    id: "temml",
    label: "MathML (accessibility)",
    hint: "Renders to MathML, which some screen readers navigate better. Appearance depends on your browser.",
  },
];

function AppearanceSettings({
  theme,
  onSetTheme,
  readingMode,
  onSetReadingMode,
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
}: {
  theme: ThemePref;
  onSetTheme: (theme: ThemePref) => void;
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
  readingMode: ReadingMode;
  onSetReadingMode: (mode: ReadingMode) => void;
  readingFont: ReadingFont;
  onSetReadingFont: (font: ReadingFont) => void;
  googleFont: string | null;
  onSetGoogleFont: (family: string | null) => void;
  mathRenderer: MathRendererType;
  onSetMathRenderer: (renderer: MathRendererType) => void;
  mathNumbering: boolean;
  onSetMathNumbering: (on: boolean) => void;
  mathExplorer: boolean;
  onSetMathExplorer: (on: boolean) => void;
}) {
  return (
    <div className="space-y-10">
      <Section title="Theme">
        {/* The swatch is the whole control — colour carries the meaning, so the
            per-theme description text is gone. */}
        <div className="grid grid-cols-2 gap-3">
          {READER_THEME_META.map((t) => {
            const active = theme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => onSetTheme(t.id)}
                aria-pressed={active}
                title={t.label}
                className="group flex flex-col items-center gap-2 outline-none"
              >
                <span
                  className={`flex aspect-4/3 w-full items-center justify-center rounded-lg border transition-shadow ${
                    active
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-border group-hover:border-foreground/25"
                  }`}
                  style={{ backgroundColor: t.bg, color: t.fg }}
                >
                  <span
                    className="text-base font-medium"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    Aa
                  </span>
                </span>
                <span
                  className={`text-xs ${active ? "font-medium text-foreground" : "text-muted-foreground"}`}
                >
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <ReadingFontSettings
        readingFont={readingFont}
        onSetReadingFont={onSetReadingFont}
        googleFont={googleFont}
        onSetGoogleFont={onSetGoogleFont}
      />

      <Section title="Layout">
        <Group>
          {READING_MODE_META.map((m) => {
            const active = readingMode === m.id;
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                onClick={() => onSetReadingMode(m.id)}
                aria-pressed={active}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{m.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{m.hint}</span>
                </span>
                {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </Group>
      </Section>

      {/* Math sits with the other reading choices: which engine typesets an
          equation is a reading decision, and for most readers the default is
          the only correct answer — so the engine list leads with it and
          explains what the others are for. */}
      <Section title="Math">
        <Group>
          {MATH_RENDERER_META.map((option) => {
            const active = mathRenderer === option.id;
            return (
              <button
                key={option.id}
                onClick={() => onSetMathRenderer(option.id)}
                aria-pressed={active}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40"
              >
                <Sigma className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">{option.hint}</span>
                </span>
                {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </Group>
        <Group className="mt-3">
          <Row
            label="Number equations"
            hint="Numbers display equations and resolves \\ref, \\eqref and {{eq:label}} against them."
            control={
              <Switch
                checked={mathNumbering}
                onCheckedChange={onSetMathNumbering}
                aria-label="Number equations"
              />
            }
          />
          <Row
            label="Explore equations by keyboard"
            hint="MathJax's accessibility explorer: step through an expression's parts, each one spoken. Downloads a speech engine on first use."
            control={
              <Switch
                checked={mathExplorer}
                onCheckedChange={onSetMathExplorer}
                aria-label="Explore equations by keyboard"
              />
            }
          />
        </Group>
      </Section>

      {/* Colour is a reading aid, so it sits with the other reading choices
          rather than in a diagrams-only corner the reader would never open. */}
      <Section title="Diagrams">
        <Group>
          <Row
            label="Colour by meaning"
            hint="Green for success, red for failure, amber for decisions and retries. Applies to Raw and Stepped."
            control={
              <Switch
                checked={diagramColors}
                onCheckedChange={onSetDiagramColors}
                aria-label="Colour diagrams by meaning"
              />
            }
          />
          <Row
            label="Camera motion in Stepped"
            hint="Zooms in on the part being drawn, glides between parts, then pulls back to the whole diagram. Off keeps the whole diagram in view. Your system's reduced-motion setting also turns it off."
            control={
              <Switch
                checked={diagramCamera}
                onCheckedChange={onSetDiagramCamera}
                aria-label="Camera motion in Stepped diagrams"
              />
            }
          />
          <Row
            label="Follow numbered arrows"
            hint="Number arrows in your diagram to set the order Stepped draws them: A -->|1| B, then B -->|2. Pay| C. Numbered arrows play first, in order; the rest follow automatically. Raw shows the same numbers as labels."
            control={
              <Switch
                checked={diagramFollowNumbers}
                onCheckedChange={onSetDiagramFollowNumbers}
                aria-label="Follow numbered arrows in Stepped diagrams"
              />
            }
          />
          <Row
            label="Show step numbers"
            hint="Puts each arrow's step number on it as it is drawn, so you can see the order at a glance."
            control={
              <Switch
                checked={diagramNumbers}
                onCheckedChange={onSetDiagramNumbers}
                aria-label="Show step numbers on arrows in Stepped diagrams"
              />
            }
          />
        </Group>
      </Section>

      <Section title="AI">
        <Group>
          <Row
            label="AI features"
            hint="Off removes Ask AI everywhere — the panel, the selection menu, and this section's settings."
            control={
              <Switch
                checked={aiEnabled}
                onCheckedChange={onSetAiEnabled}
                aria-label="Enable AI features"
              />
            }
          />
        </Group>
      </Section>
    </div>
  );
}

function WorkspaceSettings({
  workspaces,
  currentWorkspaceId,
  onRename,
  onDelete,
  onOpenWorkspace,
  onImport,
  onExport,
  onShare,
}: {
  workspaces: { id: string; name: string }[];
  currentWorkspaceId: string | null;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onOpenWorkspace: (id: string) => void;
  onImport: (file: File) => void;
  onExport: () => void;
  onShare: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-10">
      <Section title="Workspaces">
        <Group>
          {workspaces.map((ws) => (
            <WorkspaceItemRow
              key={ws.id}
              workspace={ws}
              isCurrent={ws.id === currentWorkspaceId}
              onRename={onRename}
              onDelete={onDelete}
              onOpen={onOpenWorkspace}
              canDelete={workspaces.length > 1}
            />
          ))}
        </Group>
      </Section>

      {/* Moved out of the workspace menus: occasional actions on the whole
          workspace, grouped where the workspaces themselves are managed. */}
      <Section title="Transfer">
        <Group>
          <Row
            label="Import workspace"
            hint="Add a workspace from an exported .json file"
            control={
              <button
                onClick={() => fileRef.current?.click()}
                className="coarse:min-h-11 rounded-md px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
              >
                Choose file
              </button>
            }
          />
          <Row
            label="Export workspace"
            hint="Download the current workspace as .json"
            control={
              <button
                onClick={onExport}
                className="coarse:min-h-11 rounded-md px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
              >
                Export
              </button>
            }
          />
          <Row
            label="Share workspace"
            hint="Create a link to the current workspace"
            control={
              <button
                onClick={onShare}
                className="coarse:min-h-11 rounded-md px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
              >
                Share
              </button>
            }
          />
        </Group>
      </Section>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/**
 * The reading face: one bundled typeface, plus whatever the reader uploads.
 *
 * The font file is held in IndexedDB rather than the prefs blob (binaries do
 * not belong in localStorage) and registered with the FontFace API under a
 * fixed family name that `[data-font="custom"]` points at.
 */
function ReadingFontSettings({
  readingFont,
  onSetReadingFont,
  googleFont,
  onSetGoogleFont,
}: {
  readingFont: ReadingFont;
  onSetReadingFont: (font: ReadingFont) => void;
  googleFont: string | null;
  onSetGoogleFont: (family: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [customName, setCustomName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The family being typed, kept separate from the saved one: a half-typed
  // name must not knock the reader's working font out from under them.
  const [familyDraft, setFamilyDraft] = useState(googleFont ?? "");
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const applyGoogleFamily = async () => {
    const family = familyDraft.trim();
    if (!family) return;
    setGoogleError(null);
    if (!isValidGoogleFamily(family)) {
      setGoogleError("That doesn't look like a font family name.");
      return;
    }
    setGoogleBusy(true);
    try {
      // Prove the family exists before saving it. Google answers an unknown
      // name with a 400, and a saved-but-broken family would leave the reader
      // silently on the fallback stack with no clue why.
      await loadGoogleFont(family);
      onSetGoogleFont(family);
      onSetReadingFont("google");
    } catch (error) {
      setGoogleError(
        error instanceof Error && error.message === "Could not reach Google Fonts"
          ? "Could not reach Google Fonts."
          : `No family called "${family}" on Google Fonts.`,
      );
    } finally {
      setGoogleBusy(false);
    }
  };

  const removeGoogleFamily = () => {
    unloadGoogleFont();
    onSetGoogleFont(null);
    setFamilyDraft("");
    setGoogleError(null);
    if (readingFont === "google") onSetReadingFont("hyperlegible");
  };

  useEffect(() => {
    let cancelled = false;
    void getCustomFont().then((record) => {
      if (!cancelled) setCustomName(record?.name ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFile = async (file: File) => {
    setError(null);
    if (!isSupportedFontFile(file)) {
      setError("Use a .ttf, .otf, .woff or .woff2 file.");
      return;
    }
    setBusy(true);
    try {
      // Register before storing: an unreadable file should fail here and leave
      // whatever was already working in place.
      await registerCustomFont(file);
      await putCustomFont({ name: file.name, blob: file });
      setCustomName(file.name);
      onSetReadingFont("custom");
    } catch {
      setError("That file could not be read as a font.");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    await deleteCustomFont();
    unregisterCustomFont();
    setCustomName(null);
    if (readingFont === "custom") onSetReadingFont("hyperlegible");
  };

  return (
    <Section title="Reading font">
      <Group>
        <button
          onClick={() => onSetReadingFont("hyperlegible")}
          aria-pressed={readingFont === "hyperlegible"}
          className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-accent/40"
        >
          <span className="min-w-0">
            <span
              className="block truncate text-base text-foreground"
              style={{ fontFamily: '"Atkinson Hyperlegible", ui-sans-serif, sans-serif' }}
            >
              Atkinson Hyperlegible
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              Drawn for maximum letterform distinction
            </span>
          </span>
          {readingFont === "hyperlegible" && <Check className="h-4 w-4 shrink-0 text-primary" />}
        </button>

        {customName ? (
          <div className="flex items-center gap-2 pr-2 transition-colors hover:bg-accent/40">
            <button
              onClick={() => onSetReadingFont("custom")}
              aria-pressed={readingFont === "custom"}
              className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3 text-left"
            >
              <span className="min-w-0">
                <span
                  className="block truncate text-base text-foreground"
                  style={{ fontFamily: `"${CUSTOM_FONT_FAMILY}", ui-sans-serif, sans-serif` }}
                >
                  {customName}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  Your font
                </span>
              </span>
              {readingFont === "custom" && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </button>
            <IconButton onClick={() => void handleRemove()} label="Remove custom font" danger>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
        ) : (
          <Row
            label="Your own font"
            hint="Upload a .ttf, .otf, .woff or .woff2"
            control={
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="coarse:min-h-11 rounded-md px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
              >
                {busy ? "Loading…" : "Upload"}
              </button>
            }
          />
        )}
      </Group>

      {error && <p className="px-1 text-xs text-destructive">{error}</p>}

      {/* A family hosted by Google, named rather than uploaded. Kept below the
          upload because it is the option with a cost attached: the face is
          fetched from Google's servers at read time, which is the one place
          this reader stops being entirely local. */}
      <Group className="mt-2.5">
        {googleFont ? (
          <div className="flex items-center gap-2 pr-2 transition-colors hover:bg-accent/40">
            <button
              onClick={() => onSetReadingFont("google")}
              aria-pressed={readingFont === "google"}
              className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3 text-left"
            >
              <span className="min-w-0">
                <span
                  className="block truncate text-base text-foreground"
                  style={{ fontFamily: `"${googleFont}", ui-sans-serif, sans-serif` }}
                >
                  {googleFont}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  From Google Fonts
                </span>
              </span>
              {readingFont === "google" && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </button>
            <IconButton onClick={removeGoogleFamily} label="Remove Google font" danger>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
        ) : (
          <div className="px-4 py-3">
            <div className="text-sm text-foreground">A font from Google Fonts</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Type a family name, e.g. Lora or Source Serif 4. Fetched from Google when you read.
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <input
                value={familyDraft}
                onChange={(e) => setFamilyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void applyGoogleFamily();
                }}
                placeholder="Font family"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 coarse:min-h-11"
              />
              <button
                onClick={() => void applyGoogleFamily()}
                disabled={googleBusy || !familyDraft.trim()}
                className="coarse:min-h-11 shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
              >
                {googleBusy ? "Loading…" : "Use"}
              </button>
            </div>
          </div>
        )}
      </Group>

      {googleError && <p className="px-1 text-xs text-destructive">{googleError}</p>}

      <input
        ref={fileRef}
        type="file"
        accept={CUSTOM_FONT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />
    </Section>
  );
}

function WorkspaceItemRow({
  workspace,
  isCurrent,
  onRename,
  onDelete,
  onOpen,
  canDelete,
}: {
  workspace: { id: string; name: string };
  isCurrent: boolean;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
  canDelete: boolean;
}) {
  // Rename is progressive disclosure: the input only exists once you ask for
  // it, so the default state is a clean list of names.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(workspace.name);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== workspace.name) onRename(workspace.id, next);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(workspace.name);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 coarse:min-h-11"
          placeholder="Workspace name"
        />
        <button
          onClick={commit}
          disabled={!draft.trim()}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Save
        </button>
        <IconButton onClick={cancel} label="Cancel rename">
          <X className="h-4 w-4" />
        </IconButton>
      </div>
    );
  }

  return (
    <Row
      label={
        <span className="flex items-center gap-2">
          {workspace.name}
          {isCurrent && <span className="text-xs text-muted-foreground">Current</span>}
        </span>
      }
      control={
        <>
          {!isCurrent && (
            <button
              onClick={() => onOpen(workspace.id)}
              className="coarse:min-h-11 coarse:px-3 rounded-md px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              Open
            </button>
          )}
          <IconButton onClick={() => setEditing(true)} label={`Rename ${workspace.name}`}>
            <Pencil className="h-4 w-4" />
          </IconButton>
          <IconButton
            onClick={() => {
              if (window.confirm(`Delete workspace "${workspace.name}"?`)) onDelete(workspace.id);
            }}
            label={`Delete ${workspace.name}`}
            danger
            disabled={isCurrent || !canDelete}
            title={
              isCurrent
                ? "Cannot delete the active workspace"
                : !canDelete
                  ? "Cannot delete your only workspace"
                  : "Delete workspace"
            }
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </>
      }
    />
  );
}

/** Shared "Clear all" affordance for the list sections. */
function ClearAll({ onClick, confirm }: { onClick: () => void; confirm: string }) {
  return (
    <button
      onClick={() => {
        if (window.confirm(confirm)) onClick();
      }}
      className="coarse:inline-flex coarse:min-h-11 coarse:items-center shrink-0 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive"
    >
      Clear all
    </button>
  );
}

/** Fraction of the cap at which the Bin is worth pointing at. */
const STORAGE_PRESSURE = 0.8;

function StorageSettings({
  onClearStorage,
  binCount,
  onEmptyBin,
}: {
  onClearStorage: () => void;
  /** How many documents the Bin is holding, for the pressure prompt. */
  binCount: number;
  onEmptyBin: () => void;
}) {
  const [usage, setUsage] = useState<number | null>(null);
  const [quota, setQuota] = useState<number | null>(null);

  useEffect(() => {
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then((estimate) => {
        setUsage(estimate.usage || 0);
        setQuota(estimate.quota || 0);
      });
    }
  }, []);

  const cap = quota != null ? Math.floor(quota * STORAGE_QUOTA_FRACTION) : null;
  const pct = usage != null && cap ? Math.min(100, (usage / cap) * 100) : null;
  // Warned before writes start failing, not after: at this point there is still
  // room to act, and the Bin is the one place holding files nobody asked to
  // keep.
  const underPressure = pct !== null && pct >= STORAGE_PRESSURE * 100 && binCount > 0;

  return (
    <div className="space-y-10">
      <Section title="Storage">
        <Group>
          <div className="px-4 py-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-foreground">On this device</span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {usage !== null && cap !== null
                  ? `${formatBytes(usage)} of ${formatBytes(cap)}`
                  : "Calculating…"}
              </span>
            </div>
            {pct !== null && (
              <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${
                    underPressure ? "bg-amber-500" : "bg-primary"
                  }`}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
            )}
          </div>
          {underPressure && (
            <Row
              label="Storage is nearly full"
              hint={`The Bin is holding ${binCount} file${binCount === 1 ? "" : "s"}. Emptying it frees that space now.`}
              control={
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        `Permanently delete ${binCount} file${binCount === 1 ? "" : "s"} in the Bin?`,
                      )
                    ) {
                      onEmptyBin();
                    }
                  }}
                  className="coarse:min-h-11 coarse:px-3 rounded-md px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  Empty Bin
                </button>
              }
            />
          )}
        </Group>
      </Section>

      <Section
        title="Danger zone"
        description="Permanently deletes every workspace, file, highlight, saved item and preference stored in this browser. This cannot be undone."
      >
        <Group>
          <Row
            label="Clear all data"
            control={
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      "Are you absolutely sure you want to clear ALL data on this device?",
                    )
                  ) {
                    onClearStorage();
                  }
                }}
                className="coarse:min-h-11 coarse:px-4 rounded-md px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
              >
                Clear
              </button>
            }
          />
        </Group>
      </Section>
    </div>
  );
}

function SavedSettings({
  saved,
  onOpen,
  onRemove,
  onClearAll,
}: {
  saved: SavedEntry[];
  onOpen: (item: SavedItem) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
}) {
  return (
    <Section
      title="Saved"
      action={
        saved.length > 0 && <ClearAll onClick={onClearAll} confirm="Clear all saved items?" />
      }
    >
      <Group>
        {saved.length === 0 ? (
          <Empty>Nothing saved yet.</Empty>
        ) : (
          saved.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 pr-2 transition-colors hover:bg-accent/40"
            >
              <button
                onClick={() => onOpen(item)}
                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                title={item.text || item.title}
              >
                <Star className="h-4 w-4 shrink-0 fill-gold text-gold" />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground">{item.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {savedTypeLabel(item)} · {item.fileName}
                    {item.orphaned ? " · no longer in the document" : ""}
                  </span>
                </span>
              </button>
              <IconButton onClick={() => onRemove(item.id)} label="Remove saved item" danger>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </div>
          ))
        )}
      </Group>
    </Section>
  );
}

function HighlightSettings({
  highlights,
  files,
  onRemove,
  onClearAll,
  onNavigate,
}: {
  highlights: Highlight[];
  files: MdFile[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onNavigate: (fileId: string, subtopicId?: string) => void;
}) {
  return (
    <Section
      title="Highlights"
      action={
        highlights.length > 0 && <ClearAll onClick={onClearAll} confirm="Clear all highlights?" />
      }
    >
      <Group>
        {highlights.length === 0 ? (
          <Empty>No highlights yet.</Empty>
        ) : (
          highlights.map((h) => {
            const file = files.find((f) => f.id === h.fileId);
            return (
              <div
                key={h.id}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
              >
                {/* The colour dot is the only chrome the highlight needs. */}
                <span
                  className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: h.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{h.text}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {file?.name.replace(/\.(md|markdown|mdx|mmd|mermaid|txt)$/i, "") ||
                      "Unknown file"}
                    {h.label ? ` · ${h.label}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    onClick={() => onNavigate(h.fileId, h.subtopicId)}
                    label="Go to highlight"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </IconButton>
                  <IconButton onClick={() => onRemove(h.id)} label="Remove highlight" danger>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>
            );
          })
        )}
      </Group>
    </Section>
  );
}

/**
 * The Bin: everything the reader has removed, and how long it has left.
 *
 * This replaced a separate Archive panel and an irreversible Delete. A binned
 * document is recoverable for thirty days and says so per row, so "remove" no
 * longer means two different things depending on which menu item was used.
 */
function BinSettings({
  files,
  onRestore,
  onDeleteForever,
  onEmptyBin,
}: {
  files: MdFile[];
  onRestore: (id: string) => void;
  onDeleteForever: (id: string) => void;
  onEmptyBin: () => void;
}) {
  const binned = files
    .filter((f) => typeof f.deletedAt === "number")
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));

  const daysLeft = (deletedAt: number) =>
    Math.max(0, Math.ceil((deletedAt + BIN_RETENTION_MS - Date.now()) / (24 * 60 * 60 * 1000)));

  return (
    <Section
      title="Bin"
      description="Removed files stay here for 30 days, then delete themselves. Restore one at any time before that."
      action={
        binned.length > 0 && (
          <ClearAll
            onClick={onEmptyBin}
            confirm={`Permanently delete ${binned.length} file${binned.length === 1 ? "" : "s"} in the Bin?`}
          />
        )
      }
    >
      <Group>
        {binned.length === 0 ? (
          <Empty>The Bin is empty.</Empty>
        ) : (
          binned.map((file) => {
            const left = daysLeft(file.deletedAt as number);
            return (
              <Row
                key={file.id}
                label={file.name}
                hint={
                  left === 0 ? "Deletes on next open" : `${left} day${left === 1 ? "" : "s"} left`
                }
                control={
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onRestore(file.id)}
                      className="coarse:min-h-11 coarse:px-3 rounded-md px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                    >
                      Restore
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Permanently delete "${file.name}"?`)) {
                          onDeleteForever(file.id);
                        }
                      }}
                      className="coarse:min-h-11 coarse:px-3 rounded-md px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                  </div>
                }
              />
            );
          })
        )}
      </Group>
    </Section>
  );
}
