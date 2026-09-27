// Saved items — the reader's stars.
//
// A star used to mean one thing: "this file/page is saved", stored as the
// string `${fileId}#${subtopicId}`. Readers want to keep smaller things than a
// page: a table, a code block, a subsection, a sentence they selected. A saved
// item is therefore a record, not an id, and carries the same quote-anchoring
// fields a highlight does (text + surrounding context) so it survives edits to
// the document above it.

import type { MdFile } from "../markdown/markdown-utils.ts";
import { fileSubtopics, stripExt } from "../markdown/markdown-utils.ts";

// Text a reader drags over is a highlight, not a star — highlights already keep
// passages, with colors and notes. Stars are for whole structures: a document, a
// section, or a block (table, code fence, quote, image).
export type SavedKind = "file" | "section" | "block";

/** What kind of block a `kind: "block"` item points at — drives its icon. */
export type SavedBlockType = "table" | "code" | "quote" | "image" | "list" | "text";

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

/** Everything about a new star except the identity the store assigns it. */
export type SavedDraft = Omit<SavedItem, "id" | "fileId" | "createdAt">;

/** A saved item resolved against the workspace, ready to list. */
export interface SavedEntry extends SavedItem {
  fileName: string;
}

export const newSavedId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `sv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Identity of a star, for toggling. Two items are the same star when they point
 * at the same thing in the same file — not when they happen to share an id,
 * which a re-save would never reproduce.
 */
export function savedKey(item: {
  fileId?: string;
  kind: SavedKind;
  headingId?: string;
  subtopicId?: string;
  text?: string;
}): string {
  const where =
    item.kind === "file"
      ? ""
      : item.kind === "section"
        ? (item.headingId ?? item.subtopicId ?? "")
        : collapse(item.text ?? "").slice(0, 200);
  return `${item.fileId ?? ""}|${item.kind}|${where}`;
}

export function findSaved(
  saved: SavedItem[],
  probe: {
    fileId?: string;
    kind: SavedKind;
    headingId?: string;
    subtopicId?: string;
    text?: string;
  },
): SavedItem | undefined {
  const key = savedKey(probe);
  return saved.find((s) => savedKey(s) === key);
}

/** One-line label for a saved passage. */
export function savedExcerpt(text: string, max = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export const SAVED_KIND_LABEL: Record<SavedKind, string> = {
  file: "Document",
  section: "Section",
  block: "Block",
};

export function savedTypeLabel(item: SavedItem): string {
  if (item.kind === "block" && item.blockType) {
    const names: Record<SavedBlockType, string> = {
      table: "Table",
      code: "Code",
      quote: "Quote",
      image: "Image",
      list: "List",
      text: "Block",
    };
    return names[item.blockType];
  }
  return SAVED_KIND_LABEL[item.kind];
}

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
