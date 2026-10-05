import { readFileSync, writeFileSync } from "node:fs";
import { importExam, importSolutions } from "../src/services/exams/validation.ts";
import {
  createSession,
  showInstructions,
  startSession,
  navigate,
  setAnswer,
  submitSession,
  beginReflection,
  finishReflection,
} from "../src/services/exams/session.ts";
import { analyzeAttempt } from "../src/services/exams/diagnostics.ts";
import { defaultRules } from "../src/services/exams/default-rules.ts";
const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const e = importExam(
  read("exams/gate-2027-da/gate2027da.exam.json"),
  read("exams/gate-2027-da/gate2027da.paper.md"),
  read("exams/taxonomies/gate-da.taxonomy.json"),
);
let s = startSession(
    showInstructions(createSession(e.rules, e.paper, e.taxonomy.id, 1800000000000)),
    e.rules,
    true,
    true,
    1800000000000,
  ),
  now = s.startedAt!;
const responses: Record<string, string | string[]> = {
  "ga-1": "A",
  "ga-2": "B",
  "da-1": "6",
  "da-2": "A",
  "da-5": "A",
  "da-6": "A",
  "da-7": "A",
  "da-8": "A",
  "da-9": "A",
  "da-10": ["A", "B"],
};
for (const q of e.paper) {
  if (s.currentId !== q.id) s = navigate(s, e.rules, e.paper, q.id, now);
  const seconds = q.id === "ga-1" ? 100 : q.id === "da-3" ? 130 : 10;
  if (q.id === "da-2") s = setAnswer(s, e.rules, q, "C", now + 1000);
  now += seconds * 1000;
  if (responses[q.id]) s = setAnswer(s, e.rules, q, responses[q.id], now);
}
s = finishReflection(beginReflection(submitSession(s, now + 1000), e.rules));
s.id = "seeded-diagnostics-demo";
s.demo = true;
s.confidence = {
  "ga-1": "guess",
  "ga-2": "unsure",
  "da-1": "sure",
  "da-2": "sure",
  "da-5": "guess",
  "da-6": "guess",
  "da-7": "guess",
  "da-8": "guess",
  "da-9": "guess",
};
const solutions = importSolutions(e, read("exams/gate-2027-da/gate2027da.solutions.md")).solutions,
  analysis = analyzeAttempt(e.rules, e.taxonomy, e.paper, solutions, s);
const missing = defaultRules.filter((rule) => !analysis.rules.some((r) => r.id === rule.id));
if (missing.length) throw new Error("Demo missing rules: " + missing.map((r) => r.id).join(", "));
writeFileSync(
  new URL("../exams/gate-2027-da/demo-session.json", import.meta.url),
  JSON.stringify(s, null, 2) + "\n",
);
console.log(`Wrote demo with all ${analysis.rules.length} default rules.`);
