/**
 * All reader-driven interaction state for one live Mermaid SVG: search,
 * node selection, and isolate/remove views.
 *
 * Owns nothing about rendering — it reads the graph `readGraph` already
 * builds from the DOM and mutates that same DOM (visibility, marks) directly,
 * the same way the colour-override feature does. `onRendered` must be called
 * once per fresh SVG, and *before* `markColorableNodes` runs on it, or a
 * node's `<title>` tooltip text leaks into its label and pollutes search.
 */

import { useRef, useState } from "react";
import type { RefObject } from "react";
import type { SvgViewport } from "@/lib/viewport";
import { readGraph, type ExplainerGraph } from "../explainer/graph";
import { frameFor, homeFrame } from "../explainer/camera";
import { findMatches, type DiagramMatch } from "./diagram-search";
import { neighborsOf, applyVisibility } from "./diagram-isolation";
import { markNode, markEdge, clearMarks } from "./diagram-emphasis";

export interface IsolationInfo {
  visibleIds: Set<string>;
  count: number;
  total: number;
}

export function useDiagramInteraction(viewportRef: RefObject<SvgViewport | null>) {
  const [graphReady, setGraphReady] = useState(false);
  const [query, setQueryState] = useState("");
  const [matches, setMatches] = useState<DiagramMatch[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [selectMode, setSelectModeState] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isolation, setIsolation] = useState<IsolationInfo | null>(null);

  const graphRef = useRef<ExplainerGraph | null>(null);

  function idsForMatch(graph: ExplainerGraph, match: DiagramMatch): string[] {
    if (match.kind === "node") return [match.id];
    const edge = graph.edges.find((candidate) => candidate.id === match.id);
    return edge ? [edge.source, edge.target] : [];
  }

  function markMatch(match: DiagramMatch | null): void {
    const graph = graphRef.current;
    if (!graph) return;
    clearMarks(graph.nodes.values(), graph.edges, "match");
    if (!match) return;
    if (match.kind === "node") {
      const node = graph.nodes.get(match.id);
      if (node) markNode(node, "match");
    } else {
      const edge = graph.edges.find((candidate) => candidate.id === match.id);
      if (edge) markEdge(edge, "match");
    }
  }

  function resetIsolation(): void {
    const graph = graphRef.current;
    if (!graph) return;
    applyVisibility(graph, null);
    viewportRef.current?.setBase(homeFrame(graph));
    setIsolation(null);
  }

  function applyIsolationTo(ids: Set<string>): void {
    const graph = graphRef.current;
    if (!graph || ids.size === 0) return;
    applyVisibility(graph, ids);
    viewportRef.current?.setBase(frameFor(graph, [...ids]));
    setIsolation({ visibleIds: ids, count: ids.size, total: graph.nodes.size });
  }

  function isolateConnected(): void {
    const graph = graphRef.current;
    if (!graph || selectedIds.size === 0) return;
    applyIsolationTo(neighborsOf(graph, selectedIds));
  }

  function isolateSelected(): void {
    if (selectedIds.size === 0) return;
    applyIsolationTo(new Set(selectedIds));
  }

  function removeSelected(): void {
    const graph = graphRef.current;
    if (!graph || selectedIds.size === 0) return;
    const remaining = new Set(graph.nodes.keys());
    for (const id of selectedIds) remaining.delete(id);
    applyIsolationTo(remaining);
  }

  function toggleNode(nodeId: string): void {
    const graph = graphRef.current;
    const node = graph?.nodes.get(nodeId);
    if (!graph || !node) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
        markNode(node, null);
      } else {
        next.add(nodeId);
        markNode(node, "selected");
      }
      return next;
    });
  }

  function setSelectMode(next: boolean): void {
    setSelectModeState(next);
    if (!next) {
      const graph = graphRef.current;
      if (graph) clearMarks(graph.nodes.values(), graph.edges, "selected");
      setSelectedIds(new Set());
    }
  }

  function jumpTo(match: DiagramMatch): void {
    const graph = graphRef.current;
    if (!graph) return;
    // A match hidden by an active isolation has to come back before the
    // camera can show it.
    if (isolation) resetIsolation();
    markMatch(match);
    const ids = idsForMatch(graph, match);
    if (ids.length) viewportRef.current?.frameTo(frameFor(graph, ids));
  }

  function jumpToIndex(index: number): void {
    if (!matches.length) return;
    const wrapped = ((index % matches.length) + matches.length) % matches.length;
    setMatchIndex(wrapped);
    jumpTo(matches[wrapped]);
  }

  function setQuery(next: string): void {
    setQueryState(next);
    const graph = graphRef.current;
    const found = graph ? findMatches(graph, next) : [];
    setMatches(found);
    setMatchIndex(0);
    if (found.length) jumpTo(found[0]);
    else markMatch(null);
  }

  function clearSearch(): void {
    setQueryState("");
    setMatches([]);
    setMatchIndex(0);
    markMatch(null);
  }

  function clearState(): void {
    setQueryState("");
    setMatches([]);
    setMatchIndex(0);
    setSelectModeState(false);
    setSelectedIds(new Set());
    setIsolation(null);
  }

  /** Must run before `markColorableNodes`; see module doc. */
  function onRendered(svg: SVGSVGElement): void {
    const graph = readGraph(svg);
    graphRef.current = graph;
    setGraphReady(Boolean(graph && !graph.sequence));
    clearState();
  }

  /**
   * The SVG is about to be torn down or replaced (the diagram source, theme,
   * or colouring changed). Called synchronously so the UI never shows
   * selection/isolation state pointing at elements that no longer exist,
   * ahead of the next `onRendered` once the new SVG is ready.
   */
  function discardGraph(): void {
    graphRef.current = null;
    setGraphReady(false);
    clearState();
  }

  return {
    graphReady,
    onRendered,
    discardGraph,
    search: {
      query,
      setQuery,
      matchCount: matches.length,
      index: matchIndex,
      next: () => jumpToIndex(matchIndex + 1),
      prev: () => jumpToIndex(matchIndex - 1),
      clear: clearSearch,
    },
    selectMode,
    setSelectMode,
    selectedIds,
    toggleNode,
    isolation,
    isolateConnected,
    isolateSelected,
    removeSelected,
    resetIsolation,
  };
}
