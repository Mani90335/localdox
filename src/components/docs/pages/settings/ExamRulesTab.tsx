import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { isRulesFile, rulesTag, rulesetTitle } from "@/services/exams/rules-tag";
import { xruleTemplate, type RulesTemplate } from "@/services/exams/templates";
import { Empty, Group, Row, Section } from "./primitives";

const RulesetEditor = lazy(() =>
  import("./RulesetEditor").then((m) => ({ default: m.RulesetEditor })),
);

type Check = { ok: true; facts: string[] } | { ok: false; problems: string[] };
type Checker = (content: string, name: string) => Check;

/**
 * The rules check is the exam importer's own parser, so a ruleset that reads
 * cleanly here runs. It pulls in the exam engine's schema, so it loads only
 * once this section opens.
 */
const loadChecker = (): Promise<Checker> =>
  Promise.all([
    import("@/services/exams/xrule"),
    import("@/services/exams/ui/display"),
    import("@/services/exams/schema"),
    import("@/services/exams/practice-rules"),
  ]).then(
    ([
      { parseXrule, xruleSchema },
      { describeIssue, setupFacts },
      { ExamImportError, parseJson },
      { practiceFacts },
    ]) => {
      return (content, name) => {
        try {
          const raw = parseJson(content, xruleSchema, name);
          return {
            ok: true,
            facts: raw.practice
              ? practiceFacts(raw.practice)
              : setupFacts(parseXrule(content, name)),
          };
        } catch (error) {
          return {
            ok: false,
            problems:
              error instanceof ExamImportError
                ? error.issues.map(describeIssue)
                : [error instanceof Error ? error.message : String(error)],
          };
        }
      };
    },
  );

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Read from the template so the hint can't drift from what is made. */
const STARTER = JSON.parse(xruleTemplate("")) as {
  durationMinutes: number;
  passPercentage: number;
  maxAttempts: number;
};
/** What each starting point gives, in the words a person choosing needs. */
const TEMPLATES: Record<RulesTemplate, { label: string; name: string; hint: string }> = {
  practice: {
    label: "Practice",
    name: "Practice",
    hint: "One question at a time, optional time limit, and solve times kept only in this browser.",
  },
  default: {
    label: "Default rules",
    name: "",
    hint: `${STARTER.durationMinutes} minutes, ${STARTER.passPercentage}% to pass, ${STARTER.maxAttempts} attempts, no negative marking.`,
  },
  gate: {
    label: "GATE",
    name: "GATE mock",
    hint: "The GATE pattern: 65 questions in General Aptitude and Subject sections, 3 hours, −1/3 for a wrong MCQ, NAT keypad, scientific calculator, answers kept only with Save & next. Tag each question section=GA or section=subject. For a shorter mock, lower questionCount and durationMinutes.",
  },
};
const quiet =
  "coarse:min-h-11 coarse:px-3 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50";

/**
 * Settings ▸ Exam rules: every `.xrule` in the open workspace. Rulesets are
 * kept here rather than in the sidebar because a paper names the one it uses
 * (`rules: name.xrule` in its header), so where a ruleset sits no longer
 * matters, and one ruleset usually runs many papers.
 */
export function ExamRulesSettings({
  files,
  initialRulesId,
  onSave,
  onCreate,
  onBin,
}: {
  files: MdFile[];
  /** Open on this ruleset, editing — a paper's "edit its rules". */
  initialRulesId?: string;
  onSave: (fileId: string, content: string) => void;
  onCreate: (name: string, template: RulesTemplate) => { id: string; name: string };
  onBin: (fileIds: string[]) => void;
}) {
  const [check, setCheck] = useState<Checker | null>(null);
  const [loadError, setLoadError] = useState("");
  const [openId, setOpenId] = useState(initialRulesId ?? null);
  const [naming, setNaming] = useState<string | null>(null);
  const [template, setTemplate] = useState<RulesTemplate>("default");

  useEffect(() => {
    let alive = true;
    loadChecker()
      .then((fn) => alive && setCheck(() => fn))
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const rulesets = useMemo(
    () =>
      files
        .filter((f) => !f.deletedAt && isRulesFile(f))
        .sort((a, b) => rulesetTitle(a).localeCompare(rulesetTitle(b))),
    [files],
  );
  /** How many papers name each ruleset, by file name. */
  const uses = useMemo(() => {
    const count = new Map<string, { exams: number; practice: number }>();
    for (const f of files) {
      if (
        f.deletedAt ||
        !(f.kind === "exam" || f.kind === "practice" || /\.(xam|xp)$/i.test(f.name))
      )
        continue;
      const tag = rulesTag(f.content);
      if (tag) {
        const current = count.get(tag) ?? { exams: 0, practice: 0 };
        if (f.kind === "practice" || /\.xp$/i.test(f.name)) current.practice++;
        else current.exams++;
        count.set(tag, current);
      }
    }
    return count;
  }, [files]);

  const create = () => {
    const name = naming?.trim();
    if (!name) return;
    setOpenId(onCreate(name, template).id);
    setNaming(null);
  };
  const startNaming = (from: RulesTemplate) => {
    setTemplate(from);
    setNaming(TEMPLATES[from].name);
  };
  /** Switching template swaps a name the person hasn't changed. */
  const chooseTemplate = (next: RulesTemplate) => {
    if (naming === null || naming === TEMPLATES[template].name) setNaming(TEMPLATES[next].name);
    setTemplate(next);
  };

  return (
    <div className="space-y-5">
      <Section
        title="Rulesets"
        description="Shared rules for exams and practice. Edit with the form or JSON; save when ready."
        action={
          naming === null && (
            <button
              type="button"
              onClick={() => startNaming("default")}
              className={`${quiet} shrink-0 border border-border bg-background text-foreground hover:bg-accent`}
            >
              New ruleset
            </button>
          )
        }
      >
        <Group>
          {naming !== null && (
            <form
              className="space-y-2 px-4 py-3"
              aria-label="New ruleset"
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <div
                role="radiogroup"
                aria-label="Start from"
                className="inline-flex rounded-md border border-border p-0.5"
              >
                {(Object.keys(TEMPLATES) as RulesTemplate[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={template === key}
                    onClick={() => chooseTemplate(key)}
                    className={`${quiet} ${
                      template === key
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {TEMPLATES[key].label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  data-settings-draft
                  value={naming}
                  onChange={(e) => setNaming(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setNaming(null)}
                  placeholder="Ruleset name"
                  aria-label="New ruleset name"
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11"
                />
                <button
                  type="button"
                  onClick={() => setNaming(null)}
                  className={`${quiet} text-muted-foreground hover:bg-accent hover:text-foreground`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!naming.trim()}
                  className={`${quiet} bg-foreground text-background hover:opacity-90`}
                >
                  Create
                </button>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {TEMPLATES[template].hint}
              </p>
            </form>
          )}
          {rulesets.length === 0 && naming === null ? (
            <Empty>
              No rulesets yet. Create an exam from the sidebar’s + menu, add one here, or{" "}
              <button
                type="button"
                onClick={() => startNaming("gate")}
                className="font-medium text-foreground underline underline-offset-2"
              >
                start from GATE
              </button>
              .
            </Empty>
          ) : (
            rulesets.map((file) => (
              <RulesetRow
                key={file.id}
                file={file}
                used={uses.get(file.name)?.exams ?? 0}
                practiceUsed={uses.get(file.name)?.practice ?? 0}
                check={check}
                startOpen={file.id === openId}
                onSave={onSave}
                onBin={onBin}
              />
            ))
          )}
          {loadError && (
            <p role="alert" className="px-4 py-3 text-xs leading-relaxed text-destructive">
              The rules check could not load. {loadError}
            </p>
          )}
        </Group>
      </Section>
    </div>
  );
}

function RulesetRow({
  file,
  used,
  practiceUsed,
  check,
  startOpen,
  onSave,
  onBin,
}: {
  file: MdFile;
  used: number;
  practiceUsed: number;
  check: Checker | null;
  startOpen: boolean;
  onSave: (fileId: string, content: string) => void;
  onBin: (fileIds: string[]) => void;
}) {
  const [draft, setDraft] = useState<string | null>(startOpen ? file.content : null);
  const rowRef = useRef<HTMLDivElement>(null);
  const saved = useMemo(() => check?.(file.content, file.name), [check, file.content, file.name]);
  const drafted = useMemo(
    () => (draft === null ? undefined : check?.(draft, file.name)),
    [check, draft, file.name],
  );

  // Opened on purpose (a paper's "edit its rules", or just created): bring it
  // into view, since the list may be long.
  useEffect(() => {
    if (startOpen) rowRef.current?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = rulesetTitle(file);
  const usage = [
    used ? plural(used, "exam") : "",
    practiceUsed ? plural(practiceUsed, "practice file") : "",
  ]
    .filter(Boolean)
    .join(" and ");
  const usedText = usage ? `Used by ${usage}` : "Not used yet";
  const bin = () => {
    if (
      (used || practiceUsed) &&
      !window.confirm(
        `“${title}” is used by ${usage}. Those files will need other rules until it is restored. Move it to the Bin?`,
      )
    )
      return;
    onBin([file.id]);
  };

  return (
    <div ref={rowRef} data-ruleset={file.name}>
      <Row
        label={title}
        hint={
          <>
            <span className="font-mono">{file.name}</span>
            {" · "}
            {saved === undefined ? (
              "Checking…"
            ) : saved.ok ? (
              <span className="tabular-nums">{saved.facts.join(" · ")}</span>
            ) : (
              <span className="text-destructive">
                {plural(saved.problems.length, "problem")} to fix
              </span>
            )}
            {" · "}
            {usedText}
          </>
        }
        control={
          draft === null && (
            <>
              <button
                type="button"
                onClick={() => setDraft(file.content)}
                aria-label={`Edit ${title}`}
                className={`${quiet} text-foreground hover:bg-accent`}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={bin}
                aria-label={`Move ${title} to the Bin`}
                className={`${quiet} text-destructive hover:bg-destructive/10`}
              >
                Delete
              </button>
            </>
          )
        }
      />
      {draft !== null && (
        <div className="space-y-2 px-4 pb-4">
          <Suspense fallback={<p className="text-xs text-muted-foreground">Loading editor…</p>}>
            <RulesetEditor
              draft={draft}
              onChange={setDraft}
              name={file.name}
              onCancel={() => setDraft(null)}
              onSave={() => {
                if (!drafted?.ok) return;
                if (draft !== file.content) onSave(file.id, draft);
                setDraft(null);
              }}
            />
          </Suspense>
          {drafted && !drafted.ok ? (
            <div role="alert" className="text-xs text-destructive">
              <p className="flex items-center gap-1.5 font-medium">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {drafted.problems.length === 1
                  ? "One thing to fix before these rules run"
                  : `${drafted.problems.length} things to fix before these rules run`}
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-foreground">
                {drafted.problems.slice(0, 6).map((problem, i) => (
                  <li key={i}>{problem}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {drafted?.ok ? drafted.facts.join(" · ") : "Checking…"}
            </p>
          )}
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setDraft(null)}
              className={`${quiet} text-muted-foreground hover:bg-accent hover:text-foreground`}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!drafted?.ok}
              onClick={() => {
                if (draft !== file.content) onSave(file.id, draft);
                setDraft(null);
              }}
              className={`${quiet} bg-foreground text-background hover:opacity-90`}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
