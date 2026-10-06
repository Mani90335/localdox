import { useMemo } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { ExamImportError, parseJson } from "@/services/exams/schema";
import { describeIssue, setupFacts } from "@/services/exams/ui/display";
import { parseXrule, xruleSchema } from "@/services/exams/xrule";
import { practiceFacts } from "@/services/exams/practice-rules";
import { JsonViewer } from "./JsonViewer";
import type { Props } from "./shared";

/**
 * An `.xrule` file: exam rules as JSON. It opens in the JSON viewer (tree,
 * mind map, validated editor), headed by what the exam importer makes of it.
 * The check runs the same parser the importer does, so a file that reads as
 * valid here imports.
 */
export function ExamRulesViewer(props: Props) {
  const { content, name } = props.file;
  const check = useMemo(() => {
    try {
      const raw = parseJson(content, xruleSchema, name);
      if (raw.practice)
        return { ok: true as const, title: raw.name, facts: practiceFacts(raw.practice) };
      const setup = parseXrule(content, name);
      return { ok: true as const, title: setup.name, facts: setupFacts(setup) };
    } catch (error) {
      return {
        ok: false as const,
        problems:
          error instanceof ExamImportError
            ? error.issues.map(describeIssue)
            : [error instanceof Error ? error.message : String(error)],
      };
    }
  }, [content, name]);
  const summary = check.ok ? (
    <p
      className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-hairline bg-surface-sunken px-4 py-3 text-sm text-muted-foreground"
      aria-label="Rules summary"
    >
      <CircleCheck className="h-4 w-4 shrink-0 text-lime-600 dark:text-lime-400" aria-hidden />
      <span className="font-medium text-foreground">{check.title}</span>
      {check.facts.map((fact) => (
        <span key={fact} className="tabular-nums">
          {fact}
        </span>
      ))}
    </p>
  ) : (
    <div
      role="alert"
      className="mb-5 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
    >
      <p className="flex items-center gap-2 font-medium text-destructive">
        <CircleAlert className="h-4 w-4 shrink-0" aria-hidden />
        {check.problems.length === 1
          ? "One thing to fix before these rules import"
          : `${check.problems.length} things to fix before these rules import`}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-foreground">
        {check.problems.slice(0, 8).map((problem, i) => (
          <li key={i}>{problem}</li>
        ))}
      </ul>
    </div>
  );
  return <JsonViewer {...props} kindLabel="Ruleset" summary={summary} />;
}
