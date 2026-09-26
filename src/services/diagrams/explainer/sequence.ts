/**
 * Reads a rendered Mermaid sequence diagram into the same shape the player
 * animates.
 *
 * A sequence diagram is not a node graph, which is why the flowchart reader
 * rejects it: there are no `g.node` elements and no `path.flowchart-link`.
 * What it has is a cast of participants along the top and a column of messages
 * running down the page, and *that* is the thing worth walking — a protocol is
 * explained message by message, in time order, which is exactly how someone
 * would narrate it at a whiteboard.
 *
 * So the mapping is: participants become nodes, messages become edges, and the
 * plan is already chronological because Mermaid emits the messages in document
 * order down the Y axis.
 */

import type { ExplainerEdge, ExplainerGraph, ExplainerNode } from "./graph";

/** Mermaid's message classes: 0 is a solid line, 1 dashed (a reply). */
const MESSAGE_SELECTOR =
  "line.messageLine0, line.messageLine1, path.messageLine0, path.messageLine1";

/** True when this SVG is a sequence diagram rather than a node graph. */
export function isSequenceDiagram(svg: SVGSVGElement): boolean {
  return svg.getAttribute("aria-roledescription") === "sequence";
}

function centerX(el: Element): number {
  const x = parseFloat(el.getAttribute("x") ?? "NaN");
  const width = parseFloat(el.getAttribute("width") ?? "0");
  if (!Number.isNaN(x)) return x + width / 2;
  const x1 = parseFloat(el.getAttribute("x1") ?? "NaN");
  return Number.isNaN(x1) ? 0 : x1;
}

/**
 * Build the graph.
 *
 * Participants are read from the top actor boxes, which carry the name; the
 * bottom row repeats them and is ignored. Each message is matched to the two
 * participants nearest its endpoints in X, because Mermaid draws a message as
 * a horizontal line spanning exactly the two lifelines it connects.
 */
export function readSequence(svg: SVGSVGElement): ExplainerGraph | null {
  const view = svg.viewBox.baseVal;
  const baseView = { x: view.x, y: view.y, width: view.width, height: view.height };

  const nodes = new Map<string, ExplainerNode>();
  const lanes: { node: ExplainerNode; x: number }[] = [];

  // The top actor row is the cast list. `actor-top` is the box; the matching
  // `text.actor-box` inside the same group carries the display name.
  const boxes = [...svg.querySelectorAll<SVGRectElement>("rect.actor-top")];
  boxes.forEach((box, index) => {
    const group = box.parentElement as SVGGElement | null;
    const label =
      group?.querySelector("text.actor-box")?.textContent?.trim() ??
      box.nextElementSibling?.textContent?.trim() ??
      `Participant ${index + 1}`;
    const x = centerX(box);
    const y = parseFloat(box.getAttribute("y") ?? "0");
    const width = parseFloat(box.getAttribute("width") ?? "0");
    const height = parseFloat(box.getAttribute("height") ?? "0");
    const id = group?.id || `${svg.id}-actor-${index}`;
    if (group && !group.id) group.id = id;
    const node: ExplainerNode = {
      id,
      key: label,
      label,
      // The group is what gets faded in; falling back to the box keeps the
      // reveal working even when Mermaid changes its wrapper.
      el: (group ?? box) as SVGGElement,
      x,
      y: y + height / 2,
      width,
      height,
    };
    nodes.set(id, node);
    lanes.push({ node, x });
  });

  if (lanes.length === 0) return null;

  const nearestLane = (x: number) =>
    lanes.reduce((best, lane) => (Math.abs(lane.x - x) < Math.abs(best.x - x) ? lane : best)).node;

  // Messages, in the order Mermaid emitted them — which is the order they
  // happen. Their labels sit in a parallel `text.messageText` list.
  const messages = [...svg.querySelectorAll<SVGGeometryElement>(MESSAGE_SELECTOR)];
  const texts = [...svg.querySelectorAll<SVGTextElement>("text.messageText")];

  const edges: ExplainerEdge[] = [];
  messages.forEach((line, index) => {
    const x1 = parseFloat(line.getAttribute("x1") ?? "NaN");
    const x2 = parseFloat(line.getAttribute("x2") ?? "NaN");
    let source: ExplainerNode;
    let target: ExplainerNode;
    if (!Number.isNaN(x1) && !Number.isNaN(x2)) {
      source = nearestLane(x1);
      target = nearestLane(x2);
    } else {
      // A curved self-message is a path; both ends land on one lifeline.
      let start: DOMPoint;
      let end: DOMPoint;
      try {
        const length = line.getTotalLength();
        start = line.getPointAtLength(0);
        end = line.getPointAtLength(length);
      } catch {
        return;
      }
      source = nearestLane(start.x);
      target = nearestLane(end.x);
    }
    // A self-call is real and worth showing, but it has no second participant
    // to reveal, so it is recorded as a revisit of its own lane.
    let length = 0;
    try {
      length = line.getTotalLength();
    } catch {
      length = Math.abs((Number.isNaN(x2) ? 0 : x2) - (Number.isNaN(x1) ? 0 : x1));
    }
    edges.push({
      id: line.id || `${svg.id}-msg-${index}`,
      sourceKey: source.key,
      targetKey: target.key,
      source: source.id,
      target: target.id,
      path: line as unknown as SVGPathElement,
      label: (texts[index] as unknown as SVGGElement) ?? null,
      length,
    });
  });

  if (edges.length === 0) return null;
  return { nodes, edges, clusters: [], svg, baseView, sequence: true };
}

/**
 * The order to walk a sequence diagram in.
 *
 * Unlike a flowchart, this is not a traversal problem: the diagram is already
 * a timeline, so the steps are simply "show the cast, then play the messages
 * in order". Participants are revealed up front because a message arriving at
 * an unnamed lifeline reads as a message to nowhere — the lifelines are the
 * stage, not the story.
 */
export function isSequenceGraph(graph: ExplainerGraph): boolean {
  return isSequenceDiagram(graph.svg);
}
