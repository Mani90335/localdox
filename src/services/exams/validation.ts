import { resolvedRules } from "./default-rules.ts";
import {
  aggregateSignals,
  questionSignals,
  flattenTopics,
  defaultTaxonomy,
  rulesetSchema,
  taxonomySchema,
  parseJson,
  type Condition,
  type Ruleset,
  type Taxonomy,
  type Issue,
  ExamImportError,
} from "./schema.ts";
import {
  parsePaper,
  parseSolutions,
  numeric,
  natMatches,
  optionLabel,
  type Question,
  type Solution,
} from "./parser.ts";
export interface Exam {
  rules: Ruleset;
  taxonomy: Taxonomy;
  paper: Question[];
  issues: Issue[];
}
export function validateCondition(
  condition: Condition,
  scope: string,
  location: string,
  issues: Issue[],
  depth = 0,
) {
  const error = (message: string) => issues.push({ severity: "error", location, message });
  if (depth > 20) {
    error("Condition exceeds 20 levels");
    return;
  }
  if ("all" in condition || "any" in condition) {
    ("all" in condition ? condition.all : condition.any).forEach((c) =>
      validateCondition(c, scope, location, issues, depth + 1),
    );
    return;
  }
  if ("not" in condition) {
    validateCondition(condition.not, scope, location, issues, depth + 1);
    return;
  }
  const vocabulary: Record<string, string> =
    scope === "question" ? questionSignals : aggregateSignals;
  const type = Object.hasOwn(vocabulary, condition.signal)
    ? vocabulary[condition.signal]
    : undefined;
  if (!type) {
    error(`Unknown ${scope} signal: ${condition.signal}`);
    return;
  }
  const arrayOp = ["in", "not_in"].includes(condition.op);
  if (arrayOp !== Array.isArray(condition.value))
    error("in/not_in require arrays; other operators require scalar values");
  const values = Array.isArray(condition.value) ? condition.value : [condition.value];
  if (values.some((v) => typeof v !== type))
    error(`Signal ${condition.signal} requires ${type} values`);
  if (["<", "<=", ">", ">="].includes(condition.op) && type !== "number")
    error("Ordering operators require a numeric signal");
}
export function validateExam(rules: Ruleset, taxonomy: Taxonomy, paper: Question[]): Issue[] {
  const issues: Issue[] = [];
  const add = (location: string, message: string, severity: "error" | "warning" = "error") =>
    issues.push({ location, message, severity });
  const unique = (ids: string[], location: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) add(location, `Duplicate id: ${id}`);
      seen.add(id);
    }
  };
  unique(
    rules.sections.map((s) => s.id),
    "sections",
  );
  unique(
    paper.map((q) => q.id),
    "paper",
  );
  unique(
    rules.diagnostics.rules.map((r) => r.id),
    "diagnostics.rules",
  );
  const topics = flattenTopics(taxonomy.topics).map((t) => t.id),
    causes = taxonomy.causes.map((c) => c.id),
    traps = taxonomy.traps.map((t) => t.id);
  unique(topics, "taxonomy.topics");
  unique(causes, "taxonomy.causes");
  unique(traps, "taxonomy.traps");
  unique(taxonomy.difficulty, "taxonomy.difficulty");
  taxonomy.traps.forEach((t) => {
    if (!causes.includes(t.cause)) add(`taxonomy.traps.${t.id}`, `Unknown cause ${t.cause}`);
  });
  if (rules.diagnostics.enabled) {
    if (!causes.includes("concept_gap"))
      add("taxonomy.causes", "concept_gap is required for fallback attribution");
    rules.diagnostics.causePriority.forEach((c) => {
      if (!causes.includes(c)) add("diagnostics.causePriority", `Unknown cause ${c}`);
    });
  }
  const effective = resolvedRules(rules);
  for (const rule of rules.diagnostics.rules) {
    validateCondition(rule.when, rule.scope, `diagnostics.rules.${rule.id}.when`, issues);
    function references(condition: Condition) {
      if ("all" in condition || "any" in condition) {
        ("all" in condition ? condition.all : condition.any).forEach(references);
        return;
      }
      if ("not" in condition) {
        references(condition.not);
        return;
      }
      const allowed =
        condition.signal === "topic"
          ? topics
          : condition.signal === "selectedTrap"
            ? traps
            : condition.signal === "difficulty"
              ? taxonomy.difficulty
              : condition.signal === "section"
                ? rules.sections.map((s) => s.id)
                : undefined;
      if (allowed)
        for (const value of Array.isArray(condition.value) ? condition.value : [condition.value]) {
          if (value !== "none" && !allowed.includes(String(value)))
            add(`diagnostics.rules.${rule.id}.when`, `Unknown ${condition.signal}: ${value}`);
        }
    }
    references(rule.when);
    if (rule.cause && !causes.includes(rule.cause))
      add(`diagnostics.rules.${rule.id}`, `Unknown cause ${rule.cause}`);
  }
  if (rules.diagnostics.enabled)
    for (const rule of effective) {
      if (rule.cause && rule.cause !== "$trap" && !causes.includes(rule.cause))
        add(
          `diagnostics.rules.${rule.id}`,
          `Enabled rule uses unknown cause ${rule.cause}; override or disable it`,
        );
    }
  const knownRuleIds = new Set([
    ...effective.map((r) => r.id),
    ...resolvedRules({ ...rules, diagnostics: { ...rules.diagnostics, disabledRules: [] } }).map(
      (r) => r.id,
    ),
  ]);
  for (const id of rules.diagnostics.disabledRules)
    if (!knownRuleIds.has(id)) add("diagnostics.disabledRules", `Unknown rule ${id}`);
  if (rules.diagnostics.taxonomy && rules.diagnostics.taxonomyRef)
    add("diagnostics", "Use taxonomy or taxonomyRef, not both");
  if (
    (rules.results.solutionsRelease === "at_time" ||
      rules.results.scoreVisibility === "after_release") &&
    !rules.results.releaseAt
  )
    add("results.releaseAt", "A release timestamp is required");
  if (rules.timing.mode === "per_section") {
    if (rules.sections.some((s) => !s.durationMinutes))
      add("sections", "Per-section timing requires durationMinutes on every section");
    else if (
      Math.abs(
        rules.sections.reduce((n, s) => n + s.durationMinutes!, 0) - rules.timing.durationMinutes,
      ) > 1e-6
    )
      add("timing.durationMinutes", "Must equal the sum of section durations");
  }
  for (const s of rules.sections) {
    const qs = paper.filter((q) => q.section === s.id),
      severity = rules.sampleMode ? "warning" : "error";
    if (qs.length !== s.questionCount)
      add(
        `sections.${s.id}`,
        `Expected ${s.questionCount} questions, found ${qs.length}`,
        severity,
      );
    for (const c of s.composition ?? [])
      if (qs.filter((q) => q.marks === c.marks).length !== c.count)
        add(
          `sections.${s.id}.composition`,
          `Expected ${c.count} questions worth ${c.marks} marks`,
          severity,
        );
    if (s.composition && qs.some((q) => !s.composition!.some((c) => c.marks === q.marks)))
      add(`sections.${s.id}.composition`, "Unexpected mark value", severity);
    if (s.composition && s.composition.reduce((n, c) => n + c.count, 0) !== s.questionCount)
      add(`sections.${s.id}.composition`, "Composition counts must equal questionCount");
    if (!qs.length) add(`sections.${s.id}`, "Each section needs at least one question");
  }
  for (const q of paper) {
    if (!rules.sections.some((s) => s.id === q.section))
      add(q.location, `Unknown section ${q.section}`);
    const config = rules.questionTypes[q.type];
    if (!config) add(q.location, `Question type ${q.type} is not allowed`);
    if (
      q.type !== "nat" &&
      (q.options.length < 2 ||
        q.options.length > 26 ||
        ("optionCount" in (config ?? {}) &&
          (config as { optionCount?: number }).optionCount !== undefined &&
          q.options.length !== (config as { optionCount: number }).optionCount))
    )
      add(q.location, "Wrong option count");
    if (q.topic && !topics.includes(q.topic)) add(q.location, `Unknown topic ${q.topic}`);
    if (q.difficulty && !taxonomy.difficulty.includes(q.difficulty))
      add(q.location, `Unknown difficulty ${q.difficulty}`);
    if (!q.topic || !q.difficulty)
      add(q.location, "Missing topic or difficulty; excluded from topic analytics", "warning");
  }
  return issues;
}
export function importExam(
  rulesSource: string,
  paperSource: string,
  taxonomySource?: string,
): Exam {
  const rules = parseJson(rulesSource, rulesetSchema, "exam.json");
  if (rules.diagnostics.taxonomyRef && !taxonomySource)
    throw new ExamImportError([
      {
        severity: "error",
        location: "diagnostics.taxonomyRef",
        message: "Referenced taxonomy file is missing",
      },
    ]);
  const taxonomy = taxonomySource
    ? parseJson(taxonomySource, taxonomySchema, "taxonomy.json")
    : (rules.diagnostics.taxonomy ?? defaultTaxonomy);
  const paper = parsePaper(paperSource),
    issues = validateExam(rules, taxonomy, paper);
  if (issues.some((i) => i.severity === "error")) throw new ExamImportError(issues);
  return { rules, taxonomy, paper, issues };
}
export function validateSolutions(exam: Exam, solutions: Solution[]): Issue[] {
  const issues: Issue[] = [];
  const add = (location: string, message: string, severity: "error" | "warning" = "error") =>
    issues.push({ location, message, severity });
  const seen = new Set<string>();
  for (const s of solutions) {
    if (seen.has(s.id)) add(s.location, `Duplicate solution ${s.id}`);
    seen.add(s.id);
    const q = exam.paper.find((q) => q.id === s.id);
    if (!q) {
      add(s.location, `No question for solution ${s.id}`);
      continue;
    }
    const labels = q.options.map((_, i) => optionLabel(i)),
      answers = s.answer.split(",").map((a) => a.trim());
    if (q.type === "nat") {
      const range = s.answer.split(":");
      if (
        range.length > 2 ||
        range.some((a) => !numeric(a)) ||
        (range.length === 2 && Number(range[0]) > Number(range[1])) ||
        (range.length === 2 && s.tolerance !== undefined)
      )
        add(s.location, "Invalid NAT answer or tolerance with range");
    } else if (
      answers.some((a) => !labels.includes(a)) ||
      new Set(answers).size !== answers.length ||
      (q.type === "mcq" && answers.length !== 1) ||
      s.tolerance !== undefined
    )
      add(s.location, "Invalid option answer or tolerance");
    for (const d of s.distractors) {
      if (!exam.taxonomy.traps.some((t) => t.id === d.trap))
        add(s.location, `Unknown trap ${d.trap}`);
      if (q.type === "nat") {
        if (d.value === undefined || d.option !== undefined)
          add(s.location, "NAT distractor requires value");
        else if (natMatches(d.value, s)) add(s.location, "Distractor points at a correct answer");
      } else if (!d.option || !labels.includes(d.option))
        add(s.location, "Distractor option does not exist");
      else if (answers.includes(d.option)) add(s.location, "Distractor points at a correct option");
    }
    if (q.type === "mcq" && !s.distractors.length)
      add(s.location, "MCQ solution has no distractors", "warning");
  }
  for (const q of exam.paper)
    if (!seen.has(q.id)) add("solutions.md", `Missing solution for ${q.id}`);
  return issues;
}
export function importSolutions(
  exam: Exam,
  source: string,
): { solutions: Solution[]; issues: Issue[] } {
  const solutions = parseSolutions(source),
    issues = validateSolutions(exam, solutions);
  if (issues.some((i) => i.severity === "error")) throw new ExamImportError(issues);
  return { solutions, issues };
}
