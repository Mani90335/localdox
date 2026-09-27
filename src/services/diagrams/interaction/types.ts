/**
 * Shapes shared between the SVG-backed interaction hook
 * (`use-diagram-interaction.ts`) and the GPU-engine one
 * (`engine/interaction/use-gpu-diagram-interaction.ts`).
 *
 * `DiagramInteractionApi` is deliberately just the read+action surface
 * `DiagramInteractionBar.tsx` consumes — not each hook's own wiring methods
 * (`onRendered`/`onReady`/`discardGraph`/click handling), which differ
 * because one renderer is a DOM and the other is a WebGL canvas. Keeping the
 * UI typed against this narrower interface is what lets the same component
 * drive either stage unchanged.
 */

export interface DiagramMatch {
  kind: "node" | "edge";
  id: string;
}

export interface IsolationInfo {
  visibleIds: Set<string>;
  count: number;
  total: number;
}

export interface DiagramSearchApi {
  query: string;
  setQuery(next: string): void;
  matchCount: number;
  index: number;
  next(): void;
  prev(): void;
  clear(): void;
}

export interface DiagramInteractionApi {
  graphReady: boolean;
  search: DiagramSearchApi;
  selectMode: boolean;
  setSelectMode(next: boolean): void;
  selectedIds: Set<string>;
  toggleNode(nodeId: string): void;
  isolation: IsolationInfo | null;
  isolateConnected(): void;
  isolateSelected(): void;
  removeSelected(): void;
  resetIsolation(): void;
}
