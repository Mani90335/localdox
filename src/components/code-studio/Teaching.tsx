import { ArrowRight, Monitor } from "lucide-react";
import type { Snapshot } from "@/services/code-studio/protocol";
import { ValueBox } from "./SceneParts";

// A stored scene: a named value flows through an operation into another box.
export function FirstProgram({ step }: { step: Snapshot }) {
  const { number, answer } = step.frames[0]?.locals ?? {};
  const phase = step.stdout
    ? "show"
    : answer !== undefined
      ? "calculate"
      : number !== undefined
        ? "save"
        : "ready";
  return (
    <div
      className={`cs-first-program cs-film-scene phase-${phase}`}
      aria-label="A number becomes an answer"
    >
      <div className="cs-scene-orbit" aria-hidden="true" />
      <div className="cs-equation-scene">
        <ValueBox name="number" value={number} changed={phase === "save"} />
        <span
          className={`cs-multiply ${answer !== undefined ? "is-lit" : ""}`}
          aria-label="Multiply by two"
        >
          × 2
        </span>
        <ArrowRight className="cs-flow-arrow" size={25} aria-hidden="true" />
        <ValueBox name="answer" value={answer} changed={phase === "calculate"} />
      </div>
      {phase === "show" && (
        <div className="cs-output-beam" aria-hidden="true">
          <span />
          <Monitor size={28} />
        </div>
      )}
    </div>
  );
}
