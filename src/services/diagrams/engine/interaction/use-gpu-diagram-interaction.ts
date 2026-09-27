/**
 * All reader-driven interaction state for one loaded GPU-engine `Scene`:
 * search, node selection, and isolate/remove views.
 *
 * The GPU-path analogue of `interaction/use-diagram-interaction.ts`. Same
 * state machine and the same shared `DiagramInteractionApi` shape (so
 * `DiagramInteractionBar.tsx` drives this stage unchanged), but every
 * mutation goes through the renderer's state textures instead of the DOM —
 * there is no DOM here. `onReady` must be called once layout finishes, and
 * `discardGraph` when the scene is about to be torn down or replaced.
 */

import { useRef, useState } from "react";
import type { RefObject } from "react";
import type { SvgViewport } from "@/lib/viewport";
import { frameFor, homeFrame } from "../../explainer/camera";
import { neighborsOf } from "../../interaction/diagram-isolation";
import type { DiagramMatch, IsolationInfo } from "../../interaction/types";
import type { DiagramRenderer } from "../renderer";
import type { Scene } from "../scene";
import { findGpuMatches } from "./gpu-search";
import { applyGpuSelectionPreview, applyGpuVisibility } from "./gpu-isolation";
import { createPulser } from "./gpu-pulse";

export function useGpuDiagramInteraction(viewportRef: RefObject<SvgViewport | null>) {
  const [graphReady, setGraphReady] = useState(false);
  const [query, setQueryState] = useState("");
  const [matches, setMatches] = useState<DiagramMatch[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [selectMode, setSelectModeState] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isolation, setIsolation] = useState<IsolationInfo | null>(null);

  const rendererRef = useRef<DiagramRenderer | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const pulserRef = useRef<ReturnType<typeof createPulser> | null>(null);

  function resetIsolation(): void {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    if (!renderer || !scene) return;
    applyGpuVisibility(renderer, scene, null);
    viewportRef.current?.setBase(homeFrame(scene.graph));
    setIsolation(null);
  }

  function applyIsolationTo(ids: Set<string>): void {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    if (!renderer || !scene || ids.size === 0) return;
    applyGpuVisibility(renderer, scene, ids);
    viewportRef.current?.setBase(frameFor(scene.graph, [...ids]));
    setIsolation({ visibleIds: ids, count: ids.size, total: scene.graph.nodes.size });
  }

  function isolateConnected(): void {
    const scene = sceneRef.current;
    if (!scene || selectedIds.size === 0) return;
    applyIsolationTo(neighborsOf(scene.graph, selectedIds));
  }

  function isolateSelected(): void {
    if (selectedIds.size === 0) return;
    applyIsolationTo(new Set(selectedIds));
  }

  function removeSelected(): void {
    const scene = sceneRef.current;
    if (!scene || selectedIds.size === 0) return;
    const remaining = new Set(scene.graph.nodes.keys());
    for (const id of selectedIds) remaining.delete(id);
    applyIsolationTo(remaining);
  }

  /** Dim everyone but the selection, as feedback while still choosing —
   *  skipped while isolated, where visibility already means something. */
  function previewSelection(next: Set<string>): void {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    if (!renderer || !scene || isolation) return;
    applyGpuSelectionPreview(renderer, scene, next);
  }

  function toggleNode(nodeId: string): void {
    const scene = sceneRef.current;
    if (!scene || !scene.nodeIndex.has(nodeId)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      previewSelection(next);
      return next;
    });
  }

  function setSelectMode(next: boolean): void {
    setSelectModeState(next);
    if (!next) {
      setSelectedIds(new Set());
      previewSelection(new Set());
    }
  }

  /** No-ops unless select mode is on; hit-tests the click and toggles
   *  whichever node (if any) it landed on. */
  function handleNodeClick(clientX: number, clientY: number): void {
    if (!selectMode) return;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    if (!renderer || !scene) return;
    const index = renderer.hitTest(clientX, clientY);
    if (index === null) return;
    for (const [id, candidate] of scene.nodeIndex) {
      if (candidate === index) {
        toggleNode(id);
        return;
      }
    }
  }

  function jumpTo(match: DiagramMatch): void {
    const scene = sceneRef.current;
    if (!scene) return;
    // A match hidden by an active isolation has to come back before the
    // camera can show it.
    if (isolation) resetIsolation();
    const nodeIds =
      match.kind === "node"
        ? [match.id]
        : (() => {
            const edge = scene.graph.edges.find((candidate) => candidate.id === match.id);
            return edge ? [edge.source, edge.target] : [];
          })();
    if (nodeIds.length) viewportRef.current?.frameTo(frameFor(scene.graph, nodeIds));
    // A message has no pulse channel of its own; flashing the node nearest
    // it is close enough to say "here" for an edge match.
    pulserRef.current?.pulse(nodeIds[0] ?? match.id);
  }

  function jumpToIndex(index: number): void {
    if (!matches.length) return;
    const wrapped = ((index % matches.length) + matches.length) % matches.length;
    setMatchIndex(wrapped);
    jumpTo(matches[wrapped]);
  }

  function setQuery(next: string): void {
    setQueryState(next);
    const scene = sceneRef.current;
    const found = scene ? findGpuMatches(scene, next) : [];
    setMatches(found);
    setMatchIndex(0);
    if (found.length) jumpTo(found[0]);
    else pulserRef.current?.stop();
  }

  function clearSearch(): void {
    setQueryState("");
    setMatches([]);
    setMatchIndex(0);
    pulserRef.current?.stop();
  }

  function clearState(): void {
    setQueryState("");
    setMatches([]);
    setMatchIndex(0);
    setSelectModeState(false);
    setSelectedIds(new Set());
    setIsolation(null);
  }

  /** Called once the renderer and its scene are ready. */
  function onReady(renderer: DiagramRenderer, scene: Scene): void {
    rendererRef.current = renderer;
    sceneRef.current = scene;
    pulserRef.current = createPulser(renderer, scene);
    setGraphReady(true);
    clearState();
  }

  /** The renderer/scene are about to be torn down or replaced. */
  function discardGraph(): void {
    pulserRef.current?.stop();
    pulserRef.current = null;
    rendererRef.current = null;
    sceneRef.current = null;
    setGraphReady(false);
    clearState();
  }

  return {
    graphReady,
    onReady,
    discardGraph,
    handleNodeClick,
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
