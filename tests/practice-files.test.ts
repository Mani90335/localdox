import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fileLabel,
  getDocumentKind,
  isEditableKind,
  isTextKind,
} from "../src/lib/markdown/document-utils.ts";
import { parseExamFile } from "../src/services/exams/parser.ts";
import { checkPractice, readPracticeFile } from "../src/services/exams/practice.ts";
import { ExamImportError } from "../src/services/exams/schema.ts";
import { XP_TEMPLATE } from "../src/services/exams/templates.ts";

const issuesOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ExamImportError, String(error));
    return error.issues.map((i) => `${i.location}: ${i.message}`);
  }
  assert.fail("expected an import error");
};

const SHEET = `:::question{#loose type=nat}
Before any heading.
:::

# Events

:::question{#even type=mcq}
Which is even?

- 3
- 4
:::

:::question{#primes type=msq marks=2 difficulty=easy}
Primes?

- 2
- 4
- 5
:::

## Ranges

:::question{#third type=nat}
7/3?
:::

---

:::solution{#even answer=B}
Four.

::distractor{option=A trap=sign}
:::

:::solution{#primes answer="A,C"}
2 and 5.
:::

:::solution{#third answer=2.32:2.34}
Seven thirds.
:::

:::solution{#loose answer=1 tolerance=0.5}
One.
:::
`;

test(".xp is its own kind: text the reader previews and edits", () => {
  assert.equal(getDocumentKind("probability.xp"), "practice");
  assert.equal(getDocumentKind("PROB.XP"), "practice");
  assert.ok(isTextKind("practice"));
  assert.ok(isEditableKind("practice"));
  assert.equal(fileLabel("practice"), "Practice questions");
});

test("headings group questions; solutions anywhere are matched; no rules or marks needed", () => {
  const sheet = readPracticeFile(SHEET, "p.xp");
  assert.deepEqual(
    sheet.groups.map((g) => [g.title, g.questions.map((q) => q.id)]),
    [
      [null, ["loose"]],
      ["Events", ["even", "primes"]],
      ["Ranges", ["third"]],
    ],
  );
  assert.deepEqual(
    sheet.questions.map((q) => [q.id, q.marks, q.section]),
    [
      ["loose", 1, "practice"],
      ["even", 1, "practice"],
      ["primes", 2, "practice"],
      ["third", 1, "practice"],
    ],
  );
  assert.equal(sheet.solutionFor.third.body, "Seven thirds.");
  assert.deepEqual(sheet.solutionFor.even.distractors, [], "trap analytics are dropped");
});

test("each answer is checked against its key at once", () => {
  const sheet = readPracticeFile(SHEET, "p.xp");
  const check = (id: string, response: string | string[]) => {
    const q = sheet.questions.find((x) => x.id === id)!;
    return checkPractice(q, sheet.solutionFor[id], response);
  };
  assert.equal(check("even", "B"), "correct");
  assert.equal(check("even", "A"), "wrong");
  assert.equal(check("primes", ["A", "C"]), "correct");
  assert.equal(check("primes", ["A", "B"]), "wrong");
  assert.equal(check("third", "2.33"), "correct");
  assert.equal(check("third", "2.4"), "wrong");
  assert.equal(check("loose", "1.4"), "correct", "tolerance widens a number");
  assert.equal(check("loose", "1.6"), "wrong");
});

test("problems are named with the file and line, before anyone answers", () => {
  assert.deepEqual(
    issuesOf(() => readPracticeFile("# Only a heading\n", "p.xp")),
    ["p.xp: No questions yet. Add a :::question block and its :::solution."],
  );
  assert.deepEqual(
    issuesOf(() => readPracticeFile(":::question{#q type=mcq}\nQ?\n\n- a\n- b\n:::\n", "p.xp")),
    ["p.xp: Missing solution for q"],
  );
  assert.deepEqual(
    issuesOf(() =>
      readPracticeFile(
        ":::question{#q type=mcq}\nQ?\n\n- only one\n:::\n\n:::solution{#q answer=A}\n:::\n",
        "p.xp",
      ),
    ),
    ["p.xp:1: q needs 2 to 26 options, listed with - at the end of the question"],
  );
  assert.ok(
    issuesOf(() =>
      readPracticeFile(
        ":::question{#q type=mcq}\nQ?\n\n- a\n- b\n:::\n\n:::solution{#q answer=C}\n:::\n",
        "p.xp",
      ),
    ).some((i) => i.includes("Invalid option answer")),
  );
  assert.deepEqual(
    issuesOf(() => readPracticeFile("Loose text\n", "p.xp")),
    ["p.xp:1: Expected a heading or a :::question or :::solution block (put text inside it)"],
  );
});

test("the starter and the bundled example read cleanly", async () => {
  const starter = readPracticeFile(XP_TEMPLATE, "practice.xp");
  assert.equal(starter.questions.length, 3);
  assert.deepEqual(
    starter.groups.map((g) => g.title),
    ["Warm-up"],
  );
  const { readFile } = await import("node:fs/promises");
  const example = await readFile(new URL("../plans/example.xp", import.meta.url), "utf8");
  assert.equal(readPracticeFile(example, "example.xp").questions.length, 3);
});

test("practice and exams stay apart: a paper refuses a practice part", () => {
  assert.match(
    issuesOf(() => parseExamFile(`# Practice\n\n${XP_TEMPLATE.replace("# Warm-up\n", "")}`))[0],
    /Practice questions go in their own \.xp file/,
  );
});
