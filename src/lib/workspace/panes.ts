// The split view's state, kept as plain data so the reducer-ish operations
// below can be reasoned about (and tested) without a component in the way.
//
// Panes own their tabs. The rest of the app still asks "what is the active
// file?" and gets one answer — derived from whichever pane has focus — so the
// sidebar, the palette, stars and the nav trail need no notion of panes at all.

import type { PersistedPane } from "./persistence";

export interface Pane {
  id: string;
  /** File ids, in tab order. */
  tabs: string[];
  activeTabId: string | null;
}

export interface PaneLayout {
  panes: Pane[];
  focusedPaneId: string | null;
}

export const newPaneId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `pane-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** The layout a workspace starts with: one pane, holding whatever was open. */
export function singlePane(activeFileId: string | null): PaneLayout {
  const pane: Pane = {
    id: newPaneId(),
    tabs: activeFileId ? [activeFileId] : [],
    activeTabId: activeFileId,
  };
  return { panes: [pane], focusedPaneId: pane.id };
}

/**
 * Rebuild a layout from what was persisted, dropping tabs whose files are gone.
 *
 * A workspace written before panes existed has none, and a workspace whose
 * panes all emptied out is not a workspace with no panes — both fall back to a
 * single pane so the reader is never left with nothing to read into.
 */
export function hydratePanes(
  persisted: PersistedPane[] | undefined,
  focusedPaneId: string | null | undefined,
  liveFileIds: Set<string>,
  activeFileId: string | null,
): PaneLayout {
  const panes = (persisted ?? [])
    .map((pane) => {
      const tabs = pane.tabs.filter((id) => liveFileIds.has(id));
      const activeTabId =
        pane.activeTabId && tabs.includes(pane.activeTabId) ? pane.activeTabId : (tabs[0] ?? null);
      return { id: pane.id, tabs, activeTabId };
    })
    .filter((pane) => pane.tabs.length > 0);

  if (panes.length === 0) {
    return singlePane(activeFileId && liveFileIds.has(activeFileId) ? activeFileId : null);
  }
  const focused = panes.some((p) => p.id === focusedPaneId) ? focusedPaneId! : panes[0].id;
  return { panes, focusedPaneId: focused };
}

/** The file the app as a whole considers active: the focused pane's tab. */
export function activeFileOf(layout: PaneLayout): string | null {
  const pane = layout.panes.find((p) => p.id === layout.focusedPaneId);
  return pane?.activeTabId ?? null;
}

/** Open a file in the focused pane (or `paneId`), adding a tab if needed. */
export function openInPane(layout: PaneLayout, fileId: string, paneId?: string): PaneLayout {
  const targetId = paneId ?? layout.focusedPaneId ?? layout.panes[0]?.id;
  if (!targetId) return { ...singlePane(fileId) };
  return {
    panes: layout.panes.map((pane) =>
      pane.id === targetId
        ? {
            ...pane,
            tabs: pane.tabs.includes(fileId) ? pane.tabs : [...pane.tabs, fileId],
            activeTabId: fileId,
          }
        : pane,
    ),
    focusedPaneId: targetId,
  };
}

/**
 * Bring a file to the front wherever it is already open, and only open it in
 * the focused pane when no pane is showing it.
 *
 * Opening it into the focused pane unconditionally is what let one document
 * appear in two columns at once: the sidebar's actions address a file by id,
 * so every copy answered to them together — clicking "Edit" on a document
 * sitting beside the focused one dropped *both* columns into the editor.
 * Following the document to its own column keeps one file to one pane.
 */
export function revealInPane(layout: PaneLayout, fileId: string): PaneLayout {
  const focused = layout.panes.find((pane) => pane.id === layout.focusedPaneId);

  // A pane *showing* the document wins over one merely holding it as a
  // background tab — including over the focused pane. Panes accumulate tabs,
  // so the column the reader is working in is quite likely to still carry the
  // file from whenever it was last opened there; preferring that stale tab is
  // what put the same document in two columns at once even after the file had
  // been split out into a column of its own.
  const showing =
    focused?.activeTabId === fileId
      ? focused
      : layout.panes.find((pane) => pane.activeTabId === fileId);
  // Failing that, a background tab: the focused pane's first, so opening a
  // document it already carries doesn't send the reader to another column.
  const holder =
    showing ??
    (focused?.tabs.includes(fileId)
      ? focused
      : layout.panes.find((pane) => pane.tabs.includes(fileId)));

  return openInPane(layout, fileId, holder?.id);
}

/**
 * Close one tab.
 *
 * Emptying a pane closes the pane itself — except the last one, which stays as
 * an empty reading column rather than leaving the app with nowhere to open a
 * document into.
 */
export function closeTab(layout: PaneLayout, paneId: string, fileId: string): PaneLayout {
  const panes: Pane[] = [];
  for (const pane of layout.panes) {
    if (pane.id !== paneId) {
      panes.push(pane);
      continue;
    }
    const index = pane.tabs.indexOf(fileId);
    const tabs = pane.tabs.filter((id) => id !== fileId);
    if (tabs.length === 0 && layout.panes.length > 1) continue;
    const activeTabId =
      pane.activeTabId === fileId
        ? (tabs[Math.min(index, tabs.length - 1)] ?? null)
        : pane.activeTabId;
    panes.push({ ...pane, tabs, activeTabId });
  }
  if (panes.length === 0) return singlePane(null);
  const focusedPaneId = panes.some((p) => p.id === layout.focusedPaneId)
    ? layout.focusedPaneId
    : panes[0].id;
  return { panes, focusedPaneId };
}

/**
 * Close a set of documents wherever they are open.
 *
 * For documents that have stopped existing in this workspace — binned, or moved
 * out to another one. A pane left holding a tab whose file is gone renders an
 * empty column the reader cannot close by any obvious means, so the layout has
 * to be told, and the same file can be open in several panes at once.
 *
 * Built on `closeTab` rather than filtering the tab arrays directly so the
 * fiddly parts — which tab becomes active when the closed one was active, a
 * pane that empties collapsing, focus following a collapsed pane — stay defined
 * in exactly one place.
 */
export function closeFileEverywhere(layout: PaneLayout, fileIds: readonly string[]): PaneLayout {
  const closing = new Set(fileIds);
  if (closing.size === 0) return layout;
  let next = layout;
  for (const fileId of closing) {
    // Re-read the panes each time: closing a tab can collapse a pane, so the
    // list from the previous iteration may name one that no longer exists.
    for (const pane of next.panes.filter((candidate) => candidate.tabs.includes(fileId))) {
      next = closeTab(next, pane.id, fileId);
    }
  }
  return next;
}

/** Split: a new pane beside `paneId`, showing `fileId`. */
export function splitPane(layout: PaneLayout, paneId: string, fileId: string | null): PaneLayout {
  const index = layout.panes.findIndex((p) => p.id === paneId);
  if (index === -1) return layout;
  const source = layout.panes[index];
  const seed = fileId ?? source.activeTabId;
  const pane: Pane = {
    id: newPaneId(),
    tabs: seed ? [seed] : [],
    activeTabId: seed,
  };
  const panes = [...layout.panes];
  panes.splice(index + 1, 0, pane);
  return { panes, focusedPaneId: pane.id };
}

/**
 * Move a tab between panes, or within one, at `toIndex`.
 *
 * This is the drag. A tab dropped onto its own pane is a reorder; dropped onto
 * another it leaves the first — and if that empties the source pane, the pane
 * goes with it, the same as closing its last tab.
 */
export function moveTab(
  layout: PaneLayout,
  fromPaneId: string,
  fileId: string,
  toPaneId: string,
  toIndex?: number,
): PaneLayout {
  if (!layout.panes.some((p) => p.id === toPaneId)) return layout;

  let panes = layout.panes.map((pane) =>
    pane.id === fromPaneId
      ? {
          ...pane,
          tabs: pane.tabs.filter((id) => id !== fileId),
          activeTabId:
            pane.activeTabId === fileId
              ? (pane.tabs.filter((id) => id !== fileId)[0] ?? null)
              : pane.activeTabId,
        }
      : pane,
  );

  panes = panes.map((pane) => {
    if (pane.id !== toPaneId) return pane;
    const tabs = pane.tabs.filter((id) => id !== fileId);
    const at = toIndex === undefined ? tabs.length : Math.max(0, Math.min(toIndex, tabs.length));
    tabs.splice(at, 0, fileId);
    return { ...pane, tabs, activeTabId: fileId };
  });

  // A source pane emptied by the move disappears, unless it is all there is.
  const kept = panes.filter((pane) => pane.tabs.length > 0);
  const finalPanes = kept.length > 0 ? kept : [{ ...panes[0], tabs: [], activeTabId: null }];
  return { panes: finalPanes, focusedPaneId: toPaneId };
}

/** Strip to the persisted shape. */
export function toPersisted(layout: PaneLayout): PersistedPane[] {
  return layout.panes.map((pane) => ({
    id: pane.id,
    tabs: pane.tabs,
    activeTabId: pane.activeTabId,
  }));
}
