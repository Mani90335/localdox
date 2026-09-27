/**
 * JSON → mind map transformation. Pure data, no React and no DOM: the renderer
 * is handed a normalized tree and never sees the original document.
 *
 *   raw text → parse → detect shape → normalize → MindMapNode
 *
 * Nothing here mutates the parsed value. The normalizer only reads it.
 */

export interface MindMapNode {
  id: string;
  label: string;
  /** Context retained for the inspector, never promoted into map nodes. */
  metadata?: Array<{ label: string; value: string }>;
  children?: MindMapNode[];
}

export interface MindMapTree {
  root: MindMapNode;
  /** Total nodes kept after truncation — drives the initial collapse depth. */
  nodeCount: number;
  /** True when the source was larger than the caps below and was trimmed. */
  truncated: boolean;
}

/**
 * Caps. A mind map is a reading surface, not a data browser: past these sizes
 * the picture stops being legible long before the browser struggles, and the
 * JSON viewer is the better answer. `MAX_NODES` also bounds the work done on
 * the main thread during normalization.
 */
const MAX_NODES = 4000;
const MAX_DEPTH = 24;
const MAX_CHILDREN_PER_NODE = 300;
/** Above this, the initial view collapses to `DEEP_TREE_DEPTH` instead. */
const LARGE_TREE_NODES = 60;
const DEFAULT_OPEN_DEPTH = 2;
const DEEP_TREE_DEPTH = 1;

/** Keys that name a node, in priority order. */
const LABEL_KEYS = ["name", "label", "title", "text", "key", "id"] as const;
/**
 * Identity fields are useful for applications but not for people reading a
 * map. In particular, a labelled object must never grow a second `id` leaf.
 * `key` remains a last-resort label for anonymous data, but is metadata when
 * a human-readable name is already present.
 */
const IDENTITY_KEYS = new Set(["id", "_id", "uuid", "key"]);
/** Keys that hold a node's children, in priority order. */
const CHILD_KEYS = [
  "children",
  "nodes",
  "items",
  "child",
  "subtopics",
  "sections",
  "branches",
  "elements",
] as const;

type Json = unknown;

function isPlainObject(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse without throwing. Invalid JSON simply has no mind map. */
export function parseJson(text: string): { ok: true; value: Json } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as Json };
  } catch {
    return { ok: false };
  }
}

function firstStringKey(
  object: Record<string, Json>,
  keys: readonly string[],
): { key: string; value: string } | null {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) return { key, value: value.trim() };
    if (typeof value === "number" || typeof value === "boolean") {
      return { key, value: String(value) };
    }
  }
  return null;
}

function firstArrayKey(
  object: Record<string, Json>,
  keys: readonly string[],
): { key: string; value: Json[] } | null {
  for (const key of keys) {
    const value = object[key];
    if (Array.isArray(value)) return { key, value };
  }
  return null;
}

/** Full readable value for the inspector; it is never painted into a node. */
function describeMetadataValue(value: Json): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) || isPlainObject(value)) return JSON.stringify(value, null, 2);
  return "";
}

/**
 * Is this worth drawing as a mind map at all?
 *
 * The bar is deliberately low but not absent: the value must be a container
 * that actually nests. A flat config object or an array of scalars renders as a
 * one-level fan of leaves, which tells the reader nothing the JSON viewer does
 * not already show, so no action is offered for it.
 */
export function isMindMappable(value: Json): boolean {
  if (Array.isArray(value)) {
    if (!value.length) return false;
    return value.some((item) => isPlainObject(item) || Array.isArray(item));
  }
  if (!isPlainObject(value)) return false;
  const entries = Object.entries(value);
  if (!entries.length) return false;
  // A recognised `children`-style array of objects is the canonical shape.
  const childArray = firstArrayKey(value, CHILD_KEYS);
  if (childArray?.value.some((item) => isPlainObject(item))) return true;
  // Otherwise accept any object with at least one nested container.
  return entries.some(([, child]) => {
    if (isPlainObject(child)) return Object.keys(child).length > 0;
    return Array.isArray(child) && child.length > 0;
  });
}

/**
 * Normalize an arbitrary JSON value into a mind map tree.
 *
 * IDs are positional paths (`0.2.1`), so they are stable across renders and
 * across expand/collapse — React keys and the open-set both rely on that.
 */
export function toMindMap(value: Json, rootLabel = "root"): MindMapTree {
  let budget = MAX_NODES;
  let truncated = false;

  function build(node: Json, label: string, id: string, depth: number): MindMapNode {
    if (depth >= MAX_DEPTH) {
      truncated = true;
      return { id, label };
    }

    // Scalars and null are always leaves.
    if (!isPlainObject(node) && !Array.isArray(node)) {
      return { id, label, metadata: [{ label: "Value", value: describeMetadataValue(node) }] };
    }

    const entries: Array<{ label: string; value: Json }> = [];
    let ownLabel = label;
    let metadata: Array<{ label: string; value: string }> | undefined;

    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index++) {
        const item = node[index];
        entries.push({ label: itemLabel(item, index), value: item });
      }
    } else {
      // An object names itself through `name`/`label`/`title`/… when it has one,
      // and that key is then not repeated as a child.
      const named = firstStringKey(node, LABEL_KEYS);
      if (named) ownLabel = named.value;
      const childArray = firstArrayKey(node, CHILD_KEYS);
      const skip = new Set<string>();
      if (named) skip.add(named.key);
      if (childArray) skip.add(childArray.key);

      // Never expose application identifiers as concepts. When a meaningful
      // label/name exists, every identity alias is implementation detail too;
      // otherwise the selected `key`/`id` above is still a useful fallback.
      if (named && !IDENTITY_KEYS.has(named.key)) {
        for (const key of IDENTITY_KEYS) skip.add(key);
      }

      // A named object represents a concept, not a bag of JSON fields. Its
      // meaningful hierarchy is its explicit child collection; everything
      // else belongs in the inspector. This is the critical guard that keeps
      // `id`, descriptions and implementation metadata off the map.
      if (named) {
        metadata = Object.entries(node)
          .filter(([key]) => !skip.has(key) && !IDENTITY_KEYS.has(key))
          .map(([key, child]) => ({ label: key, value: describeMetadataValue(child) }))
          .filter((entry) => entry.value);
      } else {
        for (const [key, child] of Object.entries(node)) {
          if (skip.has(key) || IDENTITY_KEYS.has(key)) continue;
          entries.push({ label: key, value: child });
        }
      }
      if (childArray) {
        for (let index = 0; index < childArray.value.length; index++) {
          const item = childArray.value[index];
          entries.push({ label: itemLabel(item, index), value: item });
        }
      }
    }

    const kept = entries.length > MAX_CHILDREN_PER_NODE;
    if (kept) truncated = true;
    const slice = kept ? entries.slice(0, MAX_CHILDREN_PER_NODE) : entries;

    const children: MindMapNode[] = [];
    for (let index = 0; index < slice.length; index++) {
      if (budget <= 0) {
        truncated = true;
        break;
      }
      budget--;
      children.push(build(slice[index].value, slice[index].label, `${id}.${index}`, depth + 1));
    }
    if (kept && children.length) {
      children.push({
        id: `${id}.more`,
        label: `… ${entries.length - slice.length} more`,
      });
    }

    if (children.length) return { id, label: ownLabel, metadata, children };
    // A named childless container is already a complete concept; its optional
    // metadata remains available from the inspector rather than on the map.
    return { id, label: ownLabel, metadata };
  }

  /** Best available name for an array element. */
  function itemLabel(item: Json, index: number): string {
    if (isPlainObject(item)) {
      const named = firstStringKey(item, LABEL_KEYS);
      if (named) return named.value;
    }
    if (typeof item === "string" && item.trim()) return item.trim();
    return `[${index}]`;
  }

  // The document itself names the root when it carries a label key.
  const named = isPlainObject(value) ? firstStringKey(value, LABEL_KEYS) : null;
  const root = build(value, named?.value ?? rootLabel, "0", 0);
  return { root, nodeCount: MAX_NODES - budget + 1, truncated };
}

/** Depth to leave expanded on first paint — shallower for big trees. */
export function initialOpenDepth(tree: MindMapTree): number {
  return tree.nodeCount > LARGE_TREE_NODES ? DEEP_TREE_DEPTH : DEFAULT_OPEN_DEPTH;
}

/** Ids of every node at or above `depth` that has children. */
export function openToDepth(root: MindMapNode, depth: number): Set<string> {
  const open = new Set<string>();
  const walk = (node: MindMapNode, level: number) => {
    if (!node.children?.length || level >= depth) return;
    open.add(node.id);
    for (const child of node.children) walk(child, level + 1);
  };
  walk(root, 0);
  return open;
}

/** Every node id in the tree that has children. */
export function allBranchIds(root: MindMapNode): Set<string> {
  const ids = new Set<string>();
  const stack: MindMapNode[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.children?.length) {
      ids.add(node.id);
      for (const child of node.children) stack.push(child);
    }
  }
  return ids;
}

/**
 * One-shot check used by the viewer to decide whether to offer the action:
 * valid JSON, a nestable shape, and small enough to draw.
 */
export function buildMindMap(text: string, rootLabel: string): MindMapTree | null {
  // A cheap length guard first — parsing a 50MB export just to reject it would
  // block the main thread for as long as the parse takes.
  if (text.length > 5_000_000) return null;
  const parsed = parseJson(text);
  if (!parsed.ok || !isMindMappable(parsed.value)) return null;
  const tree = toMindMap(parsed.value, rootLabel);
  return tree.root.children?.length ? tree : null;
}
