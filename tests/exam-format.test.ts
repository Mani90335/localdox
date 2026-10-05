import { test } from "node:test";
import assert from "node:assert/strict";
import { importExam, importSolutions } from "../src/services/exams/validation.ts";
export const rules = {
  schemaVersion: 2,
  meta: { id: "test", name: "Test", version: "1" },
  timing: { mode: "global", durationMinutes: 10 },
  sections: [{ id: "a", name: "A", questionCount: 1 }],
  questionTypes: { mcq: { optionCount: 2 } },
  diagnostics: {
    taxonomy: {
      id: "test",
      difficulty: ["easy", "hard"],
      topics: [{ id: "math", name: "Math" }],
      traps: [{ id: "sign", name: "Sign", cause: "careless" }],
      causes: ["concept_gap", "trap", "careless", "time_pressure", "overconfidence", "guess"].map(
        (id) => ({ id, name: id }),
      ),
    },
  },
};
export const paper =
  ":::question{#q1 section=a type=mcq marks=2 topic=math difficulty=easy}\nWhat is $x_1 + \\alpha$?\n\n```mermaid\ngraph LR\nA-->B\n```\n\n- One\n- Two\n:::";
export const key =
  ":::solution{#q1 answer=A}\nExplanation.\n\n::distractor{option=B trap=sign}\n:::";
export const exam = () => importExam(JSON.stringify(rules), paper);
test("parses directives without damaging math and mermaid; validates keys", () => {
  const e = exam();
  assert.match(e.paper[0].body, /x_1/);
  assert.match(e.paper[0].body, /```mermaid/);
  assert.equal(e.paper[0].options.length, 2);
  assert.equal(importSolutions(e, key).solutions[0].distractors[0].trap, "sign");
});
test("schema rejects unknown fields and malformed condition trees", () => {
  assert.throws(() => importExam(JSON.stringify({ ...rules, typo: true }), paper), /Unrecognized/);
  assert.throws(() =>
    importExam(
      JSON.stringify({
        ...rules,
        diagnostics: {
          rules: [
            {
              id: "bad",
              scope: "question",
              label: "bad",
              cause: "guess",
              severity: 1,
              advice: "",
              when: { all: [] },
            },
          ],
        },
      }),
      paper,
    ),
  );
});
test("paper errors: counts, composition, duplicate ids, types, options and taxonomy", () => {
  for (const source of [
    paper + "\n\n" + paper,
    paper.replace("section=a", "section=b"),
    paper.replace("type=mcq", "type=msq"),
    paper.replace("- Two", ""),
    paper.replace("topic=math", "topic=typo"),
    paper.replace("difficulty=easy", "difficulty=typo"),
  ])
    assert.throws(() => importExam(JSON.stringify(rules), source));
  assert.throws(
    () =>
      importExam(
        JSON.stringify({ ...rules, sections: [{ id: "a", name: "A", questionCount: 2 }] }),
        paper,
      ),
    /Expected 2/,
  );
  assert.throws(
    () =>
      importExam(
        JSON.stringify({
          ...rules,
          sections: [
            { id: "a", name: "A", questionCount: 1, composition: [{ marks: 1, count: 1 }] },
          ],
        }),
        paper,
      ),
    /marks/,
  );
});
test("sample counts and missing metadata are warnings", () => {
  const r = { ...rules, sampleMode: true, sections: [{ id: "a", name: "A", questionCount: 2 }] };
  const e = importExam(JSON.stringify(r), paper.replace(" topic=math difficulty=easy", ""));
  assert.equal(e.issues.length, 2);
  assert.ok(e.issues.every((i) => i.severity === "warning"));
});
test("solution validation rejects mismatches, bad keys and trap mappings", () => {
  for (const source of [
    key.replace("#q1", "#q2"),
    key.replace("answer=A", "answer=Z"),
    key.replace("option=B", "option=A"),
    key.replace("option=B", "option=Z"),
    key.replace("trap=sign", "trap=typo"),
    key + "\n\n" + key,
  ])
    assert.throws(() => importSolutions(exam(), source));
  assert.equal(
    importSolutions(exam(), key.replace("::distractor{option=B trap=sign}", "")).issues[0].severity,
    "warning",
  );
});
test("NAT value distractors and tolerance", () => {
  const e = importExam(
    JSON.stringify({ ...rules, questionTypes: { nat: {} } }),
    paper.replace("type=mcq", "type=nat"),
  );
  const s = ':::solution{#q1 answer="2.4" tolerance=0.01}\n::distractor{value=2.1 trap=sign}\n:::';
  assert.equal(importSolutions(e, s).solutions[0].distractors[0].value, 2.1);
  assert.throws(() => importSolutions(e, s.replace("value=2.1", "value=2.4")));
});
test("rules reject unknown signals, invalid operators, causes, and collisions", () => {
  const rule = {
    id: "custom",
    scope: "question",
    label: "Custom",
    cause: "guess",
    severity: 1,
    advice: "",
    when: { signal: "marks", op: ">=", value: 1 },
  };
  for (const list of [
    [{ ...rule, when: { signal: "typo", op: "==", value: 1 } }],
    [{ ...rule, when: { signal: "topic", op: ">=", value: "a" } }],
    [{ ...rule, cause: "typo" }],
    [rule, rule],
  ])
    assert.throws(() =>
      importExam(
        JSON.stringify({ ...rules, diagnostics: { ...rules.diagnostics, rules: list } }),
        paper,
      ),
    );
});
