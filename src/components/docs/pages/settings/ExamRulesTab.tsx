import { useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { isRulesFile, rulesTag, rulesetTitle } from "@/services/exams/rules-tag";
import { Empty, Group, Row, Section } from "./primitives";

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
  ]).then(([{ parseXrule }, { describeIssue, setupFacts }, { ExamImportError }]) => {
    return (content, name) => {
      try {
        return { ok: true, facts: setupFacts(parseXrule(content, name)) };
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
  });

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
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
  onCreate: (name: string) => { id: string; name: string };
  onBin: (fileIds: string[]) => void;
}) {
  const [check, setCheck] = useState<Checker | null>(null);
  const [loadError, setLoadError] = useState("");
  const [openId, setOpenId] = useState(initialRulesId ?? null);
  const [naming, setNaming] = useState<string | null>(null);

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
    const count = new Map<string, number>();
    for (const f of files) {
      if (f.deletedAt || !(f.kind === "exam" || /\.xam$/i.test(f.name))) continue;
      const tag = rulesTag(f.content);
      if (tag) count.set(tag, (count.get(tag) ?? 0) + 1);
    }
    return count;
  }, [files]);

  const create = () => {
    const name = naming?.trim();
    if (!name) return;
    setOpenId(onCreate(name).id);
    setNaming(null);
  };

  return (
    <div className="space-y-7">
      <Section
        title="Rulesets"
        description="How an exam runs: time, pass mark, attempts and marking. Each exam names its ruleset, so one ruleset can run many exams. Edits apply to an exam until its first attempt."
        action={
          naming === null && (
            <button
              type="button"
              onClick={() => setNaming("")}
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
              className="flex items-center gap-2 px-4 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
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
            </form>
          )}
          {rulesets.length === 0 && naming === null ? (
            <Empty>
              No rulesets yet. Create an exam from the sidebar’s + menu, or add one here.
            </Empty>
          ) : (
            rulesets.map((file) => (
              <RulesetRow
                key={file.id}
                file={file}
                used={uses.get(file.name) ?? 0}
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
  check,
  startOpen,
  onSave,
  onBin,
}: {
  file: MdFile;
  used: number;
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
  const usedText = used ? `Used by ${plural(used, "exam")}` : "Not used yet";
  const bin = () => {
    if (
      used &&
      !window.confirm(
        `${plural(used, "exam")} use${used === 1 ? "s" : ""} “${title}”. They will ask for other rules until it is restored from the Bin. Move it to the Bin?`,
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
          <textarea
            autoFocus
            data-settings-draft
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setDraft(null);
              if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (draft !== file.content) onSave(file.id, draft);
                setDraft(null);
              }
            }}
            spellCheck={false}
            rows={Math.min(18, Math.max(8, draft.split("\n").length + 1))}
            aria-label={`Edit ${file.name}`}
            className="w-full resize-y rounded-lg border border-border bg-surface-sunken p-3 font-mono text-xs leading-5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
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
          {/* A draft with problems still saves: it is the author's text, and the
              exam says what to fix until it is. Same as a paper's editor. */}
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
