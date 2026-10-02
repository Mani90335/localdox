// Saved items — the reader's stars, kept as data only.
//
// Starring was removed from the app: nothing shows or creates a saved item any
// more. Workspaces written while it existed still carry them, and they are
// read and written back untouched so no reader loses data to the removal and
// older builds opening the same record still find their stars. The shape is
// therefore frozen: it is a storage format, not a feature.

import type { MdFile } from "../markdown/markdown-utils.ts";
import { fileSubtopics, stripExt } from "../markdown/markdown-utils.ts";

type SavedKind = "file" | "section" | "block";
type SavedBlockType = "table" | "code" | "quote" | "image" | "list" | "text";

export interface SavedItem {
  id: string;
  fileId: string;
  kind: SavedKind;
  /** What the Saved list shows: heading text, or an excerpt of the passage. */
  title: string;
  /** Rendered text the item covers — the quote it re-anchors itself by. */
  text?: string;
  /** Page the item lives on; absent when saved from single-page mode. */
  subtopicId?: string;
  /** Heading anchor id, for sections and subsections. */
  headingId?: string;
  blockType?: SavedBlockType;
  /** For image blocks: the src, so opening the item can find it again. */
  blockSrc?: string;
  /** Optional note the reader attaches. */
  note?: string;
  /** Character offsets within the page's rendered content (see text-offsets). */
  start?: number;
  end?: number;
  prefix?: string;
  suffix?: string;
  createdAt: number;
  /** Set when the saved text no longer exists in the document at all. */
  orphaned?: boolean;
}

/**
 * What opening a passage needs: the document, and where in it to scroll and
 * flash. A note's source link builds one from its quote anchor.
 */
export type PassageTarget = Pick<
  SavedItem,
  "fileId" | "headingId" | "blockSrc" | "text" | "prefix" | "suffix" | "start"
> & {
  /** The passage's file span, when known — landed on exactly (see source-address.ts). */
  span?: { start: number; end: number };
};

const newSavedId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `sv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Workspaces written before saved items existed only have `bookmarks: string[]`
 * (`${fileId}#${subtopicId}`, with the sentinel `root` for a whole file). Read
 * them as saved items so nobody loses a star on upgrade.
 */
export function migrateBookmarks(
  bookmarks: string[],
  files: Array<Pick<MdFile, "id" | "name" | "content" | "subtopics">>,
): SavedItem[] {
  const out: SavedItem[] = [];
  for (const raw of bookmarks) {
    const [fileId, subtopicId] = raw.split("#");
    const file = files.find((f) => f.id === fileId);
    if (!file) continue;
    if (!subtopicId || subtopicId === "root") {
      out.push({
        id: newSavedId(),
        fileId,
        kind: "file",
        title: stripExt(file.name),
        createdAt: Date.now(),
      });
      continue;
    }
    const chunks = fileSubtopics(file);
    const chunk = chunks.find((c) => c.id === subtopicId);
    if (!chunk) continue;
    out.push({
      id: newSavedId(),
      fileId,
      kind: "section",
      title: chunk.title,
      subtopicId,
      headingId: subtopicId,
      createdAt: Date.now(),
    });
  }
  return out;
}

/** Legacy projection, still written to the record so older builds keep working. */
export function toLegacyBookmarks(saved: SavedItem[]): string[] {
  return saved
    .filter((s) => s.kind === "file" || s.kind === "section")
    .map(
      (s) => `${s.fileId}#${s.kind === "file" ? "root" : (s.headingId ?? s.subtopicId ?? "root")}`,
    );
}
