import type { MdFile } from "@/lib/markdown/markdown-utils";
import { getDocumentKind } from "@/lib/markdown/document-utils";
import type { PersistedFile } from "@/lib/workspace/persistence";

/**
 * Stored file → in-memory file.
 *
 * Structure is deliberately not parsed here. This runs for every document in
 * the workspace during hydrate, before the first paint, and parsing each one
 * meant scanning the entire workspace's text up front — most of it for
 * documents the reader never opens. `fileSubtopics()` derives (and caches) a
 * document's sections the first time something actually asks.
 */
export function toMdFile(f: PersistedFile): MdFile {
  return {
    id: f.id,
    name: f.name,
    content: f.content,
    data: f.data,
    mimeType: f.mimeType,
    size: f.size,
    addedAt: f.addedAt,
    kind: f.kind ?? getDocumentKind(f.name, f.mimeType),
    folderId: f.folderId ?? null,
    deletedAt: f.deletedAt,
    derivedFrom: f.derivedFrom,
  };
}

/** `report.md` → `report (2).md` when the workspace already holds that name. */
export function uniqueFileName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * A file already in the workspace that the incoming one duplicates.
 *
 * Two kinds of duplicate matter, and they are not the same problem: the same
 * bytes arriving again (re-uploading a file that is already here, which is
 * simply redundant) and a different document arriving under a name that is
 * taken (which would leave two indistinguishable rows in the sidebar).
 */
export type DuplicateKind = "content" | "name";

export function fileFingerprint(f: { content?: string; data?: string }): string {
  // Binary files carry their bytes in `data`; text ones in `content`. Either is
  // a faithful identity for "the same file uploaded twice".
  return f.data ?? f.content ?? "";
}

export function findDuplicate(
  incoming: { name: string; content?: string; data?: string },
  existing: MdFile[],
): { kind: DuplicateKind; file: MdFile } | null {
  const print = fileFingerprint(incoming);
  if (print) {
    const same = existing.find((f) => fileFingerprint(f) === print);
    if (same) return { kind: "content", file: same };
  }
  const clash = existing.find((f) => f.name === incoming.name);
  return clash ? { kind: "name", file: clash } : null;
}
