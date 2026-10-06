/**
 * New exam: a name and the ruleset it runs under.
 *
 * An exam is two things, its questions (`.xam`) and how it runs (`.xrule`).
 * The questions are new each time; the rules are usually shared, so the
 * dialog picks an existing ruleset first and makes a new one only when asked.
 * The choice is written into the paper's header (`rules: name.xrule`).
 */
import { useEffect, useId, useState } from "react";
import { FileQuestion } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { xruleTemplate } from "@/services/exams/templates";

/** "" in the select: make a new ruleset with the default rules. */
const NEW_RULESET = "";
/** What a new ruleset starts with, read from the template so the hint can't drift. */
const STARTER = JSON.parse(xruleTemplate("")) as {
  durationMinutes: number;
  passPercentage: number;
  maxAttempts: number;
};

export interface RulesetOption {
  /** File name, e.g. `gate-mock.xrule`: what the paper's header names. */
  name: string;
  /** The ruleset's own `name` field, when it has one. */
  title: string;
}

export function NewExamDialog({
  open,
  rulesets,
  onCancel,
  onCreate,
}: {
  open: boolean;
  rulesets: RulesetOption[];
  onCancel: () => void;
  /** `rulesName` null means make a new ruleset named after the exam. */
  onCreate: (name: string, rulesName: string | null) => void;
}) {
  const formId = useId();
  const [name, setName] = useState("");
  const [rules, setRules] = useState(NEW_RULESET);

  // Each opening starts fresh, on the first ruleset: reusing rules is the
  // common case, and a new ruleset is one choice away.
  useEffect(() => {
    if (!open) return;
    setName("");
    setRules(rulesets[0]?.name ?? NEW_RULESET);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed) return;
    onCreate(trimmed, rules === NEW_RULESET ? null : rules);
  };

  const label = "text-xs font-medium text-foreground";
  const control =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11";

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onCancel()}
      size="sm"
      icon={<FileQuestion className="h-4 w-4" />}
      title="New exam"
      description="Questions in a paper, run by a ruleset."
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            disabled={!trimmed}
            className="rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-40"
          >
            Create exam
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="block space-y-1.5">
          <span className={label}>Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Probability mock 1"
            aria-label="Exam name"
            className={control}
          />
        </label>
        <label className="block space-y-1.5">
          <span className={label}>Rules</span>
          <select
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            aria-label="Ruleset"
            className={control}
          >
            {rulesets.map((r) => (
              <option key={r.name} value={r.name}>
                {r.title === r.name.replace(/\.xrule$/i, "") ? r.name : `${r.title} (${r.name})`}
              </option>
            ))}
            <option value={NEW_RULESET}>New ruleset (default rules)</option>
          </select>
          <span className="block text-xs leading-relaxed text-muted-foreground">
            {rules === NEW_RULESET
              ? `${STARTER.durationMinutes} minutes, ${STARTER.passPercentage}% to pass, ${STARTER.maxAttempts} attempts. Change them any time in Settings ▸ Exam rules.`
              : "Time, pass mark, attempts and marking come from this ruleset. Edit it in Settings ▸ Exam rules."}
          </span>
        </label>
      </form>
    </Modal>
  );
}
