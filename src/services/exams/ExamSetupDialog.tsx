import { useEffect, useState, type FormEvent } from "react";
import { GATE_SETUP, GATE_RULESET, examSetupSchema, type ExamSetup } from "./exam-setup";
import { Button, Dialog, DialogClose } from "./ui/kit";

/** Step one of a study-plan exam: its rules. The file comes after. */
export function ExamSetupDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (setup: ExamSetup) => void;
}) {
  const [form, setForm] = useState(GATE_SETUP),
    [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setForm(GATE_SETUP);
      setError("");
      setRootJson(JSON.stringify(GATE_RULESET, null, 2));
    }
  }, [open]);
  const [rootJson, setRootJson] = useState(JSON.stringify(GATE_RULESET, null, 2));
  const set = <K extends keyof ExamSetup>(key: K, value: ExamSetup[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const number = (
    key: "durationMinutes" | "passPercentage" | "maxAttempts" | "questionCount",
    label: string,
    min: number,
    max: number,
  ) => (
    <label className="ex-field">
      {label}
      <input
        className="ex-input"
        type="number"
        inputMode="numeric"
        required
        min={min}
        max={max}
        value={Number.isNaN(form[key]) ? "" : form[key]}
        onChange={(e) => set(key, e.target.valueAsNumber)}
      />
    </label>
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    let rootRules: unknown;
    try {
      rootRules = JSON.parse(rootJson);
    } catch {
      setError("Exam structure must be valid JSON.");
      return;
    }
    const result = examSetupSchema.safeParse({ ...form, rootRules });
    if (!result.success) {
      const issue = result.error.issues[0];
      setError(
        issue.path.length && issue.path[0] !== "name"
          ? `${labels[issue.path[0] as string] ?? issue.path[0]}: ${issue.message}`
          : issue.message,
      );
      return;
    }
    onCreate(result.data);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New exam"
      description="Create a variation of the GATE exam structure. Then upload one Markdown file containing questions, keys and solutions."
      footer={
        <>
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <Button variant="primary" type="submit" form="exam-setup">
            Create exam
          </Button>
        </>
      }
    >
      <form
        id="exam-setup"
        className="ex-stack xp-setup"
        style={{ gap: 16 }}
        onSubmit={submit}
        noValidate
      >
        <label className="ex-field">
          Exam structure
          <select className="ex-select" value="gate" onChange={() => {}}>
            <option value="gate">GATE</option>
          </select>
        </label>

        <label className="ex-field">
          Name
          <input
            className="ex-input"
            required
            maxLength={160}
            autoFocus
            placeholder="e.g. Conditional probability"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </label>
        <div className="xp-setup-grid">
          {number("questionCount", "Questions", 1, 500)}
          {number("durationMinutes", "Time (minutes)", 1, 600)}
          {number("passPercentage", "Pass mark (%)", 0, 100)}
          {number("maxAttempts", "Attempts", 1, 20)}
        </div>
        <label className="ex-field">
          What to study (optional)
          <textarea
            className="ex-textarea"
            rows={3}
            maxLength={20000}
            placeholder={"- Definition of P(A | B)\n- Multiplication rule"}
            value={form.summaryMd}
            onChange={(e) => set("summaryMd", e.target.value)}
          />
        </label>
        <details className="xp-structure">
          <summary className="ex-link">Edit exam structure (JSON)</summary>
          <p className="ex-small">
            The root defines marking, question types, navigation and tools. This variation overrides
            time, question count, pass mark and attempts. Short papers may use any section IDs; a
            full paper must match the root sections.
          </p>
          <textarea
            aria-label="Exam structure JSON"
            className="ex-textarea"
            rows={12}
            value={rootJson}
            onChange={(e) => setRootJson(e.target.value)}
            spellCheck={false}
          />
        </details>
        {error && (
          <p className="xp-setup-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
const labels: Record<string, string> = {
  durationMinutes: "Time",
  passPercentage: "Pass mark",
  maxAttempts: "Attempts",
};
