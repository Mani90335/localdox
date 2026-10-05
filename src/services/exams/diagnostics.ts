import type { Condition, Literal, Rule, Ruleset, Taxonomy } from "./schema.ts";
import type { Question, Solution } from "./parser.ts";
import { type Session, type SelfTag, focusedSeconds, questionState } from "./session.ts";
import { scoreQuestion, isAnswered } from "./scoring.ts";
import { resolvedRules } from "./default-rules.ts";
export type Signals = Record<string, Literal>;
export function evaluate(condition: Condition, signals: Signals): boolean {
  if ("all" in condition) return condition.all.every((c) => evaluate(c, signals));
  if ("any" in condition) return condition.any.some((c) => evaluate(c, signals));
  if ("not" in condition) return !evaluate(condition.not, signals);
  const left = signals[condition.signal],
    right = condition.value;
  switch (condition.op) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case "in":
      return Array.isArray(right) && right.includes(left);
    case "not_in":
      return Array.isArray(right) && !right.includes(left);
    case "<":
      return typeof left === "number" && typeof right === "number" && left < right;
    case "<=":
      return typeof left === "number" && typeof right === "number" && left <= right;
    case ">":
      return typeof left === "number" && typeof right === "number" && left > right;
    case ">=":
      return typeof left === "number" && typeof right === "number" && left >= right;
  }
}
export interface Flag {
  ruleId: string;
  label: string;
  cause: string | null;
  severity: number;
  advice: string;
  scope: string;
  questionIds: string[];
}
export interface QuestionAnalysis {
  id: string;
  signals: Signals;
  score: number;
  primaryCause: string | null;
  flags: Flag[];
  traps: string[];
  selfReport?: SelfTag;
}
export interface TopicAnalysis {
  topic: string;
  attempted: number;
  total: number;
  accuracy: number;
  avgTimeRatio: number;
  marksLost: number;
  dominantCause: string | null;
}
export interface Weakness {
  key: string;
  topic: string;
  cause: string;
  trap?: string;
  marksLost: number;
  minutesOverBudget: number;
  impact: number;
  questionIds: string[];
  severity: number;
  advice: string;
  selfReported: boolean;
}
export interface AttemptAnalysis {
  sessionId: string;
  examId: string;
  taxonomyId: string;
  at: number;
  score: number;
  totalMarks: number;
  marksLost: number;
  accuracy: number;
  questions: QuestionAnalysis[];
  marksLostByCause: Record<string, number>;
  topics: TopicAnalysis[];
  traps: { trap: string; count: number; questionIds: string[]; selfReported: boolean }[];
  rules: { id: string; count: number; questionIds: string[] }[];
  pacing: { question: string; actual: number; expected: number }[];
  weaknesses: Weakness[];
  actionItems: string[];
  flags: Flag[];
  sections: { id: string; score: number; totalMarks: number; signals: Signals }[];
  signals: Signals;
  violations: number;
  demo: boolean;
}
const n = (s: Signals, key: string) => Number(s[key] ?? 0);
const average = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
function accuracy(qs: QuestionAnalysis[]) {
  const attempted = qs.filter((q) => q.signals.outcome !== "unanswered");
  return attempted.length
    ? (100 * attempted.filter((q) => q.signals.outcome === "correct").length) / attempted.length
    : 0;
}
export function aggregateSignalsFor(qs: QuestionAnalysis[], s: Session): Signals {
  // Thirds follow final answer timestamps; unattempted questions are excluded.
  const order = qs
    .filter((q) => q.signals.outcome !== "unanswered")
    .sort((a, b) => {
      const at = (id: string) =>
        s.events.filter((e) => e.questionId === id && e.type === "answer_set").at(-1)?.at ?? 0;
      return at(a.id) - at(b.id);
    });
  const third = Math.ceil(order.length / 3),
    first = accuracy(order.slice(0, third)),
    last = accuracy(order.slice(-third));
  return {
    accuracy: accuracy(qs),
    attemptRate: qs.length ? (100 * order.length) / qs.length : 0,
    avgTimeRatio: average(qs.map((q) => n(q.signals, "timeRatio"))),
    unansweredCount: qs.filter((q) => q.signals.outcome === "unanswered").length,
    guessPenaltyMarks: qs
      .filter((q) => q.signals.confidence === "guess")
      .reduce((v, q) => v + n(q.signals, "negativeMarksTaken"), 0),
    accuracyFirstThird: first,
    accuracyLastThird: last,
    accuracyDrop: order.length >= 3 ? first - last : 0,
    timeLeftWhenFinishedSec: Math.max(0, ((s.deadlineAt ?? 0) - (s.submittedAt ?? 0)) / 1000),
  };
}
function advice(template: string, signals: Signals, taxonomy: Taxonomy): string {
  const tokens = {
    ...signals,
    trap:
      taxonomy.traps.find((t) => t.id === signals.selectedTrap)?.name ??
      signals.selectedTrap ??
      "none",
  };
  return template.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => {
    const value = tokens[key as keyof typeof tokens];
    return value === undefined
      ? match
      : typeof value === "number"
        ? String(Math.round(value * 100) / 100)
        : String(value);
  });
}
function flagsFor(rules: Rule[], signals: Signals, taxonomy: Taxonomy, ids: string[]): Flag[] {
  return rules
    .filter((r) => evaluate(r.when, signals))
    .map((r) => ({
      ruleId: r.id,
      label: r.label,
      cause:
        r.cause === "$trap"
          ? (taxonomy.traps.find((t) => t.id === signals.selectedTrap)?.cause ?? null)
          : r.cause,
      severity: r.severity,
      scope: r.scope,
      advice: advice(r.advice, signals, taxonomy),
      questionIds: ids,
    }));
}
export function analyzeAttempt(
  r: Ruleset,
  taxonomy: Taxonomy,
  paper: Question[],
  solutions: Solution[],
  s: Session,
): AttemptAnalysis {
  if (!["reflection", "submitted", "review"].includes(s.phase))
    throw new Error("Diagnostics require a submitted session");
  const rules = r.diagnostics.enabled ? resolvedRules(r) : [],
    spent = focusedSeconds(s),
    totalMarks = paper.reduce((v, q) => v + q.marks, 0);
  const questions: QuestionAnalysis[] = s.order.map((id) => {
    const q = paper.find((q) => q.id === id)!,
      solution = solutions.find((sol) => sol.id === id);
    if (!solution) throw new Error(`Missing solution ${id}`);
    const state = questionState(s, id),
      score = scoreQuestion(r, q, solution, state.response, state.marked);
    const events = s.events.filter((e) => e.questionId === id),
      answers = events.filter((e) => e.type === "answer_set");
    const expected = q.time ?? ((r.timing.durationMinutes * 60) / totalMarks) * q.marks;
    const traps = solution.distractors
      .filter((d) =>
        d.option
          ? Array.isArray(state.response)
            ? state.response.includes(d.option)
            : state.response === d.option
          : isAnswered(state.response) &&
            typeof state.response === "string" &&
            Number(state.response) === d.value,
      )
      .map((d) => d.trap);
    const changed = (from: boolean, to: boolean) =>
      answers.some(
        (e) =>
          isAnswered(e.previous ?? null) &&
          (scoreQuestion(r, q, solution, e.previous ?? null).outcome === "correct") === from &&
          (scoreQuestion(r, q, solution, e.value ?? null).outcome === "correct") === to,
      );
    const last = answers.at(-1);
    const signals: Signals = {
      outcome: score.outcome,
      type: q.type,
      section: q.section,
      marks: q.marks,
      topic: q.topic ?? "none",
      difficulty: q.difficulty ?? "none",
      spentSec: spent[id] ?? 0,
      expectedSec: expected,
      timeRatio: (spent[id] ?? 0) / expected,
      visits: events.filter((e) => e.type === "question_viewed").length,
      answerChanges: answers.filter(
        (e) =>
          isAnswered(e.previous ?? null) && JSON.stringify(e.previous) !== JSON.stringify(e.value),
      ).length,
      changedCorrectToWrong: changed(true, false),
      changedWrongToCorrect: changed(false, true),
      confidence: s.confidence[id] ?? "none",
      markedForReview: state.marked,
      selectedTrap: traps[0] ?? "none",
      marksLost: score.marksLost,
      negativeMarksTaken: score.negativeMarksTaken,
      answeredWithMinutesLeft: last
        ? Math.max(0, ((last.deadlineAt ?? s.deadlineAt ?? last.at) - last.at) / 60000)
        : 0,
    };
    const flags = flagsFor(
      rules.filter((rule) => rule.scope === "question"),
      signals,
      taxonomy,
      [id],
    );
    // Multiple selected distractors can point to different causes; retain each.
    for (const trap of traps.slice(1))
      flags.push(
        ...flagsFor(
          rules.filter((rule) => rule.id === "fell_for_trap"),
          { ...signals, selectedTrap: trap },
          taxonomy,
          [id],
        ),
      );
    const causes = flags.map((f) => f.cause).filter((c): c is string => !!c);
    const primaryCause =
      score.outcome === "correct"
        ? null
        : (r.diagnostics.causePriority.find((c) => causes.includes(c)) ??
          causes[0] ??
          "concept_gap");
    return {
      id,
      signals,
      score: score.score,
      primaryCause,
      flags,
      traps,
      selfReport: s.journal[id],
    };
  });
  const marksLostByCause: Record<string, number> = {};
  for (const q of questions)
    if (q.primaryCause)
      marksLostByCause[q.primaryCause] =
        (marksLostByCause[q.primaryCause] ?? 0) + n(q.signals, "marksLost");
  const topicIds = [...new Set(paper.filter((q) => q.topic && q.difficulty).map((q) => q.topic!))];
  const topics = topicIds.map((topic) => {
    const qs = questions.filter(
      (q) => q.signals.topic === topic && q.signals.difficulty !== "none",
    );
    const causes: Record<string, number> = {};
    qs.forEach((q) => {
      if (q.primaryCause)
        causes[q.primaryCause] = (causes[q.primaryCause] ?? 0) + n(q.signals, "marksLost");
    });
    return {
      topic,
      total: qs.length,
      attempted: qs.filter((q) => q.signals.outcome !== "unanswered").length,
      accuracy: accuracy(qs),
      avgTimeRatio: average(qs.map((q) => n(q.signals, "timeRatio"))),
      marksLost: qs.reduce((v, q) => v + n(q.signals, "marksLost"), 0),
      dominantCause: Object.entries(causes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    };
  });
  const signals = aggregateSignalsFor(questions, s);
  const sections = r.sections.map((section) => {
    const qs = questions.filter((q) => q.signals.section === section.id);
    return {
      id: section.id,
      score: qs.reduce((v, q) => v + q.score, 0),
      totalMarks: qs.reduce((v, q) => v + n(q.signals, "marks"), 0),
      signals: aggregateSignalsFor(qs, s),
    };
  });
  const aggregateFlags = [
    ...flagsFor(
      rules.filter((rule) => rule.scope === "exam"),
      signals,
      taxonomy,
      questions.map((q) => q.id),
    ),
    ...sections.flatMap((section) =>
      flagsFor(
        rules.filter((rule) => rule.scope === "section"),
        section.signals,
        taxonomy,
        questions.filter((q) => q.signals.section === section.id).map((q) => q.id),
      ),
    ),
  ];
  const flags = [...questions.flatMap((q) => q.flags), ...aggregateFlags];
  const ruleCounts = [...new Set(flags.map((f) => f.ruleId))].map((id) => ({
    id,
    count: flags.filter((f) => f.ruleId === id).length,
    questionIds: [...new Set(flags.filter((f) => f.ruleId === id).flatMap((f) => f.questionIds))],
  }));
  const traps = taxonomy.traps.flatMap((t) =>
    [false, true].flatMap((selfReported) => {
      const qs = questions.filter((q) =>
        selfReported ? q.selfReport?.trap === t.id : q.traps.includes(t.id),
      );
      return qs.length
        ? [{ trap: t.id, count: qs.length, questionIds: qs.map((q) => q.id), selfReported }]
        : [];
    }),
  );
  const entries = new Map<string, Weakness>();
  function add(
    q: QuestionAnalysis,
    cause: string,
    trap: string | undefined,
    selfReported: boolean,
  ) {
    const topic = String(q.signals.topic),
      key = `${topic}|${trap ? `trap:${trap}` : cause}|${selfReported ? "self" : "engine"}`;
    const relevant = q.flags.filter((f) => f.cause === cause),
      severity = Math.max(1, ...relevant.map((f) => f.severity));
    const entry = entries.get(key) ?? {
      key,
      topic,
      cause,
      trap,
      marksLost: 0,
      minutesOverBudget: 0,
      impact: 0,
      questionIds: [],
      severity,
      advice:
        relevant[0]?.advice ?? `${topic}: revisit the method, then retry without the answer key.`,
      selfReported,
    };
    if (entry.questionIds.includes(q.id)) return;
    entry.questionIds.push(q.id);
    entry.marksLost += n(q.signals, "marksLost");
    entry.minutesOverBudget +=
      Math.max(0, n(q.signals, "spentSec") - n(q.signals, "expectedSec")) / 60;
    entry.severity = Math.max(entry.severity, severity);
    entry.impact =
      r.diagnostics.impact.marksLostWeight * entry.marksLost +
      r.diagnostics.impact.timeWastedPerMinuteWeight * entry.minutesOverBudget;
    entries.set(key, entry);
  }
  for (const q of questions) {
    if (q.signals.topic !== "none" && q.signals.difficulty !== "none") {
      if (q.primaryCause) add(q, q.primaryCause, undefined, false);
      for (const cause of new Set(q.flags.flatMap((f) => (f.cause ? [f.cause] : []))))
        add(q, cause, undefined, false);
      if (q.selfReport?.cause) add(q, q.selfReport.cause, undefined, true);
    }
    for (const trap of q.traps)
      add(q, taxonomy.traps.find((t) => t.id === trap)!.cause, trap, false);
    if (q.selfReport?.trap) {
      const trap = taxonomy.traps.find((t) => t.id === q.selfReport!.trap);
      if (trap) add(q, trap.cause, trap.id, true);
    }
  }
  const weaknesses = r.diagnostics.enabled
    ? [...entries.values()]
        .filter(
          (w) =>
            w.questionIds.length >= r.diagnostics.report.minEvidenceQuestions || w.severity === 3,
        )
        .sort((a, b) => b.impact - a.impact || a.key.localeCompare(b.key))
    : [];
  let actual = 0,
    expected = 0;
  const pacing = questions.map((q) => ({
    question: q.id,
    actual: (actual += n(q.signals, "spentSec")),
    expected: (expected += n(q.signals, "expectedSec")),
  }));
  return {
    sessionId: s.id,
    examId: r.meta.id,
    taxonomyId: taxonomy.id,
    at: s.submittedAt!,
    score: questions.reduce((v, q) => v + q.score, 0),
    totalMarks,
    marksLost: questions.reduce((v, q) => v + n(q.signals, "marksLost"), 0),
    accuracy: accuracy(questions),
    questions,
    marksLostByCause,
    topics,
    traps,
    rules: ruleCounts,
    pacing,
    weaknesses,
    actionItems: [
      ...new Set([...weaknesses.map((w) => w.advice), ...aggregateFlags.map((f) => f.advice)]),
    ].slice(0, r.diagnostics.report.topWeaknessCount),
    flags,
    sections,
    signals,
    violations: s.violations,
    demo: !!s.demo,
  };
}
export function weaknessProfile(
  attempts: AttemptAnalysis[],
  taxonomyId: string,
  minAttempts = 2,
  lastN = 10,
) {
  const relevant = attempts
    .filter((a) => a.taxonomyId === taxonomyId && !a.demo)
    .sort((a, b) => a.at - b.at);
  const trends = [...new Set(relevant.flatMap((a) => a.topics.map((t) => t.topic)))].map(
    (topic) => ({
      topic,
      points: relevant.slice(-lastN).flatMap((a) => {
        const t = a.topics.find((t) => t.topic === topic);
        return t
          ? [
              {
                attempt: a.sessionId,
                examId: a.examId,
                at: a.at,
                accuracy: t.accuracy,
                marksLost: t.marksLost,
              },
            ]
          : [];
      }),
    }),
  );
  const groups = new Map<
    string,
    { topic: string; cause: string; attempts: Set<string>; selfReported: boolean }
  >();
  for (const a of relevant)
    for (const q of a.questions) {
      if (q.signals.topic === "none" || q.signals.difficulty === "none") continue;
      for (const [cause, selfReported] of [
        [q.primaryCause, false],
        [q.selfReport?.cause, true],
      ] as const) {
        if (!cause) continue;
        const key = `${q.signals.topic}|${cause}|${selfReported}`;
        const g = groups.get(key) ?? {
          topic: String(q.signals.topic),
          cause,
          attempts: new Set<string>(),
          selfReported,
        };
        g.attempts.add(a.sessionId);
        groups.set(key, g);
      }
    }
  const traps = new Map<string, { trap: string; count: number; selfReported: boolean }>();
  for (const a of relevant)
    for (const t of a.traps) {
      const key = `${t.trap}|${t.selfReported}`,
        v = traps.get(key) ?? { trap: t.trap, count: 0, selfReported: t.selfReported };
      v.count += t.count;
      traps.set(key, v);
    }
  return {
    attemptCount: relevant.length,
    trends,
    traps: [...traps.values()].sort((a, b) => b.count - a.count),
    weaknesses: [...groups.values()]
      .map((g) => ({ ...g, attempts: g.attempts.size, persistent: g.attempts.size >= minAttempts }))
      .sort((a, b) => b.attempts - a.attempts),
  };
}
