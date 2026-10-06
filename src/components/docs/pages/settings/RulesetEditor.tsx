import { useState } from "react";
import { z } from "zod";
import { xruleSchema } from "@/services/exams/xrule";
import { rulesetSchema } from "@/services/exams/schema";
import { DEFAULT_SETUP, GATE_RULESET } from "@/services/exams/exam-setup";
import { DEFAULT_PRACTICE_RULES, practiceRulesSchema } from "@/services/exams/practice-rules";
import { RulesetField } from "./RulesetFields";
import { fieldLabel, unwrap } from "./ruleset-fields";

const primary = [
  "name",
  "durationMinutes",
  "questionCount",
  "passPercentage",
  "maxAttempts",
  "mcqPenalty",
  "calculator",
];
const shape = (unwrap(xruleSchema) as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
const button =
  "rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent aria-pressed:bg-accent aria-pressed:font-medium";

/** Form and source edit the same draft. Switching views never silently normalizes authored JSON. */
export function RulesetEditor({
  draft,
  onChange,
  name,
  onCancel,
  onSave,
}: {
  draft: string;
  onChange: (text: string) => void;
  name: string;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [mode, setMode] = useState<"form" | "source">("form");
  let raw: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(draft);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed;
  } catch {
    /* Source remains available for repair. */
  }
  const patch = (key: string, value: unknown) => {
    const next = { ...raw, [key]: value };
    if (key === "preset" && value) {
      delete next.rules;
      delete next.mcqPenalty;
      delete next.calculator;
    }
    onChange(JSON.stringify(next, null, 2) + "\n");
  };
  const expandRules = () => {
    if (!raw) return;
    const rules =
      raw.preset === "gate"
        ? GATE_RULESET
        : rulesetSchema.parse({
            schemaVersion: 2,
            meta: { id: "custom", name: String(raw.name || "Exam"), version: "1" },
            timing: { mode: "global", durationMinutes: raw.durationMinutes ?? 30 },
            sections: [{ id: "exam", name: "Questions", questionCount: raw.questionCount ?? 1 }],
            questionTypes: {
              mcq: {
                negativeMarking:
                  raw.mcqPenalty === "third"
                    ? { fractionOfMarks: [1, 3] }
                    : raw.mcqPenalty === "quarter"
                      ? { fractionOfMarks: [1, 4] }
                      : null,
              },
              msq: {},
              nat: { inputMode: "keyboard" },
            },
            tools: { calculator: raw.calculator ?? "none" },
            attempts: { max: raw.maxAttempts ?? 3 },
            progression: { passPercentage: raw.passPercentage ?? 70 },
            diagnostics: { enabled: false },
            ui: { profile: "generic" },
          });
    const next: Record<string, unknown> = { ...raw, rules };
    delete next.preset;
    delete next.mcqPenalty;
    delete next.calculator;
    onChange(JSON.stringify(next, null, 2) + "\n");
  };
  const field = (key: string) => {
    const parsedRules = rulesetSchema.safeParse(raw?.rules);
    const full = parsedRules.success ? parsedRules.data : undefined;
    const defaults: Record<string, unknown> =
      raw?.preset === "gate"
        ? { durationMinutes: 180, questionCount: 65, passPercentage: 70, maxAttempts: 3 }
        : {
            ...DEFAULT_SETUP,
            ...(full
              ? {
                  durationMinutes: full.timing?.durationMinutes,
                  questionCount: full.sections?.reduce((n, s) => n + s.questionCount, 0),
                  passPercentage: full.progression?.passPercentage,
                  maxAttempts: full.attempts?.max ?? 3,
                }
              : {}),
          };
    return (
      <RulesetField
        key={key}
        schema={primary.includes(key) && key !== "questionCount" ? unwrap(shape[key]) : shape[key]}
        label={fieldLabel(key)}
        value={key === "questionCount" ? raw?.[key] : (raw?.[key] ?? defaults[key])}
        unsetLabel={
          key === "questionCount"
            ? defaults.questionCount
              ? `Uses ${defaults.questionCount} from exam rules`
              : "Matches the paper"
            : undefined
        }
        onChange={(v) => patch(key, v)}
      />
    );
  };
  const practiceOnly =
    raw?.practice !== undefined &&
    !raw?.rules &&
    !raw?.preset &&
    raw?.durationMinutes === undefined;
  return (
    <div
      className="space-y-4"
      data-settings-draft
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
        if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onSave();
        }
      }}
    >
      <div className="flex items-center gap-1" role="group" aria-label="Ruleset editor">
        <button
          type="button"
          aria-pressed={mode === "form"}
          onClick={() => setMode("form")}
          className={button}
        >
          Form
        </button>
        <button
          type="button"
          aria-pressed={mode === "source"}
          onClick={() => setMode("source")}
          className={button}
        >
          JSON
        </button>
      </div>
      {mode === "source" ? (
        <textarea
          data-settings-draft
          aria-label={`Edit ${name}`}
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          rows={16}
          spellCheck={false}
          className="w-full resize-y rounded-lg border border-border bg-surface-sunken p-3 font-mono text-xs leading-5"
        />
      ) : raw ? (
        <>
          <section aria-label="Primary rules" className="space-y-3">
            <h4 className="text-sm font-semibold">Primary</h4>
            <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
              {primary
                .filter(
                  (key) =>
                    (!practiceOnly || key === "name") &&
                    (!(raw.rules || raw.preset) || !["mcqPenalty", "calculator"].includes(key)),
                )
                .map(field)}
            </div>
            {raw.practice !== undefined && (
              <div className="rounded-lg border border-border p-3 space-y-3">
                <h4 className="text-sm font-medium">Practice</h4>
                <p className="text-xs text-muted-foreground">
                  One question at a time. A time limit advances automatically; solve times stay in
                  this browser.
                </p>
                <RulesetField
                  schema={practiceRulesSchema.shape.questionTimeLimitSeconds}
                  label="Time per question (seconds)"
                  value={
                    (raw.practice as Record<string, unknown>)?.questionTimeLimitSeconds ?? null
                  }
                  onChange={(v) =>
                    patch("practice", { ...(raw.practice as object), questionTimeLimitSeconds: v })
                  }
                />
              </div>
            )}
          </section>
          <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">Advanced</summary>
            <div className="mt-4 space-y-4">
              {raw.practice !== undefined ? (
                <>
                  {["showElapsedTime", "allowSkip"].map((key) => (
                    <RulesetField
                      key={key}
                      schema={practiceRulesSchema.shape[key as "showElapsedTime" | "allowSkip"]}
                      label={fieldLabel(key)}
                      value={(raw.practice as Record<string, unknown>)?.[key] ?? true}
                      onChange={(v) => patch("practice", { ...(raw.practice as object), [key]: v })}
                    />
                  ))}
                  <button
                    type="button"
                    className={button}
                    onClick={() => patch("practice", undefined)}
                  >
                    Remove practice controls
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={button}
                  onClick={() => patch("practice", DEFAULT_PRACTICE_RULES)}
                >
                  Add practice controls
                </button>
              )}
              {field("summary")}
              {!practiceOnly && (
                <>
                  {!raw.rules && field("preset")}
                  {raw.rules ? (
                    <RulesetField
                      schema={shape.rules}
                      label="Full exam rules"
                      value={raw.rules}
                      onChange={(v) => patch("rules", v)}
                    />
                  ) : (
                    <button
                      type="button"
                      className={button}
                      disabled={!xruleSchema.safeParse(raw).success}
                      onClick={expandRules}
                    >
                      Customize all exam rules
                    </button>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Primary values override matching full exam rules. Sections must match the paper.
                  </p>
                </>
              )}
              {field("xrule")}
            </div>
          </details>
        </>
      ) : (
        <p role="alert" className="text-sm text-destructive">
          This JSON cannot be shown as a form. Open JSON to fix it.
        </p>
      )}
    </div>
  );
}
