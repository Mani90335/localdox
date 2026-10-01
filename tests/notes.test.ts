// Notes: the clean copy of a selection, the snapshot model, following a note
// back to its source, and the note's journey through storage.
//
// The DOM half of the clean copy is exercised against a small hand-built DOM
// (selection-markdown reads nodes through a structural interface for exactly
// this reason); the real-browser path is covered by tests/e2e/notes.spec.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

import {
  selectionToMarkdown,
  type DomNodeLike,
  type SelectionBounds,
} from "../src/lib/markdown/selection-markdown.ts";
import {
  createNote,
  editNote,
  MAX_NOTE_CHARS,
  resolveNoteSource,
  searchNotes,
  sortNotes,
  type Note,
} from "../src/lib/workspace/notes.ts";
import {
  newWorkspaceRecord,
  parseWorkspaceImport,
  persistence,
  serializeWorkspace,
  ImportValidationError,
  type WorkspaceRecord,
} from "../src/lib/workspace/persistence.ts";
import { mergeWorkspaces } from "../src/lib/workspace/merge.ts";
import {
  applyToDestination,
  planTransfer,
  removeFromSource,
} from "../src/lib/workspace/workspace-transfer.ts";

Object.assign(globalThis, { indexedDB, IDBKeyRange });

// ---- a minimal DOM -----------------------------------------------------------

type FakeNode = DomNodeLike & { childNodes: FakeNode[]; parentNode: FakeNode | null };
type Child = FakeNode | string;

function text(data: string): FakeNode {
  return { nodeType: 3, nodeName: "#text", childNodes: [], parentNode: null, textContent: data };
}

function el(tag: string, attrs: Record<string, string | boolean> = {}, ...children: Child[]) {
  const node: FakeNode = {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    childNodes: [],
    parentNode: null,
    get textContent() {
      return this.childNodes.map((child) => child.textContent ?? "").join("");
    },
    getAttribute: (name) => {
      const value = attrs[name];
      return typeof value === "string" ? value : null;
    },
    checked: typeof attrs.checked === "boolean" ? attrs.checked : undefined,
  };
  for (const child of children) {
    const kid = typeof child === "string" ? text(child) : child;
    kid.parentNode = node;
    node.childNodes.push(kid);
  }
  return node;
}

function ancestors(node: FakeNode): FakeNode[] {
  const chain: FakeNode[] = [];
  for (let n: FakeNode | null = node; n; n = n.parentNode) chain.push(n);
  return chain;
}

/** A selection from (start, startOffset) to (end, endOffset), like a Range. */
function select(
  start: FakeNode,
  startOffset: number,
  end: FakeNode,
  endOffset: number,
): SelectionBounds {
  const up = new Set(ancestors(start));
  const common = ancestors(end).find((n) => up.has(n))!;
  return {
    startContainer: start,
    startOffset,
    endContainer: end,
    endOffset,
    commonAncestorContainer: common,
  };
}

/** Everything inside `root`. */
const all = (root: FakeNode) => select(root, 0, root, root.childNodes.length);

/** The first text node whose data contains `needle`. */
function textNode(root: FakeNode, needle: string): FakeNode {
  for (const child of root.childNodes) {
    if (child.nodeType === 3 && (child.textContent ?? "").includes(needle)) return child;
    if (child.nodeType === 1) {
      try {
        return textNode(child, needle);
      } catch {
        // keep looking
      }
    }
  }
  throw new Error(`no text node with “${needle}”`);
}

/** KaTeX's `htmlAndMathml` shape: visual spans plus MathML with the source. */
const katex = (latex: string, visual: string, display = false) =>
  el(
    display ? "div" : "span",
    { class: display ? "docs-math-block group" : "docs-math-inline" },
    el(
      "span",
      { class: "katex" },
      el(
        "span",
        { class: "katex-mathml" },
        el(
          "math",
          {},
          el(
            "semantics",
            {},
            el("mi", {}, visual),
            el("annotation", { encoding: "application/x-tex" }, latex),
          ),
        ),
      ),
      el("span", { class: "katex-html", "aria-hidden": "true" }, visual),
    ),
    ...(display ? [el("span", { class: "docs-math-number", "aria-hidden": "true" }, "(1)")] : []),
  );

/** The same equation after services/math/sanitize.ts: <semantics> and
 *  <annotation> are unwrapped, leaving the LaTeX as text inside <math>. */
const sanitizedKatex = (latex: string, visual: string) =>
  el(
    "span",
    { class: "docs-math-inline" },
    el(
      "span",
      { class: "katex" },
      el(
        "span",
        { class: "katex-mathml" },
        el("math", {}, el("mrow", {}, el("mi", {}, visual)), latex),
      ),
      el("span", { class: "katex-html", "aria-hidden": "true" }, visual),
    ),
  );

// ---- clean copy ----------------------------------------------------------------

test("clean copy keeps inline formatting, links and LaTeX source", () => {
  const p = el(
    "p",
    {},
    "Energy is ",
    el("strong", {}, "conserved"),
    ", see ",
    el("a", { href: "https://example.com/e" }, "the proof"),
    " and ",
    el("code", {}, "E"),
    ": ",
    katex("E = mc^2", "E=mc2"),
    ". Also ",
    el("em", {}, "notably "),
    "this.",
  );
  const root = el("div", {}, p);
  assert.equal(
    selectionToMarkdown(all(root), root),
    "Energy is **conserved**, see [the proof](https://example.com/e) and `E`: $E = mc^2$. Also *notably* this.",
  );
});

test("LaTeX is recovered from sanitized KaTeX output, where the annotation is bare text", () => {
  const root = el("div", {}, el("p", {}, "So ", sanitizedKatex("E = mc^2", "E=mc2"), " holds."));
  assert.equal(selectionToMarkdown(all(root), root), "So $E = mc^2$ holds.");
});

test("viewer chrome — copy buttons, fold toggles, stars, equation numbers — is dropped", () => {
  const root = el(
    "div",
    {},
    el(
      "h2",
      { id: "setup" },
      el("button", { "aria-label": "Fold section" }, el("svg", {}, "▾")),
      "Setup",
      el("button", {}, "★"),
    ),
    el(
      "div",
      { class: "group relative my-6" },
      el("button", { "aria-label": "Copy code" }, "Copy"),
      el(
        "pre",
        {},
        el(
          "code",
          { class: "hljs language-ts" },
          el("span", { class: "hljs-keyword" }, "const"),
          " a = 1;\n",
        ),
      ),
    ),
    katex("\\int_0^1 x\\,dx", "∫01xdx", true),
    el("div", { "data-viewer-ui": "" }, "Inspect"),
  );
  assert.equal(
    selectionToMarkdown(all(root), root),
    "## Setup\n\n```ts\nconst a = 1;\n```\n\n$$\n\\int_0^1 x\\,dx\n$$",
  );
});

test("lists keep nesting, numbering and task boxes", () => {
  const root = el(
    "div",
    {},
    el(
      "ul",
      {},
      el("li", {}, el("input", { type: "checkbox", checked: true }), " shipped"),
      el("li", {}, el("input", { type: "checkbox", checked: false }), " pending"),
      el(
        "li",
        {},
        "steps",
        el("ol", { start: "3" }, el("li", {}, "third"), el("li", {}, "fourth")),
      ),
    ),
  );
  assert.equal(
    selectionToMarkdown(all(root), root),
    "- [x] shipped\n- [ ] pending\n- steps\n  3. third\n  4. fourth",
  );
});

test("a table selection keeps its header, even when the selection starts below it", () => {
  const table = el(
    "table",
    {},
    el("thead", {}, el("tr", {}, el("th", {}, "Name"), el("th", {}, "Value"))),
    el(
      "tbody",
      {},
      el("tr", {}, el("td", {}, "alpha"), el("td", {}, "1")),
      el("tr", {}, el("td", {}, "beta | gamma"), el("td", {}, "2")),
      el("tr", {}, el("td", {}, "delta"), el("td", {}, "3")),
    ),
  );
  const root = el("div", {}, el("div", { class: "docs-table-wrap" }, table));
  // From inside "beta" to the end of "2": one body row, two cells.
  const bounds = select(textNode(root, "beta"), 0, textNode(root, "2"), 1);
  assert.equal(
    selectionToMarkdown(bounds, root),
    "| Name | Value |\n| --- | --- |\n| beta \\| gamma | 2 |",
  );
  // Inside a single cell, it is just text.
  assert.equal(
    selectionToMarkdown(select(textNode(root, "delta"), 1, textNode(root, "delta"), 4), root),
    "elt",
  );
});

test("partial selections clip text, and any part of code or math brings the structure", () => {
  const code = el("pre", {}, el("code", { class: "language-py" }, "print('hi')\nx = 1\n"));
  const math = katex("a^2 + b^2", "a2+b2");
  const root = el(
    "div",
    {},
    el("p", {}, "The quick brown fox"),
    code,
    el("p", {}, "Inline ", math, " here"),
  );
  assert.equal(
    selectionToMarkdown(select(textNode(root, "quick"), 4, textNode(root, "quick"), 15), root),
    "quick brown",
  );
  // One token inside a code block is still code.
  const token = textNode(code, "print");
  assert.equal(selectionToMarkdown(select(token, 0, token, 5), root), "```py\nprint\n```");
  // Three glyphs from the middle of an equation are the equation.
  const glyphs = math.childNodes[0].childNodes[1].childNodes[0];
  assert.equal(selectionToMarkdown(select(glyphs, 1, glyphs, 3), root), "$a^2 + b^2$");
  // A selection spanning paragraphs, ending inside the equation.
  assert.equal(
    selectionToMarkdown(select(textNode(root, "fox"), 16, glyphs, 2), root),
    "fox\n\n```py\nprint('hi')\nx = 1\n```\n\nInline $a^2 + b^2$",
  );
});

test("element boundary points select whole children, as a Range does", () => {
  const list = el("ul", {}, el("li", {}, "one"), el("li", {}, "two"), el("li", {}, "three"));
  const root = el("div", {}, list);
  assert.equal(selectionToMarkdown(select(list, 1, list, 3), root), "- two\n- three");
});

test("callouts, quotes, images and fences that contain backticks", () => {
  const root = el(
    "div",
    {},
    el(
      "aside",
      { class: "docs-callout", "data-tone": "info" },
      el("span", { class: "docs-callout-mark", "aria-hidden": "true" }, el("svg", {})),
      el(
        "div",
        { class: "docs-callout-body" },
        el("p", { class: "docs-callout-label" }, "Note"),
        el("p", {}, "Check the units."),
      ),
    ),
    el("blockquote", {}, el("p", {}, "Quoted"), el("p", {}, "twice")),
    el(
      "p",
      {},
      el("img", { src: "https://example.com/a.png", alt: "Chart" }),
      " ",
      el("img", { src: "blob:local/123", alt: "Local scan" }),
    ),
    el("pre", {}, el("code", {}, "```md\nfenced\n```")),
    el("p", {}, el("code", {}, "a `tick`")),
  );
  assert.equal(
    selectionToMarkdown(all(root), root),
    [
      "> [!NOTE]\n> Check the units.",
      "> Quoted\n>\n> twice",
      "![Chart](https://example.com/a.png) Local scan",
      "````\n```md\nfenced\n```\n````",
      "`` a `tick` ``",
    ].join("\n\n"),
  );
});

test("an equation that failed or is still typesetting copies its source", () => {
  const root = el(
    "div",
    {},
    el(
      "div",
      { class: "docs-math-error" },
      el("span", { class: "docs-math-error-badge" }, "LaTeX error"),
      el("pre", { class: "docs-math-source" }, "\\frac{1}{"),
    ),
    el("p", {}, "Pending ", el("code", { class: "docs-math-pending" }, "x_1"), "."),
  );
  assert.equal(selectionToMarkdown(all(root), root), "$$\n\\frac{1}{\n$$\n\nPending $x_1$.");
});

test("a selection of nothing convertible is empty, so the caller can fall back", () => {
  const root = el("div", {}, el("div", { class: "docs-mermaid" }, el("svg", {}, "A --> B")));
  assert.equal(selectionToMarkdown(all(root), root), "");
});

// ---- the snapshot model ----------------------------------------------------------

const DOC = [
  "Intro paragraph before any heading.",
  "",
  "# Getting started",
  "",
  "Install the command line tool with your package manager first.",
  "",
  "## Configure",
  "",
  "Set the output directory before the first build runs.",
  "",
  "# Reference",
  "",
  "Every flag is documented on this page in alphabetical order.",
].join("\n");

const file = (content = DOC, extra: Partial<{ deletedAt: number | null }> = {}) => ({
  id: "doc",
  name: "guide.md",
  content,
  ...extra,
});

function noteFor(quote: string, source: Partial<Note["source"]> = {}): Note {
  return createNote({ content: quote, source: { quote, ...source } }, file(), 1_000);
}

test("a note is a snapshot: its content only changes through an explicit edit", () => {
  const note = createNote(
    { content: "**Install** the tool", source: { quote: "Install the tool" } },
    { id: "doc", name: "guide.md" },
    1_000,
  );
  assert.equal(note.fileId, "doc");
  assert.equal(note.fileName, "guide.md");
  assert.equal(note.createdAt, 1_000);
  assert.equal(note.updatedAt, 1_000);

  // Editing the source document is not an operation on notes at all; the
  // only way content changes is `editNote`, which stamps the time.
  const edited = editNote(note, "Install it", 2_000);
  assert.equal(edited.content, "Install it");
  assert.equal(edited.updatedAt, 2_000);
  assert.equal(edited.createdAt, 1_000);
  assert.equal(note.content, "**Install** the tool", "the original object is untouched");
  assert.equal(editNote(edited, "Install it", 3_000), edited, "a no-op edit keeps the timestamp");

  const huge = createNote(
    { content: "x".repeat(MAX_NOTE_CHARS + 10), source: { quote: "x" } },
    {
      id: "doc",
      name: "guide.md",
    },
  );
  assert.equal(huge.content.length, MAX_NOTE_CHARS);
});

test("search matches every word across content, current source name and section", () => {
  const a = { ...noteFor("Alpha beta"), id: "a", createdAt: 1 };
  const b = {
    ...noteFor("Gamma"),
    id: "b",
    fileId: "other",
    fileName: "old-name.md",
    createdAt: 2,
    source: { quote: "Gamma", sectionTitle: "Results" },
  };
  const nameOf = (id: string) => (id === "other" ? "renamed.md" : "guide.md");
  assert.deepEqual(
    searchNotes([a, b], "renamed gamma", nameOf).map((n) => n.id),
    ["b"],
  );
  assert.deepEqual(
    searchNotes([a, b], "old-name", nameOf).map((n) => n.id),
    [],
    "a renamed document is found by the name the reader sees now",
  );
  assert.deepEqual(
    searchNotes([a, b], "RESULTS", nameOf).map((n) => n.id),
    ["b"],
  );
  assert.deepEqual(
    searchNotes([a, b], "  ", nameOf).map((n) => n.id),
    ["a", "b"],
  );
  assert.deepEqual(
    sortNotes([a, b]).map((n) => n.id),
    ["b", "a"],
  );
});

// ---- following a note back -------------------------------------------------------

test("a source anchor resolves to the page the passage is on", () => {
  const note = noteFor("Set the output directory before the first build runs.", {
    subtopicId: "getting-started",
  });
  assert.deepEqual(resolveNoteSource(note, file()), {
    kind: "found",
    subtopicId: "getting-started",
    moved: false,
  });
});

test("a moved passage is followed to its new page", () => {
  const note = noteFor("Set the output directory before the first build runs.", {
    subtopicId: "getting-started",
  });
  const moved = DOC.replace("Set the output directory before the first build runs.\n", "").concat(
    "\n\nSet the output directory before the first build runs.",
  );
  assert.deepEqual(resolveNoteSource(note, file(moved)), {
    kind: "found",
    subtopicId: "reference",
    moved: true,
  });
  // Text inserted above shifts every offset; the quote still finds it.
  const shifted = "New opening line.\n\n".repeat(20) + DOC;
  assert.deepEqual(resolveNoteSource(note, file(shifted)), {
    kind: "found",
    subtopicId: "getting-started",
    moved: false,
  });
});

test("a repeated passage resolves to the reader's own page first", () => {
  const twice = `${DOC}\n\nInstall the command line tool with your package manager first.`;
  const fromReference = noteFor("Install the command line tool with your package manager first.", {
    subtopicId: "reference",
  });
  assert.equal(
    (resolveNoteSource(fromReference, file(twice)) as { subtopicId: string }).subtopicId,
    "reference",
  );
});

test("a quote that crossed rendered-only text still anchors by its own lines", () => {
  // Selection text over KaTeX carries glyphs the Markdown never contains.
  const content =
    "# Physics\n\nThe famous relation $E = mc^2$ holds here.\n\nMass and energy are equivalent in every frame.";
  const note = noteFor(
    "The famous relation E=mc2E = mc^2 holds here.\nMass and energy are equivalent in every frame.",
    {
      subtopicId: "physics",
    },
  );
  assert.deepEqual(resolveNoteSource(note, file(content)), {
    kind: "found",
    subtopicId: "physics",
    moved: false,
  });
});

test("a broken anchor reports the passage gone and opens where it was", () => {
  const note = noteFor("Set the output directory before the first build runs.", {
    subtopicId: "getting-started",
    headingId: "configure",
  });
  const rewritten = DOC.replace(
    "Set the output directory before the first build runs.",
    "Pick an output folder.",
  );
  assert.deepEqual(resolveNoteSource(note, file(rewritten)), {
    kind: "missing-passage",
    target: "configure",
  });
  // The heading went too: fall back to the page.
  const noHeading = rewritten.replace("## Configure", "## Output");
  assert.deepEqual(resolveNoteSource(note, file(noHeading)), {
    kind: "missing-passage",
    target: "getting-started",
  });
  // Nothing left to point at.
  const gutted = "# Something else\n\nUnrelated.";
  assert.deepEqual(resolveNoteSource(note, file(gutted)), {
    kind: "missing-passage",
    target: null,
  });
});

test("a short or common line is not trusted to re-anchor a lost passage", () => {
  // The selection's long line was rewritten; its short line ("Configure")
  // still exists elsewhere, but is too weak to claim the passage survived.
  const note = noteFor("Configure\nThe old explanation of output folders that was deleted.", {
    subtopicId: "getting-started",
  });
  assert.equal(resolveNoteSource(note, file()).kind, "missing-passage");
});

test("a binned or deleted source is reported, not followed", () => {
  const note = noteFor("Install the command line tool with your package manager first.");
  assert.deepEqual(resolveNoteSource(note, file(DOC, { deletedAt: 5 })), { kind: "binned" });
  assert.deepEqual(resolveNoteSource(note, undefined), { kind: "missing-document" });
});

// ---- storage -------------------------------------------------------------------------

function workspaceWithNotes(): WorkspaceRecord {
  const ws = newWorkspaceRecord("Research");
  ws.files = [{ id: "doc", name: "guide.md", content: DOC }];
  ws.notes = [
    {
      ...noteFor("Install the command line tool with your package manager first.", {
        subtopicId: "getting-started",
        headingId: "getting-started",
        sectionTitle: "Getting started",
        prefix: "Getting started",
        suffix: "Configure",
        start: 0,
        end: 63,
      }),
      id: "n1",
      content: "Install the **command line** tool.",
      updatedAt: 4_000,
    },
    // Its document is gone; the note stays — it is a snapshot.
    { ...noteFor("Orphaned passage"), id: "n2", fileId: "deleted-doc", fileName: "old.md" },
  ];
  return ws;
}

test("notes survive a backup export and import, including notes whose source is gone", async () => {
  const ws = workspaceWithNotes();
  const restored = parseWorkspaceImport(await serializeWorkspace(ws));
  assert.deepEqual(restored.notes, ws.notes);
});

test("a backup written before notes existed imports with none", async () => {
  const ws = newWorkspaceRecord("Old");
  ws.files = [{ id: "doc", name: "guide.md", content: DOC }];
  const json = JSON.parse(await serializeWorkspace(ws));
  delete json.workspace.notes;
  assert.deepEqual(parseWorkspaceImport(JSON.stringify(json)).notes, []);
});

test("imported notes are validated: malformed fields are repaired, duplicates rejected", async () => {
  const ws = workspaceWithNotes();
  const json = JSON.parse(await serializeWorkspace(ws));
  json.workspace.notes[0].updatedAt = "yesterday";
  json.workspace.notes[0].source = 42;
  const repaired = parseWorkspaceImport(JSON.stringify(json)).notes!;
  assert.equal(repaired[0].updatedAt, repaired[0].createdAt);
  assert.deepEqual(repaired[0].source, { quote: "" });

  json.workspace.notes[1].id = json.workspace.notes[0].id;
  assert.throws(() => parseWorkspaceImport(JSON.stringify(json)), ImportValidationError);

  json.workspace.notes = [{ id: "x", fileId: "doc", content: 7 }];
  assert.throws(() => parseWorkspaceImport(JSON.stringify(json)), ImportValidationError);
});

test("notes survive a reload: IndexedDB stores and returns them unchanged", async () => {
  const ws = workspaceWithNotes();
  await persistence.putWorkspace(ws);
  const back = await persistence.getWorkspace(ws.id);
  assert.deepEqual(back?.notes, ws.notes);
});

test("two tabs taking notes at once both keep theirs", () => {
  const base = workspaceWithNotes();
  const mine = { ...base, notes: [...base.notes!, { ...noteFor("Mine"), id: "mine" }] };
  const theirs = {
    ...base,
    revision: "r2",
    notes: [
      editNote(base.notes![0], "Edited in the other tab", 9_000),
      base.notes![1],
      { ...noteFor("Theirs"), id: "theirs" },
    ],
  };
  const merged = mergeWorkspaces(base, mine, theirs)!;
  assert.deepEqual(merged.notes!.map((n) => n.id).sort(), ["mine", "n1", "n2", "theirs"]);
  assert.equal(merged.notes!.find((n) => n.id === "n1")!.content, "Edited in the other tab");
  assert.ok(
    merged.notes!.some((n) => n.fileId === "deleted-doc"),
    "a note is not dropped because its source is gone",
  );

  // The same note edited differently in both tabs is a real conflict.
  const clash = {
    ...mine,
    notes: [editNote(base.notes![0], "Mine instead", 9_500), base.notes![1]],
  };
  assert.equal(mergeWorkspaces(base, clash, theirs), null);
});

test("moving a document to another workspace carries its notes, renumbered if needed", () => {
  const source = workspaceWithNotes();
  const destination = newWorkspaceRecord("Archive");
  destination.files = [{ id: "doc", name: "taken.md", content: "" }];
  const plan = planTransfer(source, destination, { fileIds: ["doc"], folderIds: [] });
  const newId = plan.renamedFileIds.get("doc")!;
  assert.ok(newId && newId !== "doc");
  assert.deepEqual(
    plan.notes.map((n) => [n.id, n.fileId]),
    [["n1", newId]],
  );
  assert.deepEqual(
    applyToDestination(destination, plan).notes!.map((n) => n.id),
    ["n1"],
  );
  assert.deepEqual(
    removeFromSource(source, plan).notes!.map((n) => n.id),
    ["n2"],
    "notes on documents that stay are untouched",
  );
});
