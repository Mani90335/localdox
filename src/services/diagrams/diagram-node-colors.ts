// Per-node colour overrides for Mermaid diagrams.
//
// `diagram-colors.css` paints a node by the *role* semantics.ts inferred for it
// — green for success, red for failure. That guess is usually right and
// occasionally wrong, and until now a reader who disagreed had no recourse
// short of editing the diagram source. This is the recourse: click a node, pick
// a colour, and that one node keeps it.
//
// Overrides are written as inline styles on the rendered SVG rather than as
// another attribute for the stylesheet to answer. Author styles already arrive
// inline and `!important`, and an override that has to beat them has nowhere
// else to go.

/** The palette offered for a node. Deliberately the same six hues as the text
 *  highlighter: a reader who has learned what yellow means while reading should
 *  not meet a different yellow when they recolour a box. */
export const NODE_COLORS = ["#fde047", "#86efac", "#93c5fd", "#f9a8d4", "#fdba74", "#d8b4fe"];

/** One diagram's overrides: node key to colour. */
export type NodeOverrides = Record<string, string>;

const KEY = "localdox:diagram-node-colors";

/**
 * Identity for a diagram.
 *
 * A diagram has no id of its own — a ```mermaid fence is just text inside a
 * document — so its source is its identity. Hashed rather than stored whole:
 * the key sits in localStorage, and a megabyte of ER diagram does not belong
 * in a storage key.
 *
 * Editing a diagram's source therefore drops its overrides. That is the honest
 * outcome: the nodes may not exist any more, and silently reapplying colours to
 * whatever now sits at those keys would be worse than starting clean.
 */
export function diagramKey(source: string): string {
  // FNV-1a. Not cryptographic — it only has to separate the diagrams in one
  // reader's documents, where collisions are a curiosity rather than a risk.
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Identity for one node inside a diagram.
 *
 * Mermaid mangles the author's node name into the DOM id with a per-render
 * prefix and suffix (`flowchart-Start-3`). Stripping both leaves the author's
 * own name, which is stable across re-renders — and is the same derivation
 * semantics.ts uses, so a node's override and its inferred role always agree
 * about which node they are talking about.
 */
export function nodeKey(node: Element): string {
  return node.id.replace(/-\d+$/, "").replace(/^.*-(?:flowchart|state|entity|classId|node)-/, "");
}

type Store = Record<string, NodeOverrides>;

function readStore(): Store {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* storage full or unavailable — the colours stay on screen for this session */
  }
}

export function loadOverrides(diagram: string): NodeOverrides {
  return readStore()[diagram] ?? {};
}

/** Set or clear one node's colour. Passing `null` removes the override, and an
 *  empty diagram entry is dropped rather than left as `{}`. */
export function saveOverride(diagram: string, node: string, color: string | null): NodeOverrides {
  const store = readStore();
  const next: NodeOverrides = { ...store[diagram] };
  if (color) next[node] = color;
  else delete next[node];

  if (Object.keys(next).length) store[diagram] = next;
  else delete store[diagram];
  writeStore(store);
  return next;
}

export function clearOverrides(diagram: string): void {
  const store = readStore();
  delete store[diagram];
  writeStore(store);
}

/** The shapes a node's colour applies to — the same set semantics.ts paints. */
const SHAPES = "rect, polygon, circle, ellipse, path";

/**
 * Paint one node, or strip the paint back off.
 *
 * The label is left at its own colour rather than recoloured to match: these
 * are pale fills chosen to sit under dark text, and tinting the text to the
 * same hue is how you get a yellow label on a yellow box.
 */
function paint(node: Element, color: string | null): void {
  for (const shape of node.querySelectorAll<SVGElement>(SHAPES)) {
    if (color) {
      shape.style.setProperty("fill", color, "important");
      shape.style.setProperty("stroke", color, "important");
    } else {
      shape.style.removeProperty("fill");
      shape.style.removeProperty("stroke");
    }
  }
  for (const label of node.querySelectorAll<HTMLElement>(".nodeLabel")) {
    // Dark ink on every one of these fills, in both themes — the fill is the
    // reader's choice and does not change with the theme, so neither can this.
    if (color) label.style.setProperty("color", "#0a0a0a", "important");
    else label.style.removeProperty("color");
  }
}

/** Every node-ish group a reader can recolour. Mirrors semantics.ts. */
export const COLORABLE_NODES =
  "g.node, g.classGroup, g.statediagram-state, g[class*='entity'], rect.actor-top";

/**
 * Apply a diagram's stored overrides to a freshly rendered SVG.
 *
 * Runs after every render, because the render cache hands back the same SVG
 * *string* each time — the overrides live here, not in that markup, so they
 * have to be re-applied to each new copy in the DOM.
 */
export function applyOverrides(svg: SVGSVGElement, overrides: NodeOverrides): void {
  if (!Object.keys(overrides).length) return;
  for (const node of svg.querySelectorAll<SVGElement>(COLORABLE_NODES)) {
    const color = overrides[nodeKey(node)];
    if (color) paint(node, color);
  }
}

/** Paint a single node immediately, so the click feels instant rather than
 *  waiting on a re-render that is not coming. */
export function applyOne(svg: SVGSVGElement, node: string, color: string | null): void {
  for (const el of svg.querySelectorAll<SVGElement>(COLORABLE_NODES)) {
    if (nodeKey(el) === node) paint(el, color);
  }
}
