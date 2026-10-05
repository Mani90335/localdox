import { useMemo, useRef, useState } from "react";
import { BookOpen, Search, Upload } from "lucide-react";
import type { AttemptRecord, ExamRecord } from "./storage";
import { canReleaseScore } from "./session";
import { meetsPassingScore, progressionPolicy, scorePercentage } from "./study-plan";
import { InstructionsSummary } from "./Instructions";
import {
  Button,
  Chip,
  Dialog,
  DialogClose,
  EmptyState,
  LinkButton,
  PageHeader,
  type Tone,
} from "./ui/kit";
import {
  examKind,
  formatDateTime,
  formatDuration,
  formatKey,
  formatPercent,
  groupByFormat,
  isShortSample,
  totalMarks,
  trimNumber,
  type ExamKind,
} from "./ui/display";

export interface ContinueItem {
  label: string;
  title: string;
  meta: string;
  cta: string;
  run: () => void;
}
const FILTERS: { id: "all" | ExamKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "full", label: "Full papers" },
  { id: "sectional", label: "Sectional" },
  { id: "quiz", label: "Quizzes" },
];
function attemptStatus(a: AttemptRecord): { label: string; tone: Tone } {
  const phase = a.session.phase;
  if (phase === "in_progress" || phase === "instructions")
    return { label: "In progress", tone: "accent" };
  if (phase === "submitting" || phase === "reflection" || !a.analysis)
    return { label: "Grading", tone: "neutral" };
  if (a.study) {
    const passed = meetsPassingScore(
      a.analysis.score,
      a.analysis.totalMarks,
      progressionPolicy(a.exam.exam.rules).passPercentage,
    );
    return passed ? { label: "Passed", tone: "success" } : { label: "Not passed", tone: "warning" };
  }
  return { label: "Completed", tone: "neutral" };
}

/** Browse every ruleset and start a single paper outside a study plan. */
export function LibraryPanel({
  library,
  dev,
  onStart,
  onImportFiles,
  onLoadDemo,
}: {
  library: ExamRecord[];
  dev: boolean;
  onStart: (exam: ExamRecord) => void;
  onImportFiles: (files: File[]) => void;
  onLoadDemo: () => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState<"all" | ExamKind>("all"),
    [versions, setVersions] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState<ExamRecord | null>(null);
  const groups = useMemo(
    () =>
      groupByFormat(
        [...library].sort((a, b) => a.id.localeCompare(b.id)),
        (e) => formatKey(e.exam.rules, e.exam.taxonomy.id),
      ),
    [library],
  );
  const needle = query.trim().toLowerCase();
  const visible = groups.filter((group) =>
    group.some(
      (e) =>
        (filter === "all" || examKind(e.exam.rules) === filter) &&
        (!needle || e.exam.rules.meta.name.toLowerCase().includes(needle)),
    ),
  );
  return (
    <>
      <PageHeader
        title="Library"
        subtitle="Take any paper on its own, without a study plan."
        actions={
          <>
            <Button onClick={() => input.current?.click()}>
              <Upload size={16} aria-hidden="true" /> Import exam files
            </Button>
            <input
              ref={input}
              type="file"
              multiple
              accept=".zip,.json,.md,.png,.jpg,.jpeg,.gif,.webp,.svg"
              className="sr-only"
              aria-label="Import exam files"
              onChange={(e) => {
                onImportFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </>
        }
      />

      {/* Search and filters earn their place only once the list is long. */}
      {groups.length > 6 && (
        <div className="xl-toolbar">
          <div className="xl-search">
            <Search size={16} aria-hidden="true" />
            <input
              className="ex-input"
              type="search"
              placeholder="Search exams"
              aria-label="Search exams"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="ex-row" role="group" aria-label="Exam type">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="ex-filter"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {visible.length ? (
        <div className="xl-grid">
          {visible.map((group) => {
            const key = group[0].id,
              chosen = group.find((e) => e.id === versions[key]) ?? group[0],
              r = chosen.exam.rules,
              paper = chosen.exam.paper;
            return (
              <article className="ex-surface xl-card" key={key}>
                <h2>{r.meta.name}</h2>
                <p className="ex-meta tabular">
                  <span>{paper.length} questions</span>
                  <span>{formatDuration(r.timing.durationMinutes * 60)}</span>
                  <span>{trimNumber(totalMarks(paper))} marks</span>
                </p>
                {isShortSample(r, paper) && (
                  <div>
                    <Chip>Sample</Chip>
                  </div>
                )}
                {group.length > 1 && (
                  <label
                    className="ex-field"
                    style={{
                      fontWeight: 500,
                      fontSize: 13,
                      color: "var(--ex-text-2)",
                      marginTop: 4,
                    }}
                  >
                    Version
                    <select
                      className="ex-select"
                      value={chosen.id}
                      onChange={(e) => setVersions((v) => ({ ...v, [key]: e.target.value }))}
                    >
                      {group.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.exam.rules.meta.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="xl-card-actions">
                  <Button onClick={() => onStart(chosen)}>Start</Button>
                  <LinkButton onClick={() => setPreview(chosen)}>Instructions</LinkButton>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          quiet
          icon={<BookOpen size={20} />}
          title={library.length ? "No exams match" : "No exams yet"}
          actions={
            library.length ? (
              <Button
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button onClick={() => input.current?.click()}>Import exam files</Button>
            )
          }
        >
          {library.length
            ? "Try another search or filter."
            : "Import a ruleset, paper and solutions to add your first exam."}
        </EmptyState>
      )}

      {dev && (
        <details className="xi-author" style={{ marginTop: 32 }}>
          <summary>Developer demos</summary>
          <div className="ex-surface ex-stack" style={{ gap: 12 }}>
            <p className="ex-small">
              Load a submitted fixture that triggers every default diagnostic rule.
            </p>
            <div>
              <Button onClick={onLoadDemo}>Load diagnostic demo</Button>
            </div>
          </div>
        </details>
      )}

      <Dialog
        open={!!preview}
        onOpenChange={(open) => !open && setPreview(null)}
        wide
        title={preview?.exam.rules.meta.name ?? "Instructions"}
        footer={
          <>
            <DialogClose asChild>
              <Button>Close</Button>
            </DialogClose>
            <Button
              variant="primary"
              onClick={() => {
                const record = preview!;
                setPreview(null);
                onStart(record);
              }}
            >
              Start
            </Button>
          </>
        }
      >
        {preview && <InstructionsSummary record={preview} dev={dev} />}
      </Dialog>
    </>
  );
}

/** Every finished or in-progress attempt, newest first. */
export function HistoryPanel({
  attempts,
  onOpenAttempt,
}: {
  attempts: AttemptRecord[];
  onOpenAttempt: (attempt: AttemptRecord) => void;
}) {
  const [showDemo, setShowDemo] = useState(false);
  const history = [...attempts]
    .filter((a) => a.session.startedAt !== undefined && (showDemo || !a.session.demo))
    .sort((a, b) => b.session.createdAt - a.session.createdAt);
  const hasDemo = attempts.some((a) => a.session.demo);
  return (
    <>
      <PageHeader
        title="History"
        actions={
          hasDemo ? (
            <label className="ex-field ex-field--inline ex-small" style={{ fontWeight: 500 }}>
              <input
                className="ex-check"
                type="checkbox"
                checked={showDemo}
                onChange={(e) => setShowDemo(e.target.checked)}
              />
              Show demo
            </label>
          ) : undefined
        }
      />
      {history.length ? (
        <div className="ex-surface ex-surface--flush">
          <div className="ex-table-wrap">
            <table className="ex-table">
              <thead>
                <tr>
                  <th scope="col">Exam</th>
                  <th scope="col" className="xl-hide-sm">
                    Date
                  </th>
                  <th scope="col" className="num">
                    Score
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((a) => {
                  const r = a.exam.exam.rules,
                    status = attemptStatus(a),
                    scored = a.analysis && canReleaseScore(r);
                  return (
                    <tr key={a.id} data-href onClick={() => onOpenAttempt(a)}>
                      <td>
                        <button
                          type="button"
                          className="xl-row-title"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenAttempt(a);
                          }}
                        >
                          {r.meta.name}
                        </button>
                        {a.session.demo && (
                          <>
                            {" "}
                            <Chip>Demo</Chip>
                          </>
                        )}
                        <span className="ex-small xl-show-sm">
                          {formatDateTime(a.session.createdAt)}
                        </span>
                      </td>
                      <td className="xl-hide-sm ex-muted" style={{ whiteSpace: "nowrap" }}>
                        {formatDateTime(a.session.createdAt)}
                      </td>
                      <td className="num">
                        {scored ? (
                          <span className="xl-score">
                            <strong>
                              {formatPercent(
                                scorePercentage(a.analysis!.score, a.analysis!.totalMarks),
                              )}
                            </strong>
                            <small>
                              {a.analysis!.score.toFixed(r.results.rounding)}/
                              {trimNumber(a.analysis!.totalMarks)}
                            </small>
                          </span>
                        ) : (
                          <span className="ex-muted">—</span>
                        )}
                      </td>
                      <td>
                        <Chip tone={status.tone}>{status.label}</Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState quiet title="No attempts yet">
          Finished exams appear here with their scores.
        </EmptyState>
      )}
    </>
  );
}
