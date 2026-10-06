import { Check, Moon, Sun } from "lucide-react";
import { Section, Group, Row } from "./primitives";
import { Switch } from "@/components/ui/switch";
import type { SettingsPageProps } from "../SettingsPage";

const THEMES = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
] as const;

export function AppearanceSettings({
  theme,
  onSetTheme,
  aiEnabled,
  onSetAiEnabled,
}: Pick<SettingsPageProps, "theme" | "onSetTheme" | "aiEnabled" | "onSetAiEnabled">) {
  return (
    <div className="space-y-5">
      <Section title="Theme">
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          {THEMES.map((option) => {
            const active = theme === option.id;
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onSetTheme(option.id)}
                aria-pressed={active}
                aria-label={option.label}
                className={`group rounded-lg border p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${active ? "border-primary bg-primary/5" : "border-border bg-card hover:border-muted-foreground/50"}`}
              >
                <div
                  aria-hidden="true"
                  data-theme-preview={option.id}
                  className="settings-theme-preview flex h-20 overflow-hidden rounded-md border sm:h-24"
                >
                  <div className="settings-preview-rail w-[28%] space-y-2 border-r p-2.5 sm:p-3">
                    <div className="settings-preview-line mb-4 h-1.5 w-3/4 rounded-full" />
                    <div className="h-3.5 rounded bg-primary/20" />
                    <div className="settings-preview-line h-1 w-4/5 rounded-full" />
                    <div className="settings-preview-line h-1 w-3/5 rounded-full" />
                  </div>
                  <div className="flex-1 p-3 sm:p-4">
                    <span className="text-xl font-semibold tracking-tight">Aa</span>
                    <div className="settings-preview-line mt-3 h-1 w-4/5 rounded-full" />
                    <div className="settings-preview-line mt-1.5 h-1 w-full rounded-full" />
                    <div className="settings-preview-line mt-1.5 h-1 w-2/3 rounded-full" />
                    <div className="mt-3 h-5 rounded bg-primary/10" />
                  </div>
                </div>
                <span className="flex items-center gap-2 px-1 py-2">
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="flex-1 text-sm font-medium text-foreground">{option.label}</span>
                  <span
                    className={`flex size-4 items-center justify-center rounded-full ${active ? "bg-primary text-primary-foreground" : "border border-input"}`}
                  >
                    {active && <Check className="size-3" aria-hidden="true" />}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Make room for focus">
        <Group>
          <Row
            label="AI features"
            hint="Ask questions about your documents. Turn off to hide Ask AI throughout the app."
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
