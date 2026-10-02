import { Check, Files, ScrollText } from "lucide-react";
import { Section, Group } from "./primitives";
import { ReadingFontSettings } from "./ReadingFontSettings";
import { CONTENT_WIDTH_MIN, CONTENT_WIDTH_MAX } from "@/lib/workspace/persistence";
import type { SettingsPageProps } from "../SettingsPage";

const MODES = [
  { id: "paginated", label: "Paged sections", hint: "Read one section at a time.", icon: Files },
  {
    id: "single",
    label: "Single page",
    hint: "Scroll through the whole document.",
    icon: ScrollText,
  },
] as const;

export function ReadingSettings(
  props: Pick<
    SettingsPageProps,
    | "readingFont"
    | "onSetReadingFont"
    | "googleFont"
    | "onSetGoogleFont"
    | "readingMode"
    | "onSetReadingMode"
    | "contentWidth"
    | "onSetContentWidth"
  >,
) {
  return (
    <div className="space-y-7">
      <Section title="Page layout">
        <Group>
          {MODES.map((mode) => {
            const Icon = mode.icon;
            const active = props.readingMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => props.onSetReadingMode(mode.id)}
                aria-pressed={active}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent/40"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{mode.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {mode.hint}
                  </span>
                </span>
                {active && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
              </button>
            );
          })}
          <div className="px-4 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="content-width" className="text-sm font-medium text-foreground">
                Content width
              </label>
              <output
                htmlFor="content-width"
                className="text-xs tabular-nums text-muted-foreground"
              >
                {props.contentWidth}%
              </output>
            </div>
            <p
              id="content-width-hint"
              className="mt-1 text-xs leading-relaxed text-muted-foreground"
            >
              Set the space your reading and editing column fills.
            </p>
            <input
              id="content-width"
              aria-describedby="content-width-hint"
              type="range"
              min={CONTENT_WIDTH_MIN}
              max={CONTENT_WIDTH_MAX}
              step={5}
              value={props.contentWidth}
              onChange={(event) => props.onSetContentWidth(Number(event.target.value))}
              className="mt-3 h-5 w-full cursor-pointer accent-primary"
            />
            <div
              aria-hidden="true"
              className="mt-1 flex justify-between text-xs text-muted-foreground"
            >
              <span>Narrow</span>
              <span>Full width</span>
            </div>
          </div>
        </Group>
      </Section>
      <ReadingFontSettings {...props} />
    </div>
  );
}
