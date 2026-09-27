import type { FolderRecord } from "./persistence";

export const EMBED_MEDIA_FOLDER = "embed-media";

/** Reuse the managed folder even after a rename or move. Adopt an existing
 * top-level embed-media folder rather than creating a duplicate. */
export function ensureEmbedMediaFolder(folders: FolderRecord[]) {
  const existing = folders.find((folder) => folder.purpose === "embed-media") ??
    folders.find((folder) => !folder.parentId && folder.name === EMBED_MEDIA_FOLDER);
  const folder: FolderRecord = existing
    ? { ...existing, purpose: "embed-media" }
    : { id: crypto.randomUUID(), name: EMBED_MEDIA_FOLDER, purpose: "embed-media", parentId: null, createdAt: Date.now() };
  return {
    folder,
    folders: existing ? folders.map((item) => item.id === existing.id ? folder : item) : [...folders, folder],
  };
}

/** Hiding is purely a sidebar concern, including nested folders and their files. */
export function embedMediaFolderIds(
  folders: Array<Pick<FolderRecord, "id" | "name" | "parentId" | "purpose">>,
): Set<string> {
  const ids = new Set(folders.filter((folder) => folder.purpose === "embed-media" || (!folder.parentId && folder.name === EMBED_MEDIA_FOLDER)).map((folder) => folder.id));
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parentId) continue;
    const siblings = children.get(folder.parentId) ?? [];
    siblings.push(folder.id);
    children.set(folder.parentId, siblings);
  }
  const pending = [...ids];
  while (pending.length) {
    for (const id of children.get(pending.pop()!) ?? []) {
      if (ids.has(id)) continue;
      ids.add(id);
      pending.push(id);
    }
  }
  return ids;
}
