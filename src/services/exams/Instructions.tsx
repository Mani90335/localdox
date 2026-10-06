import { useState } from "react";
import { ArrowLeft, Maximize } from "lucide-react";
import type { ExamRecord } from "./storage";
import { ExamMarkdown } from "./ExamMarkdown";
import { Button, Chip, Dialog, DialogClose, Segmented, StatBlocks } from "./ui/kit";
import { ExamAssets } from "./ExamMarkdown";
import { Glyph, type Status } from "./ui/Palette";
import {
  answeringSteps,
  formatDuration,
  isShortSample,
  markingCards,
  patternQuestionCount,
  ruleNotes,
  ruleSentences,
  sampleScale,
  totalMarks,
  trimNumber,
  uiProfile,
} from "./ui/display";

/** Author instructions often repeat the title as a leading "# Heading". */
const withoutLeadingTitle = (md: string) => md.replace(/^\s*#\s+[^\n]*\n+/, "").trim();

/** The palette legend in the words of a TCS iON instructions page. */
const legend = (counted: boolean): { status: Status; label: string }[] => [
  { status: "not_visited", label: "You have not visited the question yet." },
  { status: "not_answered", label: "You have not answered the question." },
  { status: "answered", label: "You have answered the question." },
  {
    status: "marked",
    label: "You have not answered the question, but have marked it for review.",
  },
  {
    status: "answered_marked",
    label: counted
      ? "Answered and marked for review. It will be evaluated."
      : "Answered and marked for review. It won't be evaluated.",
  },
];

/** Everything a candidate should know before starting. Shared by the page and the library preview. */
export function InstructionsSummary({
  record,
  dev,
  scale = 1,
}: {
  record: ExamRecord;
  dev: boolean;
  /** Share of the official time this attempt will get. */
  scale?: number;
}) {
  const { rules: r, paper, issues } = record.exam,
    family = uiProfile(r).glyphs,
    notes = withoutLeadingTitle(r.meta.instructionsMd),
    showAuthor = dev || issues.some((i) => i.severity === "error");
  return (
    <div className="ex-stack" style={{ gap: 32 }}>
      <section className="ex-section" aria-labelledby="xi-glance">
        <h2 id="xi-glance" className="sr-only">
          At a glance
        </h2>
        <StatBlocks
          label="At a glance"
          items={[
            { label: "Duration", value: formatDuration(r.timing.durationMinutes * 60 * scale) },
            {
              label: "Questions",
              value: paper.length,
              detail: isShortSample(r, paper) ? `of ${patternQuestionCount(r)}` : undefined,
            },
            { label: "Total marks", value: trimNumber(totalMarks(paper)) },
            { label: "Sections", value: r.sections.length },
          ]}
        />
        {r.sections.length > 1 && (
          <ul
            className="ex-hairline-list ex-surface ex-surface--flush"
            style={{ listStyle: "none", margin: 0 }}
          >
            {r.sections.map((s) => {
              const count = paper.filter((q) => q.section === s.id).length;
              return (
                <li
                  key={s.id}
                  className="ex-section-head"
                  style={{ padding: "12px 20px", fontSize: 14 }}
                >
                  <span style={{ color: "var(--ex-text)", fontWeight: 550 }}>{s.name}</span>
                  <span className="tabular">
                    {count} {count === 1 ? "question" : "questions"}
                    {s.durationMinutes ? ` · ${formatDuration(s.durationMinutes * 60)}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="ex-section" aria-labelledby="xi-marking">
        <h2 id="xi-marking">Marking</h2>
        <div className="xi-marking">
          {markingCards(r, paper).map((card) => (
            <div className="ex-surface" key={card.type}>
              <h3>{card.title}</h3>
              <p>{card.rule}</p>
              <p className="xi-example">{card.example}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="ex-section" aria-labelledby="xi-palette">
        <h2 id="xi-palette">Question palette</h2>
        <ul className="xr-legend" style={{ gridTemplateColumns: "1fr" }}>
          {legend(r.navigation.markedForReviewAnswerCounts)
            .filter((l) => r.navigation.markForReview || !l.status.includes("marked"))
            .map((l) => (
              <li key={l.status}>
                <span className="xr-glyph">
                  <Glyph status={l.status} family={family} />
                </span>
                <span style={{ color: "var(--ex-text)" }}>{l.label}</span>
              </li>
            ))}
        </ul>
      </section>

      <section className="ex-section" aria-labelledby="xi-answering">
        <h2 id="xi-answering">Answering a question</h2>
        <ol className="xi-list">
          {answeringSteps(r).map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="ex-section xi-rules" aria-labelledby="xi-rules">
        <h2 id="xi-rules">Rules</h2>
        <div>
          {ruleSentences(r).map((s) => (
            <p key={s}>{s}</p>
          ))}
        </div>
        <ul className="xi-list ex-muted">
          {ruleNotes(r).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>

      {notes && (
        <section className="ex-section xi-md" aria-labelledby="xi-notes">
          <h2 id="xi-notes">About this paper</h2>
          <ExamMarkdown source={notes} />
        </section>
      )}

      {showAuthor && (
        <details className="xi-author">
          <summary>Paper details (author view)</summary>
          <div className="ex-surface ex-stack" style={{ gap: 8, fontSize: 14 }}>
            <p>
              <span className="ex-muted">Exam ID</span> {r.meta.id} ·{" "}
              <span className="ex-muted">version</span> {r.meta.version} ·{" "}
              <span className="ex-muted">profile</span> {uiProfile(r).id}
            </p>
            <p className="ex-muted">
              Ruleset and paper validated. Solutions stay sealed until submission; their report
              appears if grading fails.
            </p>
            {issues.length ? (
              <ul className="xi-list">
                {issues.map((issue, i) => (
                  <li key={i}>
                    <Chip tone={issue.severity === "error" ? "danger" : "warning"}>
                      {issue.severity}
                    </Chip>{" "}
                    {issue.location}: {issue.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No validation issues.</p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

export function InstructionsScreen({
  record,
  ack,
  busy,
  dev,
  exitLabel,
  onAck,
  onStart,
  onExit,
}: {
  record: ExamRecord;
  ack: boolean;
  busy: boolean;
  dev: boolean;
  exitLabel: string;
  onAck: (v: boolean) => void;
  /** `scale` is the share of the official time this attempt gets. */
  onStart: (scale: number) => void;
  onExit: () => void;
}) {
  const r = record.exam.rules,
    paper = record.exam.paper,
    scaled = sampleScale(r, paper),
    [fullscreenStep, setFullscreenStep] = useState(false),
    [timing, setTiming] = useState<"scaled" | "full">("scaled");
  const scale = scaled < 1 && timing === "scaled" ? scaled : 1;
  const begin = () => {
    if (r.integrity.requireFullscreen && !document.fullscreenElement) setFullscreenStep(true);
    else onStart(scale);
  };
  return (
    <div className="xi">
      <div className="xi-top">
        <Button variant="ghost" onClick={onExit}>
          <ArrowLeft size={16} aria-hidden="true" /> {exitLabel}
        </Button>
      </div>
      <main className="xi-content">
        <header className="ex-stack" style={{ gap: 8 }}>
          <h1>{r.meta.name}</h1>
          {isShortSample(r, paper) && (
            <p className="ex-muted">
              Sample paper · {paper.length} of {patternQuestionCount(r)} questions
            </p>
          )}
        </header>
        {scaled < 1 && (
          <section className="ex-section" aria-labelledby="xi-time">
            <h2 id="xi-time">Time</h2>
            <p className="ex-small">
              This sample has {paper.length} of the real {patternQuestionCount(r)} questions. Scaled
              time keeps the real pace per question.
            </p>
            <div>
              <Segmented
                label="Time for this attempt"
                value={timing}
                onChange={setTiming}
                options={[
                  {
                    value: "scaled",
                    label: `Scaled · ${formatDuration(r.timing.durationMinutes * 60 * scaled)}`,
                  },
                  {
                    value: "full",
                    label: `Full · ${formatDuration(r.timing.durationMinutes * 60)}`,
                  },
                ]}
              />
            </div>
          </section>
        )}
        <ExamAssets source={record}>
          <InstructionsSummary record={record} dev={dev} scale={scale} />
        </ExamAssets>
      </main>
      <div className="xi-bar">
        <div className="xi-bar-inner">
          <label className="xi-ack">
            <input
              className="ex-check"
              type="checkbox"
              checked={ack}
              onChange={(e) => onAck(e.target.checked)}
            />
            I have read and acknowledge the exam rules.
          </label>
          <div className="xi-bar-action">
            <Button
              variant="primary"
              disabled={!ack || busy}
              onClick={begin}
              aria-describedby="xi-reason"
            >
              Start exam
            </Button>
            <span id="xi-reason" className="xi-reason">
              {!ack ? "Tick the box to start." : busy ? "Starting…" : ""}
            </span>
          </div>
        </div>
      </div>
      <Dialog
        open={fullscreenStep}
        onOpenChange={setFullscreenStep}
        title="Enter fullscreen to start"
        description="This exam runs in fullscreen. Leaving fullscreen or switching tabs counts as a warning."
        footer={
          <>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button
              variant="primary"
              onClick={() => {
                setFullscreenStep(false);
                onStart(scale);
              }}
            >
              <Maximize size={16} aria-hidden="true" /> Enter fullscreen & start
            </Button>
          </>
        }
      />
    </div>
  );
}
