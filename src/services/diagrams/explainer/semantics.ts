/**
 * Colour a diagram by what its parts mean.
 *
 * Mermaid paints every node the same neutral fill, so a flowchart's happy path
 * and its error branch look identical until you read them. This module reads
 * the words already in the diagram and assigns a role — success, failure,
 * decision, and so on — which the caller renders as colour.
 *
 * Three signals, in order of confidence:
 *
 *  1. **Keywords** in the node's own label. "Error 500" is a failure whatever
 *     shape it is drawn in.
 *  2. **Shape**, when the label says nothing. Mermaid draws a decision as a
 *     rhombus and a terminal as a stadium, so the geometry carries meaning the
 *     text does not repeat.
 *  3. **Incoming edge labels**, last. A node reached only by an edge marked
 *     "no" or "500" is very likely the failure branch even when its own label
 *     is neutral ("Log", "Notify").
 *
 * Nothing here guesses at colour values; it returns a role, and the palette
 * lives in CSS so both themes can answer it differently.
 */

import { canDecorateDiagram } from "../mermaid-performance";

export type SemanticRole =
  | "success"
  | "failure"
  | "warning"
  | "decision"
  | "terminal"
  | "process"
  | "storage"
  | "external"
  | "security"
  | "neutral";

/**
 * Word lists, longest-match-wins within a category.
 *
 * Deliberately conservative about single letters and short words: "ok" as a
 * substring would match "token" and "lookup", so every pattern is matched on a
 * word boundary.
 */
const KEYWORDS: [SemanticRole, string[]][] = [
  [
    "failure",
    [
      "error",
      "errors",
      "fail",
      "failed",
      "failure",
      "failing",
      "reject",
      "rejected",
      "denied",
      "deny",
      "invalid",
      "abort",
      "aborted",
      "crash",
      "crashed",
      "fatal",
      "exception",
      "timeout",
      "timed out",
      "unavailable",
      "unauthorized",
      "forbidden",
      "conflict",
      "corrupt",
      "dead",
      "drop",
      "dropped",
      "lost",
      "missing",
      "not found",
      "4xx",
      "5xx",
      "400",
      "401",
      "403",
      "404",
      "409",
      "429",
      "500",
      "502",
      "503",
      "504",
    ],
  ],
  [
    "success",
    [
      "success",
      "succeeded",
      "ok",
      "done",
      "complete",
      "completed",
      "accept",
      "accepted",
      "approved",
      "valid",
      "verified",
      "pass",
      "passed",
      "healthy",
      "ready",
      "active",
      "commit",
      "committed",
      "merged",
      "deployed",
      "confirmed",
      "granted",
      "resolved",
      "200",
      "201",
      "204",
      "2xx",
    ],
  ],
  [
    "warning",
    [
      "retry",
      "retries",
      "retrying",
      "warn",
      "warning",
      "degraded",
      "slow",
      "pending",
      "waiting",
      "queued",
      "throttle",
      "throttled",
      "backoff",
      "fallback",
      "partial",
      "stale",
      "deprecated",
      "limit",
      "rate limit",
      "circuit",
      "3xx",
      "301",
      "302",
    ],
  ],
  [
    "storage",
    [
      "database",
      "db",
      "datastore",
      "store",
      "storage",
      "cache",
      "redis",
      "postgres",
      "mysql",
      "mongo",
      "clickhouse",
      "s3",
      "bucket",
      "table",
      "index",
      "queue",
      "kafka",
      "topic",
      "log",
      "logs",
      "warehouse",
      "repository",
      "repo",
      "disk",
      "volume",
    ],
  ],
  [
    "security",
    [
      "auth",
      "authn",
      "authz",
      "authenticate",
      "authorize",
      "login",
      "logout",
      "token",
      "jwt",
      "oauth",
      "session",
      "credential",
      "credentials",
      "password",
      "secret",
      "encrypt",
      "encrypted",
      "decrypt",
      "sign",
      "signature",
      "certificate",
      "tls",
      "ssl",
      "permission",
      "permissions",
      "role",
      "acl",
      "firewall",
    ],
  ],
  [
    "external",
    [
      "user",
      "users",
      "client",
      "customer",
      "actor",
      "browser",
      "mobile",
      "third party",
      "third-party",
      "external",
      "vendor",
      "partner",
      "webhook",
      "api gateway",
      "cdn",
      "internet",
      "public",
    ],
  ],
  [
    "terminal",
    ["start", "begin", "end", "stop", "finish", "exit", "terminate", "init", "shutdown"],
  ],
];

/** Edge-label words that say which branch a node is on. */
const EDGE_HINTS: [SemanticRole, string[]][] = [
  ["success", ["yes", "y", "true", "ok", "success", "valid", "pass", "found", "hit", "200", "2xx"]],
  [
    "failure",
    ["no", "n", "false", "error", "fail", "invalid", "miss", "none", "404", "500", "4xx", "5xx"],
  ],
  ["warning", ["maybe", "retry", "timeout", "partial", "slow", "pending"]],
];

function matches(text: string, words: string[]): boolean {
  return words.some((word) => {
    // Word-boundary match so "ok" does not fire inside "token", but still
    // allow multi-word phrases and digits.
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
  });
}

/** The role implied by a piece of text, or null when nothing matches. */
export function roleFromText(text: string): SemanticRole | null {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return null;
  for (const [role, words] of KEYWORDS) {
    if (matches(normalized, words)) return role;
  }
  return null;
}

/** The role implied by an edge label ("yes", "no", "500"). */
export function roleFromEdgeLabel(text: string): SemanticRole | null {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return null;
  for (const [role, words] of EDGE_HINTS) {
    if (matches(normalized, words)) return role;
  }
  return null;
}

/**
 * The role implied by the shape Mermaid drew.
 *
 * Only consulted when the label is silent: a rhombus really is a decision, and
 * a cylinder really is a datastore, regardless of what it is called.
 */
export function roleFromShape(el: Element): SemanticRole | null {
  const shape = el.querySelector("polygon, rect, circle, ellipse, path");
  if (!shape) return null;
  if (shape.tagName === "polygon") {
    // Mermaid draws both decisions (rhombus, 4 points) and hexagons this way;
    // a 4-point polygon whose points alternate is the decision.
    const points = (shape.getAttribute("points") ?? "").trim().split(/\s+/);
    if (points.length === 4 || points.length === 5) return "decision";
  }
  const cls = shape.getAttribute("class") ?? "";
  if (/cylinder|database/i.test(cls)) return "storage";
  if (shape.tagName === "circle" || shape.tagName === "ellipse") return "terminal";
  // A stadium/pill is a rect with a radius half its height.
  if (shape.tagName === "rect") {
    const rx = parseFloat(shape.getAttribute("rx") ?? "0");
    const height = parseFloat(shape.getAttribute("height") ?? "0");
    if (rx > 0 && height > 0 && rx >= height / 2 - 1) return "terminal";
  }
  return null;
}

/**
 * Decide one node's role from everything known about it.
 *
 * `incomingLabels` are the labels of edges arriving at this node, used only as
 * a tiebreak when the node itself is unremarkable.
 */
export function classifyNode(
  el: Element,
  label: string,
  incomingLabels: string[] = [],
): SemanticRole {
  // Shape wins for a decision, and only for a decision. "Valid token?" is a
  // rhombus asking a question, not a success state — but the word "valid"
  // matches the success list, so keyword-first mislabels the single most
  // common node in any flowchart. Every other role still reads the label
  // first, where the words are more specific than the geometry.
  const fromShape = roleFromShape(el);
  if (fromShape === "decision") return fromShape;
  const fromLabel = roleFromText(label);
  if (fromLabel) return fromLabel;
  if (fromShape) return fromShape;
  for (const edgeLabel of incomingLabels) {
    const fromEdge = roleFromEdgeLabel(edgeLabel);
    if (fromEdge) return fromEdge;
  }
  return "neutral";
}

/** The role an edge itself should take, from its label. */
export function classifyEdge(label: string): SemanticRole {
  return roleFromEdgeLabel(label) ?? "neutral";
}

/**
 * True when the diagram's author set this node's colour by hand.
 *
 * Mermaid renders `style X fill:…` and `classDef` as an inline style on the
 * shape. Those authors have already chosen a fill and a matching stroke and
 * text colour; our palette must defer to them rather than repaint one layer of
 * a combination someone designed.
 */
function hasAuthorFill(node: Element): boolean {
  const shape = node.querySelector("rect, polygon, circle, ellipse, path");
  const style = shape?.getAttribute("style") ?? "";
  return /(^|;)\s*fill\s*:/i.test(style);
}

/** Every node-ish group across the diagram families we colour. */
const COLORABLE_NODES =
  "g.node, g.classGroup, g.statediagram-state, g[class*='entity'], rect.actor-top";
/** Every edge-ish line across the same families. */
const COLORABLE_EDGES = [
  "path.flowchart-link",
  "path.transition",
  "path.relation",
  "path.relationshipLine",
  "line.messageLine0",
  "line.messageLine1",
].join(", ");

/**
 * Tag a rendered diagram with the roles its parts play.
 *
 * Writes `data-role` on nodes and edges and `data-edge-role` on the label
 * group, which `diagram-colors.css` turns into colour. Attributes rather than
 * inline styles, so switching the preference off is one class removal and the
 * diagram is back to Mermaid's own palette with nothing to undo.
 *
 * Runs once after render; it never re-reads the DOM during playback.
 */
export function applySemantics(svg: SVGSVGElement): void {
  // Colouring walks every edge and every node, classifying each against several
  // word lists. That is cheap per element and ruinous at ERD scale, where it is
  // one of three full passes over tens of thousands of elements. Past the
  // budget the diagram keeps Mermaid's own palette, which is a far better
  // outcome than a frozen tab.
  if (!canDecorateDiagram(svg)) return;
  // Edge labels are needed before nodes, so a neutral node can inherit the
  // verdict of the branch that reaches it.
  const incomingByNode = new Map<string, string[]>();
  const edges = [...svg.querySelectorAll<SVGElement>(COLORABLE_EDGES)];
  const labelGroups = [...svg.querySelectorAll<SVGGElement>("g.edgeLabels > g.edgeLabel")];

  edges.forEach((edge, index) => {
    const label = labelGroups[index]?.textContent?.trim() ?? "";
    const role = classifyEdge(label);
    if (role !== "neutral") {
      edge.setAttribute("data-role", role);
      labelGroups[index]?.setAttribute("data-edge-role", role);
    }
    // `L_source_target_n` names the node this edge arrives at.
    const dataId = edge.getAttribute("data-id") ?? edge.id;
    const target = dataId.replace(/^L_/, "").replace(/_\d+$/, "").split("_").slice(1).join("_");
    if (target && label) {
      incomingByNode.set(target, [...(incomingByNode.get(target) ?? []), label]);
    }
  });

  for (const node of svg.querySelectorAll<SVGElement>(COLORABLE_NODES)) {
    // Leave a node the author styled themselves alone.
    //
    // `style A fill:#ffd6d6,stroke:#c62828` renders as an inline `!important`
    // fill, which beats our stylesheet — but the label rule has no competitor
    // and lands anyway, so a teal "external" label ended up on the author's
    // pink box at 1.4:1. They picked a fill and a stroke that work together;
    // recolouring half the pair is what breaks it.
    if (hasAuthorFill(node)) continue;

    // The node's own label, preferred over the group's whole text content.
    //
    // A colourable node carries an SVG <title> tooltip, which is real text: read
    // the group and a re-tag over already-marked DOM would classify "Error:
    // failed" as "Click to change this block's colourError: failed". Today the
    // first render happens to tag before marking, so this is a trap rather than
    // a live bug — but the ordering is incidental, and nothing should depend on
    // it. `.nodeLabel` is what the reader actually sees.
    const label = (node.querySelector(".nodeLabel") ?? node).textContent?.trim() ?? "";
    // Match the same key the graph reader derives, so edge hints line up.
    const key = node.id
      .replace(/-\d+$/, "")
      .replace(/^.*-(?:flowchart|state|entity|classId|node)-/, "");
    const role = classifyNode(node, label, incomingByNode.get(key) ?? []);
    if (role !== "neutral") node.setAttribute("data-role", role);
  }
}
