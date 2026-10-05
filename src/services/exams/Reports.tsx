import { useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import type { AttemptAnalysis } from "./diagnostics";
import { weaknessProfile } from "./diagnostics";
import type { AttemptRecord } from "./storage";
import type { Solution } from "./parser";
import { questionState, type SelfTag, canReleaseScore, canReleaseSolutions } from "./session";
import { flattenTopics, type Taxonomy } from "./schema";
import { ExamMarkdown } from "./ExamMarkdown";
import type { DayProgress } from "./study-plan";
const fixed = (n: number) => Number(n.toFixed(2));
function TopicTable({ analysis, taxonomy }: { analysis: AttemptAnalysis; taxonomy: Taxonomy }) {
  const topics = flattenTopics(taxonomy.topics);
  return (
    <div className="exam-table-scroll">
      <table>
        <thead>
          <tr>
            <th>Topic</th>
            <th>Attempted</th>
            <th>Accuracy</th>
            <th>Time ratio</th>
            <th>Marks lost</th>
            <th>Dominant cause</th>
          </tr>
        </thead>
        <tbody>
          {analysis.topics.map((t) => (
            <tr key={t.topic}>
              <td>{topics.find((v) => v.id === t.topic)?.name ?? t.topic}</td>
              <td>
                {t.attempted}/{t.total}
              </td>
              <td>{fixed(t.accuracy)}%</td>
              <td>{fixed(t.avgTimeRatio)}×</td>
              <td>{fixed(t.marksLost)}</td>
              <td>{t.dominantCause?.replaceAll("_", " ") ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function WeaknessReport({
  analysis,
  taxonomy,
}: {
  analysis: AttemptAnalysis;
  taxonomy: Taxonomy;
}) {
  return (
    <div className="exam-stack">
      <h2>Weakness Report</h2>
      <p className="exam-muted">
        Evidence-based flags describe patterns, not a definitive diagnosis. Self-reports remain
        separate from the engine’s attribution.
      </p>
      <section className="exam-card">
        <h3>Marks lost by cause</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={Object.entries(analysis.marksLostByCause).map(([cause, marks]) => ({
              cause: cause.replaceAll("_", " "),
              marks: fixed(marks),
            }))}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="cause" tick={{ fontSize: 11 }} />
            <YAxis />
            <Tooltip />
            <Bar isAnimationActive={false} dataKey="marks" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
        <p>Total marks lost: {fixed(analysis.marksLost)}</p>
      </section>
      <section className="exam-card">
        <h3>Topic performance</h3>
        <TopicTable analysis={analysis} taxonomy={taxonomy} />
      </section>
      <section className="exam-card">
        <h3>Pacing curve</h3>
        <p className="exam-muted">Cumulative focused seconds in the session’s question order.</p>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={analysis.pacing}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="question" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line isAnimationActive={false} dataKey="actual" stroke="#3b82f6" dot={false} />
            <Line
              isAnimationActive={false}
              dataKey="expected"
              stroke="#a855f7"
              strokeDasharray="5 5"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </section>
      <section className="exam-card">
        <h3>Top weaknesses</h3>
        {analysis.weaknesses.length ? (
          analysis.weaknesses.map((w) => (
            <div className="exam-row" key={w.key}>
              <strong>
                {w.topic} · {(w.trap ?? w.cause).replaceAll("_", " ")}{" "}
                {w.selfReported ? "(self-reported)" : ""}
              </strong>
              <p>
                {w.questionIds.length} questions · {fixed(w.marksLost)} marks lost · impact{" "}
                {fixed(w.impact)}
              </p>
            </div>
          ))
        ) : (
          <p>Not enough repeated evidence yet.</p>
        )}
        <h3>Action items</h3>
        <ol>
          {analysis.actionItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>
      <section className="exam-card">
        <h3>Flagged questions and exam patterns</h3>
        {analysis.flags.map((f, i) => (
          <div className="exam-row" key={`${f.ruleId}-${i}`}>
            <strong>{f.label}</strong> <span className="exam-tag">{f.ruleId}</span>
            <p>
              {f.scope === "question" ? f.questionIds.join(", ") : f.scope + " pattern"} · severity{" "}
              {f.severity}
            </p>
            <p>{f.advice}</p>
          </div>
        ))}
      </section>
      <section className="exam-card">
        <h3>Trap evidence</h3>
        {analysis.traps.map((t) => (
          <p key={`${t.trap}-${t.selfReported}`}>
            {t.trap}: {t.count} ({t.questionIds.join(", ")}){" "}
            {t.selfReported ? "— self-reported" : ""}
          </p>
        ))}
      </section>
    </div>
  );
}
export function ResultScreen({
  attempt,
  onReview,
  studyDay,
  onStudyPlan,
}: {
  attempt: AttemptRecord;
  onReview: () => void;
  studyDay?: DayProgress;
  onStudyPlan?: () => void;
}) {
  const [tab, setTab] = useState("score"),
    a = attempt.analysis!,
    r = attempt.exam.exam.rules;
  const scoreReleased = canReleaseScore(r),
    solutionsReleased = canReleaseSolutions(r);
  return (
    <div className="exam-stack">
      <h1>Exam result</h1>
      {studyDay && (
        <section className={studyDay.status === "passed" ? "study-success" : "study-result-failed"}>
          <div>
            <strong>
              {studyDay.status === "passed"
                ? "Day passed. Your next step is unlocked."
                : studyDay.status === "revision_required"
                  ? "Day failed. Revision and a new paper are required."
                  : "Day failed. Review your mistakes and try again."}
            </strong>
            <p>
              Passing score: {studyDay.passPercentage}%.{" "}
              {studyDay.status !== "passed" &&
                `${studyDay.attemptsRemaining} attempts remain on this paper.`}
            </p>
          </div>
          <button onClick={onStudyPlan}>Continue study plan</button>
        </section>
      )}
      {attempt.session.demo && (
        <p className="exam-notice">
          Demonstration attempt · excluded from your dashboard and attempt limit.
        </p>
      )}
      <p>
        {r.meta.name} · {new Date(a.at).toLocaleString()}
      </p>
      <div className="exam-tabs" role="tablist" aria-label="Result views">
        <button role="tab" aria-selected={tab === "score"} onClick={() => setTab("score")}>
          Score
        </button>
        {r.diagnostics.enabled && scoreReleased && solutionsReleased && (
          <button role="tab" aria-selected={tab === "weakness"} onClick={() => setTab("weakness")}>
            Weakness Report
          </button>
        )}
      </div>
      {tab === "weakness" && scoreReleased && solutionsReleased ? (
        <WeaknessReport analysis={a} taxonomy={attempt.exam.exam.taxonomy} />
      ) : (
        <>
          <section className="exam-card">
            <p className="exam-score">
              {scoreReleased
                ? `${a.score.toFixed(r.results.rounding)} / ${a.totalMarks}`
                : "Score withheld"}
            </p>
            {scoreReleased && <p>{fixed(a.accuracy)}% accuracy among attempted questions</p>}
            <p>
              {a.violations} integrity violations ·{" "}
              {attempt.session.events
                .find((e) => e.type === "submitted")
                ?.reason?.replaceAll("_", " ")}
            </p>
          </section>
          {scoreReleased && r.results.showSectionBreakdown && (
            <section className="exam-card">
              <h2>Section breakdown</h2>
              {a.sections.map((s) => (
                <p key={s.id}>
                  {r.sections.find((v) => v.id === s.id)?.name}:{" "}
                  {s.score.toFixed(r.results.rounding)} / {s.totalMarks}
                </p>
              ))}
            </section>
          )}
          {r.results.showTimePerQuestion && (
            <section className="exam-card">
              <h2>Time per question</h2>
              <div className="exam-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Question</th>
                      <th>Focused seconds</th>
                      <th>Visits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.questions.map((q) => (
                      <tr key={q.id}>
                        <td>{q.id}</td>
                        <td>{fixed(Number(q.signals.spentSec))}</td>
                        <td>{q.signals.visits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
      {r.diagnostics.capture.eventLog && (
        <details className="exam-card">
          <summary>Session event log</summary>
          <div className="exam-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Question / section</th>
                </tr>
              </thead>
              <tbody>
                {attempt.session.events.map((event, index) => (
                  <tr key={index}>
                    <td>{new Date(event.at).toLocaleTimeString()}</td>
                    <td>{event.type}</td>
                    <td>{event.questionId ?? event.section ?? event.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {solutionsReleased ? (
        <button className="exam-primary" onClick={onReview}>
          Review answers &amp; solutions
        </button>
      ) : (
        <p>
          Solutions{" "}
          {r.results.solutionsRelease === "never"
            ? "are withheld by this exam."
            : `release at ${new Date(r.results.releaseAt!).toLocaleString()}.`}
        </p>
      )}
    </div>
  );
}
export function ReviewScreen({
  attempt,
  solutions,
  onJournal,
  onBack,
}: {
  attempt: AttemptRecord;
  solutions: Solution[];
  onJournal: (id: string, tag: SelfTag) => void;
  onBack: () => void;
}) {
  const { exam, session, analysis } = attempt,
    tax = exam.exam.taxonomy;
  if (!canReleaseSolutions(exam.exam.rules)) return <p>Solutions have not been released.</p>;
  return (
    <div className="exam-stack">
      <div className="exam-actions">
        <h1>Answer review</h1>
        <button onClick={onBack}>Back to result</button>
      </div>
      {exam.exam.paper.map((q) => {
        const solution = solutions.find((s) => s.id === q.id)!,
          state = questionState(session, q.id),
          a = analysis!.questions.find((a) => a.id === q.id)!,
          tag = session.journal[q.id] ?? { note: "" },
          wrong = a.signals.outcome !== "correct";
        const selected = solution.distractors.filter((d) =>
          d.option
            ? Array.isArray(state.response)
              ? state.response.includes(d.option)
              : state.response === d.option
            : state.response !== null && Number(state.response) === d.value,
        );
        return (
          <section className="exam-card" key={q.id}>
            <h2>
              {q.id} · {String(a.signals.outcome)}
            </h2>
            <ExamMarkdown source={q.body} />
            {q.options.map((o, i) => (
              <div className="exam-option-review" key={i}>
                <strong>{String.fromCharCode(65 + i)}.</strong>
                <ExamMarkdown source={o} />
              </div>
            ))}
            <p>
              Your answer:{" "}
              <strong>
                {Array.isArray(state.response)
                  ? state.response.join(", ")
                  : state.response || "Unanswered"}
              </strong>{" "}
              · Correct: <strong>{solution.answer}</strong>
              {solution.tolerance !== undefined ? ` ± ${solution.tolerance}` : ""}
            </p>
            <ExamMarkdown source={solution.body} />
            {selected.map((d, i) => (
              <p className="exam-notice" key={i}>
                Trap: {tax.traps.find((t) => t.id === d.trap)?.name} — {d.note}
              </p>
            ))}
            {a.flags.map((f, i) => (
              <p key={i}>
                <span className="exam-tag">{f.label}</span> {f.advice}
              </p>
            ))}
            {wrong && exam.exam.rules.diagnostics.capture.selfTagging && (
              <fieldset className="exam-journal">
                <legend>Mistake journal · self-reported</legend>
                <label>
                  Cause
                  <select
                    aria-label={`Cause for ${q.id}`}
                    value={tag.cause ?? ""}
                    onChange={(e) =>
                      onJournal(q.id, { ...tag, cause: e.target.value || undefined })
                    }
                  >
                    <option value="">Choose a cause</option>
                    {tax.causes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Trap
                  <select
                    aria-label={`Trap for ${q.id}`}
                    value={tag.trap ?? ""}
                    onChange={(e) => onJournal(q.id, { ...tag, trap: e.target.value || undefined })}
                  >
                    <option value="">Choose a trap</option>
                    {tax.traps.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Note
                  <textarea
                    aria-label={`Note for ${q.id}`}
                    value={tag.note}
                    onChange={(e) => onJournal(q.id, { ...tag, note: e.target.value })}
                    maxLength={5000}
                  />
                </label>
              </fieldset>
            )}
          </section>
        );
      })}
    </div>
  );
}
export function WeaknessDashboard({ attempts }: { attempts: AttemptRecord[] }) {
  const available = attempts.filter(
    (a) =>
      a.analysis &&
      canReleaseScore(a.exam.exam.rules) &&
      canReleaseSolutions(a.exam.exam.rules) &&
      a.exam.exam.rules.diagnostics.enabled,
  );
  const ids = [...new Set(available.map((a) => a.analysis!.taxonomyId))],
    [selected, setSelected] = useState(""),
    [lastN, setLastN] = useState(10),
    id = selected || ids[0] || "";
  const source = available.find((a) => a.analysis!.taxonomyId === id),
    min = source?.exam.exam.rules.diagnostics.report.persistentWeaknessMinAttempts ?? 2,
    profile = weaknessProfile(
      available.map((a) => a.analysis!),
      id,
      min,
      lastN,
    );
  return (
    <div className="exam-stack">
      <h1>Weakness Dashboard</h1>
      <div className="exam-actions">
        <label>
          Taxonomy
          <select value={id} onChange={(e) => setSelected(e.target.value)}>
            {ids.map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
        <label>
          Recent attempts
          <select value={lastN} onChange={(e) => setLastN(Number(e.target.value))}>
            {[5, 10, 20].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      <p>
        {profile.attemptCount} completed attempts · persistent means evidence across at least {min}{" "}
        attempts. Demo attempts are excluded.
      </p>
      {!profile.attemptCount && (
        <div className="exam-card">Complete an exam to start building your weakness profile.</div>
      )}
      <section className="exam-card">
        <h2>Persistent weaknesses</h2>
        {profile.weaknesses.map((w) => (
          <p key={`${w.topic}-${w.cause}-${w.selfReported}`}>
            <strong>
              {w.topic} · {w.cause.replaceAll("_", " ")}
            </strong>{" "}
            — {w.attempts} attempts {w.persistent && <span className="exam-tag">Persistent</span>}{" "}
            {w.selfReported ? "(self-reported)" : ""}
          </p>
        ))}
      </section>
      {profile.trends.map((t) => (
        <section key={t.topic} className="exam-card">
          <h2>{t.topic}: accuracy trend</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={t.points.map((p, i) => ({ ...p, label: `${i + 1} · ${p.examId}` }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Line isAnimationActive={false} dataKey="accuracy" stroke="#3b82f6" />
            </LineChart>
          </ResponsiveContainer>
        </section>
      ))}
      <section className="exam-card">
        <h2>Traps by frequency</h2>
        {profile.traps.map((t) => (
          <p key={`${t.trap}-${t.selfReported}`}>
            {t.trap}: {t.count} {t.selfReported ? "(self-reported)" : ""}
          </p>
        ))}
      </section>
    </div>
  );
}
