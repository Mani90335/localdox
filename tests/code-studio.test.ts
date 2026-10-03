import test from "node:test";
import assert from "node:assert/strict";
import { transform } from "@babel/standalone";
import { instrument } from "../src/services/code-studio/instrument.ts";
import { runJavaScript } from "../src/services/code-studio/javascript-runtime.ts";
import { traceSchema } from "../src/services/code-studio/protocol.ts";
import { changesBetween, explain } from "../src/services/code-studio/operations.ts";
import { LESSONS, lessonTrace } from "../src/services/code-studio/lessons.ts";
import { importPythonTutor } from "../src/services/code-studio/python-tutor.ts";
import { TEACHING } from "../src/services/code-studio/teaching.ts";
import { presentTrace } from "../src/services/code-studio/presentation.ts";

test("beginner C++ projection removes startup machinery and keeps stable picture addresses", () => {
  const recording = traceSchema.parse({
    version: 1,
    language: "cpp",
    origin: "execution",
    source: "int main() {}",
    notes: [],
    steps: [
      {
        line: 1,
        event: "before",
        frames: [
          {
            id: "0xFFFF",
            name: "_GLOBAL__sub_I_main",
            locals: { "std::__ioinit": { special: "Not yet initialized at this source position" } },
          },
        ],
        heap: {},
        stdout: "",
      },
      {
        line: 2,
        event: "before",
        frames: [
          {
            id: "0xFFFF",
            name: "main",
            locals: {
              "std::__ioinit": 0,
              answer: { special: "Not yet initialized at this source position" },
              _mine: 21,
              first: { ref: "0xABCDEF" },
              alias: { ref: "0xABCDEF" },
            },
          },
        ],
        heap: {
          "0xABCDEF": { type: "Node", entries: [["next", { ref: "0xABCDEF" }]] },
          runtime: { type: "internal", entries: [] },
        },
        stdout: "",
      },
      {
        line: 3,
        event: "end",
        frames: [
          {
            id: "0xFFFF",
            name: "main",
            locals: { answer: 42, first: { ref: "0xABCDEF" }, second: { ref: "0xABC000" } },
          },
        ],
        heap: {
          "0xABC000": { type: "Array", entries: [["0", 7]] },
          "0xABCDEF": { type: "Node", entries: [["next", null]] },
        },
        stdout: "42\n",
      },
    ],
  });
  const original = JSON.stringify(recording);
  const shown = presentTrace(recording);
  assert.equal(shown.steps.length, 2);
  assert.deepEqual(shown.steps[0].frames[0].locals, {
    _mine: 21,
    first: { ref: "0x1" },
    alias: { ref: "0x1" },
  });
  assert.deepEqual(shown.steps[0].heap["0x1"].entries, [["next", { ref: "0x1" }]]);
  assert.deepEqual(shown.steps[1].frames[0].locals.second, { ref: "0x2" });
  assert.equal(shown.steps[1].frames[0].locals.answer, 42);
  assert.equal(shown.steps[1].stdout, "42\n");
  assert.equal(Object.keys(shown.steps[0].heap).length, 1);
  assert.equal(JSON.stringify(recording), original, "export retains the original trace");
  assert.doesNotMatch(
    JSON.stringify(shown),
    /0xABCDEF|0xFFFF|std::__ioinit|_GLOBAL__|Not yet initialized/,
  );
});

test("authored focus targets follow remapped object identities", () => {
  const trace = presentTrace(
    lessonTrace(
      LESSONS.find((l) => l.id === "arrays")!,
      "javascript",
    ),
  );
  for (const step of trace.steps)
    for (const focus of step.lesson?.focus ?? [])
      assert.ok(step.heap[focus.slice(0, focus.lastIndexOf(":"))]);
});

function run(source: string, stdin = "") {
  return traceSchema.parse(
    runJavaScript({ source, stdin, compiled: instrument(transform, source) }),
  );
}
test("the introductory teaching highlights match the example in all three languages", () => {
  const lesson = LESSONS[0];
  for (const language of ["javascript", "python", "cpp"] as const) {
    const lines = lesson.code[language].split("\n");
    const mapping = TEACHING[lesson.id].lines![language];
    assert.match(lines[mapping[1] - 1], /number = 21/);
    assert.match(lines[mapping[2] - 1], /answer = number \* 2/);
    assert.match(lines[mapping[3] - 1], /console.log\(answer\)|print\(answer\)|cout << answer/);
  }
});

test("recorded change explanations use the program's names rather than internal frame paths", () => {
  const result = run("const values = [4]; values[0] = 9;");
  const messages = result.steps.map((step, i) => explain(result.steps[i - 1], step).explanation);
  assert.ok(messages.some((message) => message.includes("values[0] changed from 4 to 9")));
  assert.ok(messages.every((message) => !message.includes("Global.values")));
});

test("executes edited code rather than a matched algorithm template", () => {
  const result = run(
    "const x = 13; let result = 0; for (let i = 0; i < x; i++) result += i; console.log(result);",
  );
  assert.equal(result.steps.at(-1)?.stdout, "78\n");
  assert.equal(result.steps.at(-1)?.event, "end");
  assert.equal(result.steps.at(-1)?.frames[0].locals.result, 78);
});
test("preserves aliases, cycles, and historical snapshots", () => {
  const result = run("const a = [1, 2]; const b = a; a.push(a); b[0] = 9;");
  const final = result.steps.at(-1)!;
  assert.deepEqual(final.frames[0].locals.a, final.frames[0].locals.b);
  const id = (final.frames[0].locals.a as { ref: string }).ref;
  assert.deepEqual(final.heap[id].entries, [
    ["0", 9],
    ["1", 2],
    ["2", { ref: id }],
  ]);
  assert.ok(result.steps.some((s) => s.heap[id]?.entries[0][1] === 1));
});
test("captures recursion and respects return values", () => {
  const result = run(
    "function f(n) { if (n < 2) return 1; return n * f(n - 1); } const answer = f(5); console.log(answer);",
  );
  assert.equal(result.steps.at(-1)?.stdout, "120\n");
  assert.ok(result.steps.some((s) => s.frames.length === 6));
  assert.equal(result.steps.at(-1)?.frames.length, 1);
});
test("closures, arrow expressions, destructuring, methods and shadowing remain executable", () => {
  const result = run(
    "const a = 10; const twice = x => x * 2; function outer(a) { return () => twice(a); } const fn = outer(7); const obj = { n: 3, get() { return this.n; } }; const [b, c] = [fn(), obj.get()]; console.log(a, b, c);",
  );
  assert.equal(result.steps.at(-1)?.stdout, "10 14 3\n");
});
test("does not invoke getters while inspecting ordinary objects", () => {
  const result = run(
    "let calls = 0; const x = { get value() { calls++; return 4; } }; console.log(calls);",
  );
  assert.equal(result.steps.at(-1)?.stdout, "0\n");
});
test("reports runtime and syntax errors, and bounds an empty infinite loop", () => {
  assert.equal(run("throw new Error('broken');").steps.at(-1)?.event, "error");
  assert.throws(() => instrument(transform, "const = ;"));
  const result = run("while (true) {}");
  assert.equal(result.steps.at(-1)?.event, "limit");
  assert.ok(result.steps.length <= 2002);
});
test("captures map/set mutations and standard input", () => {
  const result = run(
    'const map = new Map([["a", 1]]); map.set("b", 2); const set = new Set([1,1,2]); console.log(prompt());',
    "hello",
  );
  assert.equal(result.steps.at(-1)?.stdout, "hello\n");
  assert.ok(
    Object.values(result.steps.at(-1)!.heap).some(
      (o) => o.type === "Map" && o.entries.length === 4,
    ),
  );
  assert.ok(
    Object.values(result.steps.at(-1)!.heap).some(
      (o) => o.type === "Set" && o.entries.length === 2,
    ),
  );
});
test("guided animation is distinctly labeled and lacks false language line numbers", () => {
  for (const lesson of LESSONS)
    for (const language of ["javascript", "python", "cpp"] as const) {
      const trace = traceSchema.parse(lessonTrace(lesson, language));
      assert.equal(trace.origin, "lesson");
      assert.ok(trace.steps.every((s) => s.line === 0));
    }
});
test("all JavaScript course examples execute successfully", () => {
  for (const lesson of LESSONS) {
    const result = run(lesson.code.javascript);
    assert.equal(
      result.steps.at(-1)?.event,
      "end",
      `${lesson.id}: ${result.steps.at(-1)?.message}`,
    );
  }
});
test("diff recognizes a swap without inventing CPU measurements", () => {
  const result = run("const a = [8, 3]; [a[0], a[1]] = [a[1], a[0]];");
  assert.ok(result.steps.some((s, i) => explain(result.steps[i - 1], s).operation === "swap"));
  assert.deepEqual(changesBetween(undefined, result.steps[0]), []);
});
test("rejects unsupported asynchronous syntax before execution", () => {
  assert.throws(() => instrument(transform, "async function f() {}"), /Async/);
  assert.throws(() => instrument(transform, "function* f() { yield 1; }"), /generators/);
});

test("imports real Python Tutor reference and frame encodings", () => {
  const result = importPythonTutor(
    {
      code: "a = []",
      trace: [
        {
          line: 1,
          event: "step_line",
          globals: { a: ["REF", 1], b: ["REF", 1] },
          heap: { "1": ["LIST", ["REF", 1], 3] },
          stack_to_render: [{ frame_id: 4, func_name: "visit", encoded_locals: { n: 3 } }],
          stdout: "",
        },
      ],
    },
    "python",
  );
  assert.deepEqual(result.steps[0].frames[0].locals.a, result.steps[0].frames[0].locals.b);
  assert.deepEqual(result.steps[0].heap["1"].entries, [
    ["0", { ref: "1" }],
    ["1", 3],
  ]);
  assert.equal(result.steps[0].frames[1].name, "visit");
  assert.throws(() => importPythonTutor({ code: "bad", trace: [{ line: -1 }] }, "python"));
});

test("records arrow-function parameters and returned values", () => {
  const result = run("const twice = x => x * 2; const result = twice(9);");
  assert.ok(result.steps.some((s) => s.event === "call" && s.frames.at(-1)?.locals.x === 9));
  assert.ok(
    result.steps.some(
      (s) => s.event === "return" && s.frames.at(-1)?.locals["Return value"] === 18,
    ),
  );
});

test("map keys retain their object identity", () => {
  const result = run("const key = {}; const map = new Map([[key, 3]]);");
  const final = result.steps.at(-1)!;
  const map = Object.values(final.heap).find((o) => o.type === "Map")!;
  assert.deepEqual(map.entries[0][1], final.frames[0].locals.key);
});

test("output formatting does not execute getters or toJSON", () => {
  const result = run(
    'let calls = 0; const obj = { get value() { calls++; return 1; }, toJSON() { calls++; return "changed"; } }; console.log(obj); console.log(calls, undefined);',
  );
  assert.ok(result.steps.at(-1)?.stdout.endsWith("0 undefined\n"));
});
