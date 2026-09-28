import { Check, Files, ScrollText, Sigma } from "lucide-react";
import { Section, Group, Row } from "./primitives";
import { ReadingFontSettings } from "./ReadingFontSettings";
import { Switch } from "@/components/ui/switch";
import type { ThemePref, ReadingMode, ReadingFont } from "@/lib/workspace/persistence";
import { CONTENT_WIDTH_MIN, CONTENT_WIDTH_MAX } from "@/lib/workspace/persistence";
import type { MathRendererType } from "@/services/math";

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

export function AppearanceSettings({
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
  contentWidth: number;
  onSetContentWidth: (percent: number) => void;
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
        <Group className="mt-3">
          <div className="px-4 py-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="content-width" className="text-sm text-foreground">
                Content width
              </label>
              <span className="text-sm tabular-nums text-muted-foreground">{contentWidth}%</span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              How much of the space beside the sidebar the reading and editing column fills. Narrow
              keeps a book-like line length; full width uses all of it. It already adjusts when you
              collapse or expand the sidebar.
            </p>
            <input
              id="content-width"
              type="range"
              min={CONTENT_WIDTH_MIN}
              max={CONTENT_WIDTH_MAX}
              step={5}
              value={contentWidth}
              onChange={(e) => onSetContentWidth(Number(e.target.value))}
              className="mt-3 h-1.5 w-full cursor-pointer accent-primary"
            />
          </div>
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
