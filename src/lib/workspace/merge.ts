import { sameData } from "./binary.ts";
// Three-way merge of workspace snapshots.
//
// Storage refuses a write whose expected revision is stale (see persistence.ts).
// Most refusals are not real conflicts: another tab recorded which document it
// has open, starred something, or edited a different file. Refusing all of them
// would put a conflict prompt in front of anyone with two tabs open.
//
// Given the snapshot this tab last reconciled with (`base`), this tab's current
// state (`mine`) and what storage now holds (`theirs`), each record is taken
// from whichever side changed it. Only a record both sides changed differently
// — or one side changed while the other deleted it — is a conflict, and then
// nothing is merged: the caller keeps both versions instead of guessing.

import type { FolderRecord, PersistedFile, WorkspaceRecord } from "./persistence";

type Keyed = { id: string };

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

function sameFile(a: PersistedFile, b: PersistedFile): boolean {
  return (
    a === b ||
    (a.name === b.name &&
      a.content === b.content &&
      sameData(a.data, b.data) &&
      a.mimeType === b.mimeType &&
      a.size === b.size &&
      a.addedAt === b.addedAt &&
      a.kind === b.kind &&
      (a.folderId ?? null) === (b.folderId ?? null) &&
      (a.deletedAt ?? null) === (b.deletedAt ?? null) &&
      same(a.derivedFrom, b.derivedFrom))
  );
}

class MergeConflict extends Error {}

/** Merge one keyed collection; returns records in `order`-then-new order. */
function mergeKeyed<T extends Keyed>(
  base: readonly T[],
  mine: readonly T[],
  theirs: readonly T[],
  equal: (a: T, b: T) => boolean,
): T[] {
  const b = new Map(base.map((item) => [item.id, item]));
  const m = new Map(mine.map((item) => [item.id, item]));
  const t = new Map(theirs.map((item) => [item.id, item]));
  const pick = (id: string): T | undefined => {
    const [inBase, inMine, inTheirs] = [b.get(id), m.get(id), t.get(id)];
    if (!inBase) {
      // Added on one side, or independently on both with the same id.
      if (inMine && inTheirs && !equal(inMine, inTheirs)) throw new MergeConflict(id);
      return inMine ?? inTheirs;
    }
    const mineChanged = !inMine || !equal(inBase, inMine);
    const theirsChanged = !inTheirs || !equal(inBase, inTheirs);
    if (!mineChanged) return inTheirs;
    if (!theirsChanged) return inMine;
    if (inMine && inTheirs && equal(inMine, inTheirs)) return inMine;
    if (!inMine && !inTheirs) return undefined;
    throw new MergeConflict(id);
  };
  const out: T[] = [];
  const seen = new Set<string>();
  for (const id of [...m.keys(), ...t.keys()]) {
    if (seen.has(id)) continue;
    seen.add(id);
    const item = pick(id);
    if (item) out.push(item);
  }
  // Deleted on both sides, or deleted on one and untouched on the other, is
  // handled by `pick` returning undefined; ids only in `base` need a check too.
  for (const id of b.keys()) {
    if (seen.has(id)) continue;
    if (pick(id)) throw new MergeConflict(id);
  }
  return out;
}

function mergeValue<T>(base: T, mine: T, theirs: T): T {
  if (same(base, mine)) return theirs;
  return mine;
}

/**
 * Merge `mine` onto `theirs`, or return null when the same record was changed
 * differently on both sides. The result carries `theirs.revision`, so writing
 * it is checked against exactly what was merged.
 */
export function mergeWorkspaces(
  base: WorkspaceRecord,
  mine: WorkspaceRecord,
  theirs: WorkspaceRecord,
): WorkspaceRecord | null {
  try {
    const files = mergeKeyed(base.files, mine.files, theirs.files, sameFile);
    const live = new Set(files.map((file) => file.id));
    const folders = mergeKeyed<FolderRecord>(
      base.folders ?? [],
      mine.folders ?? [],
      theirs.folders ?? [],
      same,
    );
    const saved = mergeKeyed(base.saved ?? [], mine.saved ?? [], theirs.saved ?? [], same);
    const highlights = mergeKeyed(
      base.highlights ?? [],
      mine.highlights ?? [],
      theirs.highlights ?? [],
      same,
    );
    // Notes outlive their source document, so unlike stars and highlights
    // they are not filtered to live files below.
    const notes = mergeKeyed(base.notes ?? [], mine.notes ?? [], theirs.notes ?? [], same);
    // Rough work likewise belongs to the reader, not to a document.
    const scratchpads = mergeKeyed(
      base.scratchpads ?? [],
      mine.scratchpads ?? [],
      theirs.scratchpads ?? [],
      same,
    );
    const asKeyed = (list: string[]) => list.map((id) => ({ id }));
    const bookmarks = mergeKeyed(
      asKeyed(base.bookmarks),
      asKeyed(mine.bookmarks),
      asKeyed(theirs.bookmarks),
      () => true,
    ).map((item) => item.id);

    // This tab's order first; documents the other tab added keep its order
    // and follow.
    const order = [
      ...(mine.ui.fileOrder ?? mine.files.map((file) => file.id)),
      ...(theirs.ui.fileOrder ?? theirs.files.map((file) => file.id)),
    ].filter((id, index, all) => live.has(id) && all.indexOf(id) === index);
    const position = new Map(order.map((id, index) => [id, index]));
    files.sort((a, b) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity));

    const keepLive = (ids: string[] | undefined) => ids?.filter((id) => live.has(id));
    return {
      ...mine,
      revision: theirs.revision,
      name: mergeValue(base.name, mine.name, theirs.name),
      updatedAt: Math.max(mine.updatedAt, theirs.updatedAt),
      files,
      folders,
      saved: saved.filter((item) => live.has(item.fileId)),
      highlights: highlights.filter((item) => live.has(item.fileId)),
      notes,
      scratchpads,
      bookmarks,
      // View state belongs to the tab showing it; only drop what no longer exists.
      ui: {
        ...mine.ui,
        activeFileId:
          mine.ui.activeFileId && live.has(mine.ui.activeFileId) ? mine.ui.activeFileId : null,
        fileOrder: files.map((file) => file.id),
        recentFileIds: keepLive(mine.ui.recentFileIds),
        panes: mine.ui.panes?.map((pane) => ({
          ...pane,
          tabs: pane.tabs.filter((id) => live.has(id)),
          activeTabId: pane.activeTabId && live.has(pane.activeTabId) ? pane.activeTabId : null,
        })),
      },
    };
  } catch (error) {
    if (error instanceof MergeConflict) return null;
    throw error;
  }
}
