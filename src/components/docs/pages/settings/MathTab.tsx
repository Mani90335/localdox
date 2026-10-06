import { Section, Group, Row } from "./primitives";
import { Switch } from "@/components/ui/switch";
import type { SettingsPageProps } from "../SettingsPage";
import type { MathRendererType } from "@/services/math";

const RENDERERS = [
  {
    id: "auto",
    label: "Automatic (recommended)",
    hint: "Fast typesetting, with wider support loaded only when an equation needs it.",
  },
  {
    id: "katex",
    label: "Fast only",
    hint: "Use KaTeX where supported, with a fallback for other equations.",
  },
  {
    id: "mathjax",
    label: "Maximum coverage",
    hint: "Use MathJax for the widest LaTeX support. Takes longer to load.",
  },
  {
    id: "temml",
    label: "MathML (accessibility)",
    hint: "Use native MathML for compatible screen readers. Appearance varies by browser.",
  },
] as const;

export function MathSettings(
  props: Pick<
    SettingsPageProps,
    | "mathRenderer"
    | "onSetMathRenderer"
    | "mathNumbering"
    | "onSetMathNumbering"
    | "mathExplorer"
    | "onSetMathExplorer"
  >,
) {
  return (
    <div className="space-y-5">
      <Section title="Equation display">
        <Group>
          <div className="px-4 py-4">
            <label htmlFor="math-renderer" className="block text-sm font-medium text-foreground">
              Typesetting
            </label>
            <select
              id="math-renderer"
              value={props.mathRenderer}
              onChange={(event) => props.onSetMathRenderer(event.target.value as MathRendererType)}
              aria-describedby="math-renderer-hint"
              className="mt-3 min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {RENDERERS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <p
              id="math-renderer-hint"
              className="mt-2 text-xs leading-relaxed text-muted-foreground"
            >
              {RENDERERS.find((option) => option.id === props.mathRenderer)?.hint}
            </p>
          </div>
          <Row
            label="Number equations"
            hint="Add equation numbers and resolve references to them."
            control={
              <Switch
                checked={props.mathNumbering}
                onCheckedChange={props.onSetMathNumbering}
                aria-label="Number equations"
              />
            }
          />
        </Group>
      </Section>
      <Section title="Accessibility">
        <Group>
          <Row
            label="Explore equations by keyboard"
            hint="Step through an expression and hear its parts. A speech engine downloads on first use."
            control={
              <Switch
                checked={props.mathExplorer}
                onCheckedChange={props.onSetMathExplorer}
                aria-label="Explore equations by keyboard"
              />
            }
          />
        </Group>
      </Section>
    </div>
  );
}
