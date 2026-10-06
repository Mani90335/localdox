import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETUP, readExamFile } from "../src/services/exams/exam-setup.ts";
import { rulesFileFor, syncPaperPlan } from "../src/services/exams/paper-plan.ts";
import { parseExamFile } from "../src/services/exams/parser.ts";
import {
  blankHeader,
  isRulesFile,
  paperHeader,
  rulesTag,
  rulesetTitle,
  withRulesTag,
} from "../src/services/exams/rules-tag.ts";
import { ExamImportError } from "../src/services/exams/schema.ts";
import { XAM_TEMPLATE, xruleTemplate } from "../src/services/exams/templates.ts";

const issuesOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof ExamImportError) return error.issues;
    throw error;
  }
  assert.fail("expected an import error");
};

test("a paper names its ruleset in a header, which can be added, read and changed", () => {
  const tagged = withRulesTag(XAM_TEMPLATE, "GATE mock.xrule");
  assert.ok(tagged.startsWith("---\nrules: GATE mock.xrule\n---\n\n:::question"));
  assert.equal(rulesTag(tagged), "GATE mock.xrule");
  // Retagging replaces the line rather than stacking headers.
  const retagged = withRulesTag(tagged, "easy.xrule");
  assert.equal(rulesTag(retagged), "easy.xrule");
  assert.equal(retagged.match(/^---$/gm)?.length, 2);
  assert.equal(rulesTag(XAM_TEMPLATE), null);
  // Quotes and spacing are tolerated when typed by hand; a colon in a name survives.
  assert.equal(rulesTag('---\nrules :  "a: b.xrule"\n---\n'), "a: b.xrule");
  assert.equal(rulesTag("---\r\nrules: crlf.xrule\r\n---\r\n# Exam\r\n"), "crlf.xrule");
});

test("only key: value lines make a header, so a paper that opens with a rule line is content", () => {
  assert.equal(paperHeader("---\n# Exam\n---\n"), null);
  assert.equal(paperHeader("# Exam\n---\nrules: x.xrule\n---\n"), null);
  assert.equal(paperHeader("---\nrules: x.xrule\n"), null, "an unclosed header is not one");
});

test("the header is blanked line for line, so parse errors point at the real line", () => {
  const source = "---\nrules: r.xrule\n---\n# Exam\n\nstray text\n";
  assert.equal(blankHeader(source), "\n\n\n# Exam\n\nstray text\n");
  const [issue] = issuesOf(() => parseExamFile(source, "p.xam"));
  assert.equal(issue.location, "p.xam:6");
});

test("a tagged paper parses and runs exactly like the untagged one", () => {
  const tagged = withRulesTag(XAM_TEMPLATE, "r.xrule");
  assert.deepEqual(
    parseExamFile(tagged, "p.xam").questions.map((q) => q.body),
    parseExamFile(XAM_TEMPLATE, "p.xam").questions.map((q) => q.body),
  );
  const setup = { ...DEFAULT_SETUP, name: "T" };
  assert.equal(readExamFile(setup, "x", tagged, "p.xam").exam.exam.paper.length, 3);
});

test("a mistyped header field or a non-.xrule value is refused, not ignored", () => {
  const typo = issuesOf(() =>
    parseExamFile(withRulesTag(XAM_TEMPLATE, "r.xrule").replace("rules:", "rule:"), "p.xam"),
  );
  assert.match(typo[0].message, /Unknown header field "rule"/);
  assert.equal(typo[0].location, "p.xam:2");
  const wrong = issuesOf(() => parseExamFile(withRulesTag(XAM_TEMPLATE, "r.json"), "p.xam"));
  assert.match(wrong[0].message, /must name an \.xrule file/);
});

const file = (id: string, name: string, extra: object = {}) => ({
  id,
  name,
  folderId: null as string | null,
  ...extra,
});

test("the named ruleset wins over folder placement, and a missing one is never swapped for another", () => {
  const own = file("own", "mock.xrule"),
    chosen = file("chosen", "gate.xrule", { folderId: "elsewhere" }),
    folders = [{ id: "elsewhere", parentId: null }];
  const paper = file("p", "mock.xam", { content: withRulesTag(XAM_TEMPLATE, "gate.xrule") });
  assert.deepEqual(rulesFileFor(paper, [paper, own, chosen], folders), {
    kind: "found",
    file: chosen,
  });
  // Binned (or renamed away): say which, rather than fall back to mock.xrule.
  const binned = { ...chosen, deletedAt: 1 };
  assert.deepEqual(rulesFileFor(paper, [paper, own, binned], folders), {
    kind: "missing",
    tagged: "gate.xrule",
  });
  // A paper that names none keeps the folder lookup it always had.
  const untagged = file("u", "mock.xam", { content: XAM_TEMPLATE });
  assert.deepEqual(rulesFileFor(untagged, [untagged, own], folders), { kind: "found", file: own });
});

test("retagging a paper before any attempt rebuilds it under the new rules", async () => {
  const fast = xruleTemplate("Fast").replace('"durationMinutes": 30', '"durationMinutes": 5');
  const source = (paper: string, rules: string, name: string) => ({
    fileId: "p",
    paper: { name: "p.xam", text: paper },
    rules: { name, text: rules },
  });
  const first = await syncPaperPlan(
    undefined,
    source(withRulesTag(XAM_TEMPLATE, "slow.xrule"), xruleTemplate("Slow"), "slow.xrule"),
    [],
    1,
  );
  const second = await syncPaperPlan(
    first.plan,
    source(withRulesTag(XAM_TEMPLATE, "fast.xrule"), fast, "fast.xrule"),
    [],
    2,
  );
  assert.equal(second.kind, "built");
  assert.equal(second.plan.setup?.durationMinutes, 5);
});

test("rulesets are recognised by kind or extension, and titled by their own name", () => {
  assert.ok(isRulesFile({ name: "a.XRULE" }));
  assert.ok(isRulesFile({ name: "renamed", kind: "exam-rules" }));
  assert.ok(!isRulesFile({ name: "a.xam", kind: "exam" }));
  assert.equal(rulesetTitle({ name: "g.xrule", content: xruleTemplate("GATE mock") }), "GATE mock");
  assert.equal(rulesetTitle({ name: "g.xrule", content: "{ broken" }), "g");
});
