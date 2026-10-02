// Whole-scene edits: each takes the element array and returns a new one.
//
// Kept free of the DOM and of editor state so every structural rule of a board
// — labels travel with their shape, connectors stay attached, deleting a shape
// deletes its label and frees the arrows pointing at it — lives in one place
// and is unit-tested directly (tests/board.test.ts).

import {
  elementCenter,
  hitTest,
  linearPath,
  nearBoxEdge,
  outlinePoint,
  withWorldPoints,
  worldPoints,
} from "./geometry.ts";
import {
  isBindable,
  isLinear,
  mutate,
  newElement,
  randomId,
  type BoardElement,
  type Point,
  type StyleDefaults,
} from "./model.ts";
import { CONTAINER_PADDING, labelArea, layoutText } from "./text.ts";

export function indexById(elements: BoardElement[]) {
  const map = new Map<string, BoardElement>();
  for (const el of elements) map.set(el.id, el);
  return map;
}

export function labelOf(container: BoardElement, map: Map<string, BoardElement>) {
  const ref = container.boundElements?.find((b) => b.type === "text");
  const text = ref ? map.get(ref.id) : undefined;
  return text && text.containerId === container.id ? text : undefined;
}

/** Replaces elements by id, keeping array order. */
export function replaceElements(elements: BoardElement[], changed: Map<string, BoardElement>) {
  if (!changed.size) return elements;
  return elements.map((el) => changed.get(el.id) ?? el);
}

function pathMidpoint(points: Point[]): Point {
  if (points.length === 1) return points[0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    if (walked + seg >= total / 2 && seg) {
      const t = (total / 2 - walked) / seg;
      return [
        points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
        points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t,
      ];
    }
    walked += seg;
  }
  return points[points.length - 1];
}

/**
 * Lays a label out inside its container and writes the result into the text
 * element's own box (so other tools reading the file place it correctly). A
 * shape too short for its text grows downward, the way a sticky note does.
 */
function settleLabel(
  container: BoardElement,
  text: BoardElement,
): { container: BoardElement; text: BoardElement } {
  const layout = layoutText(text, container);
  if (isLinear(container)) {
    const mid = pathMidpoint(worldPoints(container, linearPath(container)));
    const box = {
      x: mid[0] - layout.width / 2,
      y: mid[1] - layout.height / 2,
      width: layout.width,
      height: layout.height,
      angle: 0,
    };
    return { container, text: sameBox(text, box) ? text : mutate(text, box) };
  }
  const ratio =
    container.type === "ellipse" ? Math.SQRT1_2 : container.type === "diamond" ? 0.5 : 1;
  const needed = (layout.height + CONTAINER_PADDING * 2) / ratio;
  let next = container;
  if (container.height < needed - 0.5) next = mutate(container, { height: Math.ceil(needed) });
  const area = labelArea(next);
  const free = area.height - layout.height;
  const offset =
    text.verticalAlign === "top" ? 0 : text.verticalAlign === "bottom" ? free : free / 2;
  const box = {
    x: next.x + area.x,
    y: next.y + area.y + Math.max(offset, 0),
    width: area.width,
    height: layout.height,
    angle: next.angle,
  };
  return { container: next, text: sameBox(text, box) ? text : mutate(text, box) };
}

function sameBox(
  el: BoardElement,
  box: { x: number; y: number; width: number; height: number; angle: number },
) {
  return (
    Math.abs(el.x - box.x) < 0.01 &&
    Math.abs(el.y - box.y) < 0.01 &&
    Math.abs(el.width - box.width) < 0.01 &&
    Math.abs(el.height - box.height) < 0.01 &&
    el.angle === box.angle
  );
}

/** Re-aims a connector at the shapes it is bound to. */
export function routeConnector(
  arrow: BoardElement,
  start: BoardElement | undefined,
  end: BoardElement | undefined,
): BoardElement {
  const pts = worldPoints(arrow);
  if (pts.length < 2 || (!start && !end)) return arrow;
  const n = pts.length;
  if (start) pts[0] = outlinePoint(start, n === 2 && end ? elementCenter(end) : pts[1]);
  if (end) pts[n - 1] = outlinePoint(end, n === 2 && start ? elementCenter(start) : pts[n - 2]);
  return mutate(arrow, withWorldPoints(arrow, pts));
}

/**
 * Restores the scene's invariants after elements in `changed` moved, resized,
 * rotated or had their text edited: connectors bound to them are re-routed and
 * every affected label is laid out again.
 */
export function settle(elements: BoardElement[], changed: Iterable<string>): BoardElement[] {
  const ids = new Set(changed);
  if (!ids.size) return elements;
  const map = indexById(elements);
  const updates = new Map<string, BoardElement>();

  // Labels first: a growing sticky note changes the box its connectors aim at.
  const settleLabelsOf = (id: string) => {
    const container = updates.get(id) ?? map.get(id);
    if (!container) return;
    const text = labelOf(container, map);
    if (!text) return;
    const result = settleLabel(container, updates.get(text.id) ?? text);
    if (result.container !== container) updates.set(container.id, result.container);
    if (result.text !== text) updates.set(text.id, result.text);
  };
  for (const id of ids) {
    const el = map.get(id);
    if (el?.type === "text" && el.containerId) settleLabelsOf(el.containerId);
    else settleLabelsOf(id);
  }

  const touched = new Set([...ids, ...updates.keys()]);
  const view = (id: string) => updates.get(id) ?? map.get(id);
  for (const el of elements) {
    if (!isLinear(el)) continue;
    const startId = el.startBinding?.elementId;
    const endId = el.endBinding?.elementId;
    if (!(startId && touched.has(startId)) && !(endId && touched.has(endId))) continue;
    const routed = routeConnector(
      updates.get(el.id) ?? el,
      startId ? view(startId) : undefined,
      endId ? view(endId) : undefined,
    );
    updates.set(el.id, routed);
    // A connector's label sits at its midpoint, so it follows the new route.
    const label = labelOf(routed, map);
    if (label) updates.set(label.id, settleLabel(routed, updates.get(label.id) ?? label).text);
  }
  return replaceElements(elements, updates);
}

/** Deletes elements along with their labels, and detaches whatever pointed at them. */
export function deleteElements(elements: BoardElement[], ids: Iterable<string>): BoardElement[] {
  const doomed = new Set(ids);
  const map = indexById(elements);
  for (const id of [...doomed]) {
    const el = map.get(id);
    if (!el) continue;
    const label = labelOf(el, map);
    if (label) doomed.add(label.id);
  }
  if (!doomed.size) return elements;
  const out: BoardElement[] = [];
  for (const el of elements) {
    if (doomed.has(el.id)) continue;
    let next = el;
    if (el.boundElements?.some((b) => doomed.has(b.id))) {
      const remaining = el.boundElements.filter((b) => !doomed.has(b.id));
      next = mutate(next, { boundElements: remaining.length ? remaining : null });
    }
    if (el.containerId && doomed.has(el.containerId)) next = mutate(next, { containerId: null });
    if (el.startBinding && doomed.has(el.startBinding.elementId))
      next = mutate(next, { startBinding: null });
    if (el.endBinding && doomed.has(el.endBinding.elementId))
      next = mutate(next, { endBinding: null });
    out.push(next);
  }
  return out;
}

/**
 * Copies elements (with their labels) under fresh ids. References inside the
 * copied set are remapped; references to anything outside it are dropped, so a
 * pasted connector never claims to be attached to a shape it isn't touching.
 */
export function cloneElements(
  source: BoardElement[],
  ids: Iterable<string>,
  offset: Point,
): BoardElement[] {
  const map = indexById(source);
  const chosen = new Set(ids);
  for (const id of [...chosen]) {
    const el = map.get(id);
    const label = el && labelOf(el, map);
    if (label) chosen.add(label.id);
  }
  const idMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  for (const id of chosen) idMap.set(id, randomId());
  const remapGroup = (g: string) => {
    let next = groupMap.get(g);
    if (!next) groupMap.set(g, (next = randomId()));
    return next;
  };
  const clones: BoardElement[] = [];
  for (const el of source) {
    if (!chosen.has(el.id)) continue;
    const bound = el.boundElements
      ?.filter((b) => idMap.has(b.id))
      .map((b) => ({ ...b, id: idMap.get(b.id)! }));
    clones.push(
      mutate(el, {
        id: idMap.get(el.id)!,
        x: el.x + offset[0],
        y: el.y + offset[1],
        groupIds: el.groupIds.map(remapGroup),
        boundElements: bound?.length ? bound : null,
        containerId: el.containerId ? (idMap.get(el.containerId) ?? null) : el.containerId,
        startBinding:
          el.startBinding && idMap.has(el.startBinding.elementId)
            ? { ...el.startBinding, elementId: idMap.get(el.startBinding.elementId)! }
            : el.startBinding === undefined
              ? undefined
              : null,
        endBinding:
          el.endBinding && idMap.has(el.endBinding.elementId)
            ? { ...el.endBinding, elementId: idMap.get(el.endBinding.elementId)! }
            : el.endBinding === undefined
              ? undefined
              : null,
        seed: Math.floor(Math.random() * 2 ** 31),
      }),
    );
  }
  return clones;
}

/** Elements as movable units: a shape and its label always travel together in z-order. */
function units(elements: BoardElement[]) {
  const map = indexById(elements);
  const labels = new Map<string, BoardElement[]>();
  const attached = new Set<string>();
  for (const el of elements) {
    if (el.type === "text" && el.containerId && map.has(el.containerId)) {
      attached.add(el.id);
      const list = labels.get(el.containerId) ?? [];
      list.push(el);
      labels.set(el.containerId, list);
    }
  }
  const out: BoardElement[][] = [];
  for (const el of elements) {
    if (attached.has(el.id)) continue;
    out.push([el, ...(labels.get(el.id) ?? [])]);
  }
  return out;
}

export type ZOrder = "front" | "back" | "forward" | "backward";

export function reorder(elements: BoardElement[], ids: Set<string>, direction: ZOrder) {
  const list = units(elements);
  const selected = (u: BoardElement[]) => ids.has(u[0].id);
  if (direction === "front")
    return [...list.filter((u) => !selected(u)), ...list.filter(selected)].flat();
  if (direction === "back")
    return [...list.filter(selected), ...list.filter((u) => !selected(u))].flat();
  if (direction === "forward") {
    for (let i = list.length - 2; i >= 0; i--) {
      if (selected(list[i]) && !selected(list[i + 1]))
        [list[i], list[i + 1]] = [list[i + 1], list[i]];
    }
  } else {
    for (let i = 1; i < list.length; i++) {
      if (selected(list[i]) && !selected(list[i - 1]))
        [list[i], list[i - 1]] = [list[i - 1], list[i]];
    }
  }
  return list.flat();
}

/** The outermost group an element belongs to (group ids run innermost → outermost). */
export const outerGroup = (el: BoardElement) => el.groupIds[el.groupIds.length - 1];

/** Grows a selection to whole groups, since a grouped element is picked as its group. */
export function expandToGroups(elements: BoardElement[], ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  const groups = new Set<string>();
  const map = indexById(elements);
  for (const id of out) {
    const g = map.get(id) && outerGroup(map.get(id)!);
    if (g) groups.add(g);
  }
  if (!groups.size) return out;
  for (const el of elements) {
    if (el.containerId) continue;
    if (el.groupIds.some((g) => groups.has(g))) out.add(el.id);
  }
  return out;
}

export function groupElements(elements: BoardElement[], ids: Set<string>) {
  const group = randomId();
  const map = indexById(elements);
  const members = new Set(ids);
  for (const id of ids) {
    const label = map.get(id) && labelOf(map.get(id)!, map);
    if (label) members.add(label.id);
  }
  return elements.map((el) =>
    members.has(el.id) ? mutate(el, { groupIds: [...el.groupIds, group] }) : el,
  );
}

export function ungroupElements(elements: BoardElement[], ids: Set<string>) {
  const map = indexById(elements);
  const groups = new Set<string>();
  for (const id of ids) {
    const g = map.get(id) && outerGroup(map.get(id)!);
    if (g) groups.add(g);
  }
  if (!groups.size) return elements;
  return elements.map((el) =>
    el.groupIds.some((g) => groups.has(g))
      ? mutate(el, { groupIds: el.groupIds.filter((g) => !groups.has(g)) })
      : el,
  );
}

/** The topmost shape a connector end dropped at `p` should attach to. */
export function findBindTarget(
  elements: BoardElement[],
  p: Point,
  tolerance: number,
  exclude: Set<string>,
): BoardElement | undefined {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (exclude.has(el.id) || !isBindable(el) || el.locked) continue;
    if (el.type === "image") {
      // A photo is something to annotate: an arrow drawn on it points *at*
      // a spot inside it, so it only attaches when dropped on the photo's rim.
      if (nearBoxEdge(el, p, tolerance * 3)) return el;
      continue;
    }
    if (hitTest(el, p, tolerance, true)) return el;
  }
  return undefined;
}

/** Points one end of a connector at `targetId` (or frees it), keeping both sides' records in step. */
export function bindConnectorEnd(
  elements: BoardElement[],
  arrowId: string,
  end: "start" | "end",
  targetId: string | null,
): BoardElement[] {
  const map = indexById(elements);
  const arrow = map.get(arrowId);
  if (!arrow) return elements;
  const key = end === "start" ? "startBinding" : "endBinding";
  const otherKey = end === "start" ? "endBinding" : "startBinding";
  const previous = arrow[key]?.elementId ?? null;
  if (previous === targetId) return elements;
  const updates = new Map<string, BoardElement>();
  updates.set(
    arrowId,
    mutate(arrow, { [key]: targetId ? { elementId: targetId, focus: 0, gap: 6 } : null }),
  );
  if (previous && arrow[otherKey]?.elementId !== previous) {
    const old = map.get(previous);
    if (old) {
      const remaining = (old.boundElements ?? []).filter((b) => b.id !== arrowId);
      updates.set(previous, mutate(old, { boundElements: remaining.length ? remaining : null }));
    }
  }
  if (targetId) {
    const target = updates.get(targetId) ?? map.get(targetId);
    if (target && !target.boundElements?.some((b) => b.id === arrowId)) {
      updates.set(
        targetId,
        mutate(target, {
          boundElements: [...(target.boundElements ?? []), { id: arrowId, type: "arrow" }],
        }),
      );
    }
  }
  return replaceElements(elements, updates);
}

/** Gives a shape or connector an empty label to type into, or returns the one it has. */
export function ensureLabel(
  elements: BoardElement[],
  containerId: string,
  style: StyleDefaults,
): { elements: BoardElement[]; textId: string } {
  const map = indexById(elements);
  const container = map.get(containerId);
  if (!container) return { elements, textId: "" };
  const existing = labelOf(container, map);
  if (existing) return { elements, textId: existing.id };
  const text = newElement(
    "text",
    {
      x: container.x,
      y: container.y,
      containerId,
      textAlign: "center",
      verticalAlign: "middle",
      strokeColor: isLinear(container) ? container.strokeColor : style.strokeColor,
      groupIds: [...container.groupIds],
    },
    style,
  );
  const withRef = mutate(container, {
    boundElements: [...(container.boundElements ?? []), { id: text.id, type: "text" }],
  });
  const index = elements.findIndex((el) => el.id === containerId);
  const next = [...elements];
  next[index] = withRef;
  next.splice(index + 1, 0, text);
  return { elements: settle(next, [containerId]), textId: text.id };
}
