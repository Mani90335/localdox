import { Section, Group, Row } from "./primitives";
import { Switch } from "@/components/ui/switch";
import type { SettingsPageProps } from "../SettingsPage";

export function DiagramSettings(
  props: Pick<
    SettingsPageProps,
    | "diagramColors"
    | "onSetDiagramColors"
    | "diagramCamera"
    | "onSetDiagramCamera"
    | "diagramFollowNumbers"
    | "onSetDiagramFollowNumbers"
    | "diagramNumbers"
    | "onSetDiagramNumbers"
  >,
) {
  return (
    <div className="space-y-5">
      <Section title="Colour">
        <Group>
          <Row
            label="Colour by meaning"
            hint="Green for success, red for failure, amber for decisions. Applies to Raw and Stepped views."
            control={
              <Switch
                checked={props.diagramColors}
                onCheckedChange={props.onSetDiagramColors}
                aria-label="Colour diagrams by meaning"
              />
            }
          />
        </Group>
      </Section>
      <Section title="Stepped playback" description="Choose how a diagram unfolds as you read.">
        <Group>
          <Row
            label="Camera motion in Stepped"
            hint="Follow each part as it is drawn. Respects your device’s reduced motion setting."
            control={
              <Switch
                checked={props.diagramCamera}
                onCheckedChange={props.onSetDiagramCamera}
                aria-label="Camera motion in Stepped diagrams"
              />
            }
          />
          <Row
            label="Follow numbered arrows"
            hint="Play numbered arrows in order, then draw the remaining connections."
            control={
              <Switch
                checked={props.diagramFollowNumbers}
                onCheckedChange={props.onSetDiagramFollowNumbers}
                aria-label="Follow numbered arrows in Stepped diagrams"
              />
            }
          />
          <Row
            label="Show step numbers"
            hint="Label arrows with their playback order."
            control={
              <Switch
                checked={props.diagramNumbers}
                onCheckedChange={props.onSetDiagramNumbers}
                aria-label="Show step numbers on arrows in Stepped diagrams"
              />
            }
          />
        </Group>
      </Section>
    </div>
  );
}
