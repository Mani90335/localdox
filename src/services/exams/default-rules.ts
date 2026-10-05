import type { Rule, Ruleset } from "./schema.ts";
// JSON data only. Configuration substitutes the two pacing thresholds below.
export const defaultRules: Rule[] = [
  {
    id: "slow_on_easy",
    scope: "question",
    label: "Time sink on an easy question",
    cause: "time_pressure",
    severity: 2,
    when: {
      all: [
        { signal: "difficulty", op: "==", value: "easy" },
        { signal: "timeRatio", op: ">=", value: 1.5 },
      ],
    },
    advice: "{topic}: spent {spentSec}s against {expectedSec}s. Cap easy questions and move on.",
  },
  {
    id: "stuck_on_hard",
    scope: "question",
    label: "Stuck on a hard question",
    cause: "time_pressure",
    severity: 2,
    when: {
      all: [
        { signal: "difficulty", op: "==", value: "hard" },
        { signal: "timeRatio", op: ">=", value: 2 },
        { signal: "outcome", op: "in", value: ["wrong", "unanswered"] },
      ],
    },
    advice:
      "{topic}: set a stopping point for difficult questions; return after banking easier marks.",
  },
  {
    id: "rushed_wrong",
    scope: "question",
    label: "Rushed and wrong",
    cause: "careless",
    severity: 2,
    when: {
      all: [
        { signal: "timeRatio", op: "<=", value: 0.4 },
        { signal: "outcome", op: "==", value: "wrong" },
      ],
    },
    advice: "{topic}: check units, signs and the requested quantity before saving.",
  },
  {
    id: "overconfident_wrong",
    scope: "question",
    label: "Overconfident error",
    cause: "overconfidence",
    severity: 2,
    when: {
      all: [
        { signal: "confidence", op: "==", value: "sure" },
        { signal: "outcome", op: "==", value: "wrong" },
      ],
    },
    advice: "{topic}: explain why each alternative is wrong before committing with confidence.",
  },
  {
    id: "lucky_guess",
    scope: "question",
    label: "Correct guess",
    cause: "guess",
    severity: 1,
    when: {
      all: [
        { signal: "confidence", op: "==", value: "guess" },
        { signal: "outcome", op: "==", value: "correct" },
      ],
    },
    advice: "{topic}: re-solve without options to check understanding.",
  },
  {
    id: "underconfident_right",
    scope: "question",
    label: "Underconfident but correct",
    cause: null,
    severity: 1,
    when: {
      all: [
        { signal: "confidence", op: "==", value: "unsure" },
        { signal: "outcome", op: "==", value: "correct" },
        { signal: "difficulty", op: "==", value: "easy" },
      ],
    },
    advice: "{topic}: your method worked. Record it and practice recognizing it.",
  },
  {
    id: "unjustified_guess_penalty",
    scope: "question",
    label: "Guess cost marks",
    cause: "guess",
    severity: 2,
    when: {
      all: [
        { signal: "confidence", op: "==", value: "guess" },
        { signal: "outcome", op: "==", value: "wrong" },
        { signal: "negativeMarksTaken", op: ">", value: 0 },
      ],
    },
    advice: "{topic}: account for the marking penalty before guessing.",
  },
  {
    id: "fell_for_trap",
    scope: "question",
    label: "Known distractor selected",
    cause: "$trap",
    severity: 3,
    when: { signal: "selectedTrap", op: "!=", value: "none" },
    advice: "{topic}: review the {trap} trap and write a counterexample.",
  },
  {
    id: "changed_right_to_wrong",
    scope: "question",
    label: "Changed a correct answer",
    cause: "overconfidence",
    severity: 2,
    when: { signal: "changedCorrectToWrong", op: "==", value: true },
    advice: "{topic}: change an answer only with a specific reason or calculation.",
  },
  {
    id: "skipped_easy",
    scope: "question",
    label: "Easy marks left unanswered",
    cause: "concept_gap",
    severity: 2,
    when: {
      all: [
        { signal: "difficulty", op: "==", value: "easy" },
        { signal: "outcome", op: "==", value: "unanswered" },
      ],
    },
    advice: "{topic}: revisit the basic method and practice short retrieval drills.",
  },
  {
    id: "late_collapse",
    scope: "exam",
    label: "Accuracy fell late in the exam",
    cause: "time_pressure",
    severity: 3,
    when: { signal: "accuracyDrop", op: ">=", value: 20 },
    advice:
      "Reserve a final review budget; accuracy fell by at least 20 percentage points in the last third.",
  },
  {
    id: "guess_bleed",
    scope: "exam",
    label: "Repeated guessing penalties",
    cause: "guess",
    severity: 3,
    when: { signal: "guessPenaltyMarks", op: ">=", value: 3 },
    advice: "Track eliminated options and avoid guesses whose penalties outweigh likely gains.",
  },
];
export function resolvedRules(r: Ruleset): Rule[] {
  const defaults = structuredClone(defaultRules);
  for (const rule of defaults) {
    if ("all" in rule.when) {
      const threshold = rule.when.all.find((c) => "signal" in c && c.signal === "timeRatio");
      if (threshold && "value" in threshold) {
        if (rule.id === "slow_on_easy") threshold.value = r.diagnostics.pacing.slowRatio;
        if (rule.id === "rushed_wrong") threshold.value = r.diagnostics.pacing.fastRatio;
      }
    }
  }
  const merged = new Map(defaults.map((rule) => [rule.id, rule]));
  for (const rule of r.diagnostics.rules) merged.set(rule.id, rule);
  return [...merged.values()].filter((rule) => !r.diagnostics.disabledRules.includes(rule.id));
}
