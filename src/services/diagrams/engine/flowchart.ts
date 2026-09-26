/**
 * A diagram as plain data: what was parsed, before anyone lays it out.
 *
 * Flowcharts, ER, class and state diagrams all reduce to the same model —
 * boxes (some of them tables), and edges with a marker at each end — which is
 * all the layout and the renderer need to know about any of them.
 *
 * Parsing stays Mermaid's job. Its grammar is large and keeps growing, and a
 * second parser would be a second dialect that disagrees with the SVG path the
 * moment a diagram crosses the size threshold. So the GPU engine asks Mermaid
 * for the parsed flowchart database and skips only the parts that don't scale:
 * dagre's layout and the SVG it builds.
 *
 * `modelFromDb` is pure (it takes the database's plain accessors), so the
 * translation can be tested without a browser; `parseFlowchart` is the thin
 * browser wrapper that runs Mermaid's parser.
 */
import type { LayoutDirection } from "./layout.ts";

/** Outlines the renderer can draw. Mermaid's rarer shapes map to the nearest. */
export type NodeShape =
  | "rect"
  | "round"
  | "stadium"
  | "ellipse"
  | "diamond"
  | "hexagon"
  /** State diagrams: the filled start dot, the ringed end dot, a fork/join bar. */
  | "start"
  | "end"
  | "bar";

/**
 * What sits at the end of an edge.
 *
 * Flowcharts use arrows, crosses and circles; class diagrams hollow triangles
 * (inheritance), diamonds (composition, aggregation) and open arrows; ER
 * diagrams crow's-foot cardinalities.
 */
export type Marker =
  | "none"
  | "arrow"
  | "arrowOpen"
  | "cross"
  | "circle"
  | "circleOpen"
  | "triangleOpen"
  | "diamond"
  | "diamondOpen"
  | "one"
  | "zeroOne"
  | "oneMany"
  | "zeroMany";

export type DiagramKind = "flowchart" | "er" | "class" | "state";

/**
 * A node drawn as a table: an ER entity (its attributes as rows of type,
 * name, keys, comment) or a class (members, then methods).
 */
export interface TableSpec {
  /** Title lines, e.g. `«interface»` then the class name. */
  header: string[];
  /** Sections under the title, each a list of rows, each a list of cells. */
  sections: string[][][];
}

export type EdgeStroke = "normal" | "thick" | "dotted" | "invisible";

export interface FlowNode {
  /** Mermaid's own id, e.g. `A` for `A[Start]`. */
  id: string;
  lines: string[];
  shape: NodeShape;
  /** CSS colours from `style` and `classDef`, when the author set them. */
  fill?: string;
  stroke?: string;
  color?: string;
  /** Drawn as a table instead of a centred label. */
  table?: TableSpec;
}

export interface FlowEdge {
  /** Indices into `nodes`. */
  source: number;
  target: number;
  lines: string[];
  stroke: EdgeStroke;
  markerStart: Marker;
  markerEnd: Marker;
}

export interface FlowModel {
  kind: DiagramKind;
  direction: LayoutDirection;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Edges that pointed at something other than a node (a subgraph id). */
  skippedEdges: number;
  /** Subgraphs are drawn flat by this engine; reported so the UI can say so. */
  subgraphs: number;
}

interface RawVertex {
  id: string;
  text?: string;
  type?: string;
  styles?: string[];
  classes?: string[];
}

interface RawEdge {
  start: string;
  end: string;
  text?: string;
  type?: string;
  stroke?: string;
}

export interface FlowDbLike {
  getVertices(): Map<string, RawVertex>;
  getEdges(): RawEdge[];
  getDirection?(): string | undefined;
  getClasses?(): Map<string, { styles?: string[]; textStyles?: string[] }>;
  getSubGraphs?(): unknown[];
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

/**
 * A Mermaid label as the lines a reader would see.
 *
 * Labels may carry HTML (`<br/>`, `<b>`), Markdown emphasis, Font Awesome
 * tokens and both HTML (`&amp;`) and Mermaid (`#quot;`) entities. The canvas
 * draws plain text, so markup is reduced to its text and line breaks kept.
 */
export function labelLines(text: string | undefined, fallback: string): string[] {
  const source = text && text.trim() ? text : fallback;
  const plain = source
    // Mermaid's parser stores `#quot;` as `ﬂ°quot¶ß` (and `#35;` as `ﬂ°°35¶ß`)
    // until its SVG renderer decodes them; undo that first, as it does.
    .replace(/ﬂ°°/g, "&#")
    .replace(/ﬂ°/g, "&")
    .replace(/¶ß/g, ";")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\bfa[bsrl]?:fa-[\w-]+\s*/g, "")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/[&#]([a-z]+|#?\d+);/gi, (match, name: string) => {
      const key = name.toLowerCase();
      if (ENTITIES[key]) return ENTITIES[key];
      const code = key.startsWith("#") ? key.slice(1) : key;
      return /^\d+$/.test(code) ? String.fromCodePoint(Number(code)) : match;
    });
  const lines = plain
    .split(/\\n|\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? lines : [fallback];
}

/** Mermaid's vertex types, including v11 `@{ shape: … }` ids, to our outlines. */
export function shapeOf(type: string | undefined): NodeShape {
  switch (type) {
    case "round":
    case "rounded":
    case "cylinder":
    case "cyl":
    case "database":
    case "db":
      return "round";
    case "stadium":
    case "pill":
    case "terminal":
      return "stadium";
    case "circle":
    case "circ":
    case "doublecircle":
    case "dbl-circ":
    case "ellipse":
    case "sm-circ":
    case "small-circle":
      return "ellipse";
    case "diamond":
    case "diam":
    case "decision":
    case "question":
      return "diamond";
    case "hexagon":
    case "hex":
    case "prepare":
      return "hexagon";
    default:
      return "rect";
  }
}

const DIRECTIONS: Record<string, LayoutDirection> = {
  TB: "TB",
  TD: "TB",
  BT: "BT",
  LR: "LR",
  RL: "RL",
};

/** `["fill:#f9f", "stroke:#333"]` → `{ fill: "#f9f", stroke: "#333" }`. */
function readStyles(styles: string[] | undefined, into: Record<string, string>): void {
  for (const entry of styles ?? []) {
    for (const declaration of entry.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      const name = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration
        .slice(colon + 1)
        .replace(/!important/i, "")
        .trim();
      if (value) into[name] = value;
    }
  }
}

export function modelFromDb(db: FlowDbLike): FlowModel {
  const classes = db.getClasses?.() ?? new Map();
  const index = new Map<string, number>();
  const nodes: FlowNode[] = [];
  for (const vertex of db.getVertices().values()) {
    const style: Record<string, string> = {};
    // `classDef default` applies to every node, beneath its own classes.
    const names = ["default", ...(vertex.classes ?? []).filter((name) => name !== "default")];
    for (const name of names) {
      const definition = classes.get(name);
      readStyles(definition?.styles, style);
      readStyles(definition?.textStyles, style);
    }
    readStyles(vertex.styles, style);
    index.set(vertex.id, nodes.length);
    nodes.push({
      id: vertex.id,
      lines: labelLines(vertex.text, vertex.id),
      shape: shapeOf(vertex.type),
      fill: style.fill,
      stroke: style.stroke,
      color: style.color,
    });
  }

  const edges: FlowEdge[] = [];
  let skippedEdges = 0;
  for (const edge of db.getEdges()) {
    const source = index.get(edge.start);
    const target = index.get(edge.end);
    if (source === undefined || target === undefined) {
      skippedEdges++;
      continue;
    }
    const type = edge.type ?? "arrow_point";
    const stroke = edge.stroke;
    const head = flowchartMarker(type.replace(/^double_/, ""));
    edges.push({
      source,
      target,
      lines: edge.text && edge.text.trim() ? labelLines(edge.text, "") : [],
      stroke:
        stroke === "thick" || stroke === "dotted" || stroke === "invisible" ? stroke : "normal",
      markerStart: type.startsWith("double_") ? head : "none",
      markerEnd: head,
    });
  }

  return {
    kind: "flowchart",
    direction: DIRECTIONS[(db.getDirection?.() ?? "TB").toUpperCase()] ?? "TB",
    nodes,
    edges,
    skippedEdges,
    subgraphs: db.getSubGraphs?.().length ?? 0,
  };
}

/** Vertex type names by the fast parser's shape code (engine/layout/src/parser.rs). */
const FAST_SHAPES = [
  undefined,
  "square",
  "round",
  "stadium",
  "subroutine",
  "cylinder",
  "circle",
  "doublecircle",
  "ellipse",
  "odd",
  "diamond",
  "hexagon",
  "lean_right",
  "lean_left",
  "trapezoid",
  "inv_trapezoid",
];
const FAST_STROKES: EdgeStroke[] = ["normal", "thick", "dotted", "invisible"];
const FAST_HEADS: Marker[] = ["none", "arrow", "cross", "circle"];

/** Mermaid's flowchart arrow types to markers. */
function flowchartMarker(type: string): Marker {
  if (type === "arrow_cross") return "cross";
  if (type === "arrow_circle") return "circle";
  if (type === "arrow_open") return "none";
  return "arrow";
}
const NO_SPAN = 0xffffffff;
const DIRECTION_CODES: LayoutDirection[] = ["TB", "BT", "LR", "RL"];

/**
 * The model from the Rust fast-path parser's output, or null when it declined.
 *
 * Labels and styles arrive as byte spans into the source and go through the
 * same clean-up as Mermaid's output (`labelLines`, `readStyles`), so for any
 * diagram both parsers accept, the two models are identical — the tests and
 * bench/ check that against Mermaid itself.
 */
export function modelFromParsed(words: Uint32Array, utf8: Uint8Array): FlowModel | null {
  if (words[0] !== 0) return null;
  const decoder = new TextDecoder();
  const text = (start: number, end: number) => decoder.decode(utf8.subarray(start, end));
  const n = words[2];
  const m = words[3];
  const spans = words[4];
  let cursor = 5;
  const nodeBase = cursor;
  cursor += n * 5;
  const styleOffsets = cursor;
  cursor += n + 1;
  const styleSpans = cursor;
  cursor += spans * 2;
  const edgeBase = cursor;

  const nodes: FlowNode[] = [];
  for (let i = 0; i < n; i++) {
    const w = nodeBase + i * 5;
    const id = text(words[w], words[w + 1]);
    const label = words[w + 2] === NO_SPAN ? undefined : text(words[w + 2], words[w + 3]);
    const declarations: string[] = [];
    for (let s = words[styleOffsets + i]; s < words[styleOffsets + i + 1]; s++) {
      declarations.push(text(words[styleSpans + s * 2], words[styleSpans + s * 2 + 1]));
    }
    const style: Record<string, string> = {};
    readStyles(declarations, style);
    nodes.push({
      id,
      lines: labelLines(label, id),
      shape: shapeOf(FAST_SHAPES[words[w + 4]]),
      fill: style.fill,
      stroke: style.stroke,
      color: style.color,
    });
  }

  const edges: FlowEdge[] = [];
  for (let e = 0; e < m; e++) {
    const w = edgeBase + e * 7;
    const label = words[w + 2] === NO_SPAN ? "" : text(words[w + 2], words[w + 3]);
    edges.push({
      source: words[w],
      target: words[w + 1],
      lines: label.trim() ? labelLines(label, "") : [],
      stroke: FAST_STROKES[words[w + 4]] ?? "normal",
      markerStart: FAST_HEADS[words[w + 6]] ?? "none",
      markerEnd: FAST_HEADS[words[w + 5]] ?? "arrow",
    });
  }

  return {
    kind: "flowchart",
    direction: DIRECTION_CODES[words[1]] ?? "TB",
    nodes,
    edges,
    skippedEdges: 0,
    subgraphs: 0,
  };
}

const ER_CARDS: Marker[] = ["none", "one", "zeroOne", "oneMany", "zeroMany"];

/**
 * The model from the Rust ER fast path, or null when it declined. Built to
 * match `modelFromLayoutData(db.getData(), "er")` exactly — ids included — so
 * either parser yields the same drawing; bench/ checks this against Mermaid.
 */
export function modelFromErParsed(words: Uint32Array, utf8: Uint8Array): FlowModel | null {
  if (words[0] !== 0) return null;
  const decoder = new TextDecoder();
  const text = (start: number, end: number) =>
    start === NO_SPAN ? "" : decoder.decode(utf8.subarray(start, end));
  const n = words[2];
  const m = words[3];
  const attributeCount = words[4];
  let cursor = 5;
  const entityBase = cursor;
  cursor += n * 5;
  const offsets = cursor;
  cursor += n + 1;
  const attributeBase = cursor;
  cursor += attributeCount * 8;
  const relationBase = cursor;

  const nodes: FlowNode[] = [];
  for (let i = 0; i < n; i++) {
    const w = entityBase + i * 5;
    const name = text(words[w], words[w + 1]);
    const alias = text(words[w + 2], words[w + 3]);
    const title = labelLines(alias || name, `entity-${name}-${i}`).join(" ");
    const rows: string[][] = [];
    for (let a = words[offsets + i]; a < words[offsets + i + 1]; a++) {
      const r = attributeBase + a * 8;
      rows.push([
        text(words[r], words[r + 1]),
        text(words[r + 2], words[r + 3]),
        text(words[r + 4], words[r + 5])
          .split(",")
          .map((key) => key.trim())
          .filter(Boolean)
          .join(","),
        text(words[r + 6], words[r + 7]),
      ]);
    }
    nodes.push({
      id: `entity-${name}-${i}`,
      lines: [title],
      shape: "rect",
      table: { header: [title], sections: rows.length ? [rows] : [] },
    });
  }

  const edges: FlowEdge[] = [];
  for (let e = 0; e < m; e++) {
    const w = relationBase + e * 7;
    const label = text(words[w + 2], words[w + 3]);
    edges.push({
      source: words[w],
      target: words[w + 1],
      lines: label.trim() ? labelLines(label, "") : [],
      stroke: words[w + 6] ? "normal" : "dotted",
      markerStart: ER_CARDS[words[w + 4]] ?? "none",
      markerEnd: ER_CARDS[words[w + 5]] ?? "none",
    });
  }

  return {
    kind: "er",
    direction: DIRECTION_CODES[words[1]] ?? "TB",
    nodes,
    edges,
    skippedEdges: 0,
    subgraphs: 0,
  };
}

/** One node of Mermaid's unified layout data (`db.getData()`), as far as we read it. */
interface LayoutDataNode {
  id: string;
  label?: string;
  shape?: string;
  alias?: string;
  isGroup?: boolean;
  attributes?: { type?: string; name?: string; keys?: string[]; comment?: string }[];
  members?: { text?: string }[];
  methods?: { text?: string }[];
  annotations?: string[];
  cssStyles?: string[];
  styles?: string[];
}

interface LayoutDataEdge {
  start: string;
  end: string;
  label?: string;
  arrowTypeStart?: string;
  arrowTypeEnd?: string;
  pattern?: string;
  thickness?: string;
}

export interface LayoutData {
  nodes: LayoutDataNode[];
  edges: LayoutDataEdge[];
  direction?: string;
}

const ER_MARKERS: Record<string, Marker> = {
  only_one: "one",
  zero_or_one: "zeroOne",
  one_or_more: "oneMany",
  zero_or_more: "zeroMany",
};

const CLASS_MARKERS: Record<string, Marker> = {
  extension: "triangleOpen",
  composition: "diamond",
  aggregation: "diamondOpen",
  dependency: "arrowOpen",
  lollipop: "circleOpen",
  none: "none",
};

function relationMarker(kind: DiagramKind, type: string | undefined): Marker {
  if (!type || type === "none") return "none";
  if (kind === "er") return ER_MARKERS[type] ?? "arrow";
  if (kind === "class") return CLASS_MARKERS[type] ?? "arrow";
  return "arrow";
}

/**
 * Member text as a reader sees it: Mermaid's escaped visibility (`\+int age`)
 * unescaped, generics (`List~int~`) as angle brackets, entities decoded.
 */
function memberText(text: string | undefined): string {
  return (text ?? "")
    .replace(/\\([+\-#~$*])/g, "$1")
    .replace(/~([^~]+)~/g, "<$1>")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

const VISIBILITY = ["+", "-", "#", "~"];

/**
 * A raw class member line as Mermaid's parser stores it (its `ClassMember`):
 * visibility kept and escaped, a method's return type after ` : `, a trailing
 * `$` (static) or `*` (abstract) classifier dropped from the text. Ported
 * rule for rule so the Rust fast path yields exactly Mermaid's member text.
 */
export function mermaidMemberText(input: string): string {
  const method = input.indexOf(")") > 0;
  let visibility = "";
  let id = "";
  let parameters = "";
  let returnType = "";
  if (method) {
    const match = /([#+~-])?(.+)\((.*)\)([\s$*])?(.*)([$*])?/.exec(input);
    if (match) {
      const detected = match[1] ? match[1].trim() : "";
      if (VISIBILITY.includes(detected)) visibility = detected;
      id = match[2];
      parameters = match[3] ? match[3].trim() : "";
      const classifier = match[4] ? match[4].trim() : "";
      returnType = match[5] ? match[5].trim() : "";
      if (classifier === "" && /[$*]/.test(returnType.slice(-1))) {
        returnType = returnType.slice(0, -1);
      }
    }
  } else {
    const first = input.slice(0, 1);
    const classifier = /[$*]/.test(input.slice(-1)) ? input.slice(-1) : "";
    if (VISIBILITY.includes(first)) visibility = first;
    id = input.substring(
      visibility === "" ? 0 : 1,
      classifier === "" ? input.length : input.length - 1,
    );
  }
  id = id.startsWith(" ") ? " " + id.trim() : id.trim();
  const call = method ? `(${parameters})${returnType ? " : " + returnType : ""}` : "";
  return `${visibility ? "\\" + visibility : ""}${id}${call}`;
}

const CLASS_ENDS = ["none", "aggregation", "extension", "composition", "dependency", "lollipop"];

/**
 * The model from the Rust class-diagram fast path, or null when it declined.
 * Built to equal `modelFromLayoutData(db.getData(), "class")`; bench/ checks
 * this against Mermaid.
 */
export function modelFromClassParsed(words: Uint32Array, utf8: Uint8Array): FlowModel | null {
  if (words[0] !== 0) return null;
  const decoder = new TextDecoder();
  const text = (start: number, end: number) =>
    start === NO_SPAN ? "" : decoder.decode(utf8.subarray(start, end));
  const n = words[2];
  const m = words[3];
  const memberCount = words[4];
  let cursor = 5;
  const classBase = cursor;
  cursor += n * 2;
  const offsets = cursor;
  cursor += n + 1;
  const memberBase = cursor;
  cursor += memberCount * 2;
  const relationBase = cursor;

  const nodes: FlowNode[] = [];
  for (let i = 0; i < n; i++) {
    const name = text(words[classBase + i * 2], words[classBase + i * 2 + 1]);
    const annotations: string[] = [];
    const members: string[][] = [];
    const methods: string[][] = [];
    for (let k = words[offsets + i]; k < words[offsets + i + 1]; k++) {
      const raw = text(words[memberBase + k * 2], words[memberBase + k * 2 + 1]).trim();
      if (raw.startsWith("<<") && raw.endsWith(">>")) annotations.push(raw.slice(2, -2));
      else if (raw.indexOf(")") > 0) methods.push([memberText(mermaidMemberText(raw))]);
      else if (raw) members.push([memberText(mermaidMemberText(raw))]);
    }
    const title = memberText(labelLines(name, name).join(" "));
    nodes.push({
      id: name,
      lines: [title],
      shape: "rect",
      table: {
        header: [...annotations.map((a) => `«${a}»`), title],
        sections: [members, methods],
      },
    });
  }

  const edges: FlowEdge[] = [];
  for (let e = 0; e < m; e++) {
    const w = relationBase + e * 7;
    const label = text(words[w + 2], words[w + 3]);
    edges.push({
      source: words[w],
      target: words[w + 1],
      lines: label.trim() ? labelLines(label, "") : [],
      stroke: words[w + 6] ? "dotted" : "normal",
      markerStart: relationMarker("class", CLASS_ENDS[words[w + 4]]),
      markerEnd: relationMarker("class", CLASS_ENDS[words[w + 5]]),
    });
  }

  return {
    kind: "class",
    direction: DIRECTION_CODES[words[1]] ?? "TB",
    nodes,
    edges,
    skippedEdges: 0,
    subgraphs: 0,
  };
}

function stateShape(shape: string | undefined): NodeShape {
  switch (shape) {
    case "stateStart":
      return "start";
    case "stateEnd":
      return "end";
    case "fork":
    case "join":
      return "bar";
    case "choice":
      return "diamond";
    default:
      return "round";
  }
}

/**
 * ER, class and state diagrams from Mermaid's unified layout data — the same
 * node and edge list its own renderer lays out, so what we draw is what
 * Mermaid parsed, table rows and relation markers included.
 */
export function modelFromLayoutData(data: LayoutData, kind: DiagramKind): FlowModel {
  const index = new Map<string, number>();
  const nodes: FlowNode[] = [];
  let groups = 0;
  for (const node of data.nodes) {
    // Class namespaces are only containers; composite states are real states
    // that transitions point at, so they stay (drawn flat).
    if (node.isGroup) {
      groups++;
      if (kind !== "state") continue;
    }
    const style: Record<string, string> = {};
    readStyles(node.cssStyles, style);
    readStyles(node.styles, style);
    const name = labelLines(node.alias || node.label, node.id).join(" ");
    let spec: FlowNode;
    if (kind === "er") {
      spec = {
        id: node.id,
        lines: [name],
        shape: "rect",
        table: {
          header: [name],
          sections: node.attributes?.length
            ? [
                node.attributes.map((a) => [
                  a.type ?? "",
                  a.name ?? "",
                  (a.keys ?? []).join(","),
                  a.comment ?? "",
                ]),
              ]
            : [],
        },
      };
    } else if (kind === "class") {
      const title = memberText(name);
      spec = {
        id: node.id,
        lines: [title],
        shape: "rect",
        table: {
          header: [...(node.annotations ?? []).map((a) => `«${a}»`), title],
          sections: [
            (node.members ?? []).map((m) => [memberText(m.text)]),
            (node.methods ?? []).map((m) => [memberText(m.text)]),
          ],
        },
      };
    } else {
      const shape = stateShape(node.shape);
      const bare = shape === "start" || shape === "end" || shape === "bar";
      spec = {
        id: node.id,
        lines: bare ? [] : labelLines(node.label, node.id),
        shape,
      };
    }
    if (style.fill) spec.fill = style.fill;
    if (style.stroke) spec.stroke = style.stroke;
    if (style.color) spec.color = style.color;
    index.set(node.id, nodes.length);
    nodes.push(spec);
  }

  const edges: FlowEdge[] = [];
  let skippedEdges = 0;
  for (const edge of data.edges) {
    const source = index.get(edge.start);
    const target = index.get(edge.end);
    if (source === undefined || target === undefined) {
      skippedEdges++;
      continue;
    }
    edges.push({
      source,
      target,
      lines: edge.label && edge.label.trim() ? labelLines(edge.label, "") : [],
      stroke:
        edge.pattern === "dashed" || edge.pattern === "dotted"
          ? "dotted"
          : edge.thickness === "thick"
            ? "thick"
            : "normal",
      markerStart: relationMarker(kind, edge.arrowTypeStart),
      markerEnd: relationMarker(kind, edge.arrowTypeEnd),
    });
  }

  return {
    kind,
    direction: DIRECTIONS[(data.direction ?? "TB").toUpperCase()] ?? "TB",
    nodes,
    edges,
    skippedEdges,
    subgraphs: groups,
  };
}

/** Which of our kinds a Mermaid diagram type is, if any. */
export function kindOfDiagramType(type: string): DiagramKind | null {
  if (type.startsWith("flowchart") || type === "graph") return "flowchart";
  if (type === "er" || type.startsWith("erDiagram")) return "er";
  if (type.startsWith("class")) return "class";
  if (type.startsWith("state")) return "state";
  return null;
}
