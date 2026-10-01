/**
 * Moving documents and folders from one workspace into another.
 *
 * A workspace is a closed world: file ids, folder ids, stars and highlights all
 * only mean anything relative to the record that holds them. So a "move" is not
 * a pointer change, it is a transplant — the selected records are rewritten into
 * the destination and removed from the source, and everything that referred to
 * them by id has to be carried across or it is silently lost.
 *
 * Three things make that non-trivial, and they are the reason this is a module
 * with tests rather than a callback in the sidebar:
 *
 *  - **Folders are subtrees.** Moving a folder means moving its descendants and
 *    the documents filed anywhere inside it, not just the one row that was
 *    clicked.
 *  - **Ids can collide.** Both workspaces mint ids with `crypto.randomUUID`, so
 *    a collision is vanishingly unlikely — but a document duplicated between
 *    workspaces through an import or a share link is not, and it carries its
 *    original id. Colliding ids are reassigned, and every reference to them is
 *    rewritten to match.
 *  - **Stars, highlights and notes hang off file ids.** They live in the
 *    workspace record beside the files rather than inside them, so they have
 *    to be moved explicitly. Left behind, the reader's annotations vanish with
 *    no warning — and a note's source link would point at nothing.
 *
 * The planning half is pure and exhaustively testable; `persistence` is only
 * touched by the caller that applies the result.
 */

import type { FolderRecord, PersistedFile, WorkspaceRecord } from "./persistence";
import type { SavedItem } from "./saved-items";
import type { Highlight } from "../markdown/dom-highlighter";
import type { Note } from "./notes";

/** What the reader picked in the sidebar. */
export interface TransferSelection {
  fileIds: readonly string[];
  folderIds: readonly string[];
}

export interface TransferPlan {
  /** Files to write into the destination, ids and `folderId` already resolved. */
  files: PersistedFile[];
  /** Folders to write into the destination, ids and `parentId` already resolved. */
  folders: FolderRecord[];
  saved: SavedItem[];
  highlights: Highlight[];
  /** Notes copied from the moving documents — they follow their source. */
  notes: Note[];
  /** Ids to drop from the source — expanded to include folder descendants. */
  removeFileIds: Set<string>;
  removeFolderIds: Set<string>;
  /** Files whose id collided in the destination and was reassigned. */
  renamedFileIds: Map<string, string>;
}

/** A summary for the confirmation and the toast. */
export interface TransferCounts {
  files: number;
  folders: number;
  saved: number;
  highlights: number;
}

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Every folder in the selection, plus everything nested under it.
 *
 * Selecting a folder means selecting what is in it — a reader who moves
 * "Research" and finds its three sub-folders left behind in the old workspace,
 * now empty and orphaned, has been given a broken result rather than a partial
 * one.
 */
export function expandFolderIds(
  folders: readonly FolderRecord[],
  selected: readonly string[],
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const folder of folders) {
    const parent = folder.parentId ?? null;
    if (parent === null) continue;
    const siblings = childrenOf.get(parent);
    if (siblings) siblings.push(folder.id);
    else childrenOf.set(parent, [folder.id]);
  }

  const out = new Set<string>();
  const queue = [...selected];
  while (queue.length) {
    const id = queue.pop()!;
    // The guard also breaks a parent cycle, which a corrupted record could
    // contain and which would otherwise hang the move.
    if (out.has(id)) continue;
    out.add(id);
    for (const child of childrenOf.get(id) ?? []) queue.push(child);
  }
  return out;
}

/**
 * Plan a move, without touching storage.
 *
 * `destinationParentId` is the folder in the destination the selection lands
 * in, or null for its top level. Selected folders keep their shape under it;
 * selected files that were inside a *non*-selected folder are flattened to that
 * landing point, because the folder they referred to is not coming with them.
 */
export function planTransfer(
  source: Pick<WorkspaceRecord, "files" | "folders" | "saved" | "highlights" | "notes">,
  destination: Pick<WorkspaceRecord, "files" | "folders">,
  selection: TransferSelection,
  destinationParentId: string | null = null,
): TransferPlan {
  const sourceFolders = source.folders ?? [];
  const movingFolderIds = expandFolderIds(sourceFolders, selection.folderIds);

  // A file moves when it was picked directly, or when it sits anywhere inside a
  // folder that was picked.
  const picked = new Set(selection.fileIds);
  const movingFiles = source.files.filter(
    (file) => picked.has(file.id) || (file.folderId ? movingFolderIds.has(file.folderId) : false),
  );

  const takenFolderIds = new Set((destination.folders ?? []).map((folder) => folder.id));
  const takenFileIds = new Set(destination.files.map((file) => file.id));

  // Reassign only what actually collides: keeping ids stable where possible
  // means a document that is moved and moved back is still the same document,
  // and its stars re-attach.
  const folderIdMap = new Map<string, string>();
  for (const id of movingFolderIds) folderIdMap.set(id, takenFolderIds.has(id) ? newId() : id);

  const renamedFileIds = new Map<string, string>();
  const fileIdMap = new Map<string, string>();
  for (const file of movingFiles) {
    if (takenFileIds.has(file.id)) {
      const replacement = newId();
      fileIdMap.set(file.id, replacement);
      renamedFileIds.set(file.id, replacement);
    } else {
      fileIdMap.set(file.id, file.id);
    }
  }

  const folders: FolderRecord[] = sourceFolders
    .filter((folder) => movingFolderIds.has(folder.id))
    .map((folder) => {
      const parent = folder.parentId ?? null;
      return {
        ...folder,
        id: folderIdMap.get(folder.id)!,
        // A folder whose parent is also moving keeps that parent; one whose
        // parent stays behind becomes a child of the landing point, since the
        // parent it named does not exist in the destination.
        parentId:
          parent && movingFolderIds.has(parent) ? folderIdMap.get(parent)! : destinationParentId,
      };
    });

  const files: PersistedFile[] = movingFiles.map((file) => {
    const folder = file.folderId ?? null;
    return {
      ...file,
      id: fileIdMap.get(file.id)!,
      folderId:
        folder && movingFolderIds.has(folder) ? folderIdMap.get(folder)! : destinationParentId,
    };
  });

  // Annotations follow their document. Rewritten through the same id map, so a
  // file that had to be renumbered keeps its stars rather than dropping them.
  const saved = (source.saved ?? [])
    .filter((item) => fileIdMap.has(item.fileId))
    .map((item) => ({ ...item, fileId: fileIdMap.get(item.fileId)! }));
  const highlights = (source.highlights ?? [])
    .filter((item) => fileIdMap.has(item.fileId))
    .map((item) => ({ ...item, fileId: fileIdMap.get(item.fileId)! }));
  const notes = (source.notes ?? [])
    .filter((item) => fileIdMap.has(item.fileId))
    .map((item) => ({ ...item, fileId: fileIdMap.get(item.fileId)! }));

  return {
    files,
    folders,
    saved,
    highlights,
    notes,
    removeFileIds: new Set(movingFiles.map((file) => file.id)),
    removeFolderIds: movingFolderIds,
    renamedFileIds,
  };
}

export function transferCounts(plan: TransferPlan): TransferCounts {
  return {
    files: plan.files.length,
    folders: plan.folders.length,
    saved: plan.saved.length,
    highlights: plan.highlights.length,
  };
}

/**
 * Apply a plan to the destination record.
 *
 * Returns a new record rather than mutating, so the caller can commit it in
 * the same transaction as `removeFromSource` — a failed write leaves both
 * workspaces exactly as they were rather than losing the documents in between.
 */
export function applyToDestination(
  destination: WorkspaceRecord,
  plan: TransferPlan,
): WorkspaceRecord {
  const files = [...destination.files, ...plan.files];
  return {
    ...destination,
    updatedAt: Date.now(),
    files,
    folders: [...(destination.folders ?? []), ...plan.folders],
    saved: [...(destination.saved ?? []), ...plan.saved],
    highlights: [...(destination.highlights ?? []), ...plan.highlights],
    notes: [...(destination.notes ?? []), ...plan.notes],
    ui: {
      ...destination.ui,
      // The incoming documents go at the end of the destination's order. Left
      // out of `fileOrder` entirely they would render in an arbitrary position
      // — or not at all, in a build that treats the order as exhaustive.
      fileOrder: [
        ...(destination.ui.fileOrder ?? destination.files.map((f) => f.id)),
        ...plan.files.map((f) => f.id),
      ],
    },
  };
}

/** What is left of the source once the moved records are gone. */
export function removeFromSource<
  T extends Pick<WorkspaceRecord, "files" | "folders" | "saved" | "highlights" | "notes">,
>(source: T, plan: TransferPlan): T {
  return {
    ...source,
    files: source.files.filter((file) => !plan.removeFileIds.has(file.id)),
    folders: (source.folders ?? []).filter((folder) => !plan.removeFolderIds.has(folder.id)),
    saved: (source.saved ?? []).filter((item) => !plan.removeFileIds.has(item.fileId)),
    highlights: (source.highlights ?? []).filter((item) => !plan.removeFileIds.has(item.fileId)),
    notes: (source.notes ?? []).filter((item) => !plan.removeFileIds.has(item.fileId)),
  };
}
