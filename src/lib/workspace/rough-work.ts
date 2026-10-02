// Rough work — the reader's own scratchpads, kept beside their notes.
//
// A scratchpad is working space: equations tried and abandoned, intermediate
// steps, pasted values. It belongs to the workspace, not to any document:
//
//  - It is never part of a document's text. Nothing here reads or writes
//    `file.content`, except `insertIntoDocument`, which the app runs only
//    after the reader has confirmed one specific insertion.
//  - `fileId` is an optional association ("rough work for guide.md"), used to
//    group and label pads. Like a note's source it outlives the document: the
//    pad is still the reader's when the document is deleted or moved to the Bin.
//  - Its history is its own. Clearing, renaming or deleting a pad never touches
//    a document, and an insertion is an ordinary edit of the document, made
//    once, with no live link back.
//
// Pads live on the workspace record (`WorkspaceRecord.scratchpads`), beside
// notes, and travel the same paths: autosave, two-tab merge, backup, and
// moving a document to another workspace. Never share links.

import { fileSubtopics, headingChunkMap, type MdChunk } from "../markdown/markdown-utils.ts";
import { chunkRanges, newNoteId, type Note } from "./notes.ts";

export interface Scratchpad {
  id: string;
  title: string;
  /** Markdown, with `$…$` / `$$…$$` math. */
  content: string;
  /** The document this rough work is for, or null for the workspace as a whole. */
  fileId: string | null;
  /** That document's name when it was linked; shown once it no longer exists. */
  fileName?: string;
  createdAt: number;
  updatedAt: number;
}

/** Longest pad the app stores. The same bound notes use, for the same reason. */
export const MAX_SCRATCHPAD_CHARS = 200_000;
export const MAX_SCRATCHPAD_TITLE = 120;
const DEFAULT_TITLE = "Scratchpad";

export const newScratchpadId = newNoteId;

/** `base`, or `base 2`, `base 3`… — the first not already taken. */
export function uniqueTitle(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

function cleanTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, MAX_SCRATCHPAD_TITLE);
}

export function createScratchpad(
  existing: readonly Scratchpad[],
  file: { id: string; name: string } | null,
  now = Date.now(),
): Scratchpad {
  return {
    id: newScratchpadId(),
    title: uniqueTitle(
      DEFAULT_TITLE,
      existing.map((pad) => pad.title),
    ),
    content: "",
    fileId: file?.id ?? null,
    ...(file ? { fileName: file.name } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/** The pad with new content, or the same pad when nothing changed. */
export function editScratchpad(pad: Scratchpad, content: string, now = Date.now()): Scratchpad {
  const next = content.slice(0, MAX_SCRATCHPAD_CHARS);
  return next === pad.content ? pad : { ...pad, content: next, updatedAt: now };
}

/** Renamed; a blank or unchanged title leaves the pad as it was. */
export function renameScratchpad(pad: Scratchpad, title: string, now = Date.now()): Scratchpad {
  const next = cleanTitle(title);
  return !next || next === pad.title ? pad : { ...pad, title: next, updatedAt: now };
}

/** A copy with its own identity, titled "… copy" (numbered if that is taken). */
export function duplicateScratchpad(
  pad: Scratchpad,
  existing: readonly Scratchpad[],
  now = Date.now(),
): Scratchpad {
  return {
    ...pad,
    id: newScratchpadId(),
    title: uniqueTitle(
      cleanTitle(`${pad.title} copy`),
      existing.map((other) => other.title),
    ),
    createdAt: now,
    updatedAt: now,
  };
}

/** Linked to a document, or unlinked (null). */
export function linkScratchpad(
  pad: Scratchpad,
  file: { id: string; name: string } | null,
  now = Date.now(),
): Scratchpad {
  if ((pad.fileId ?? null) === (file?.id ?? null)) return pad;
  const { fileName: _old, ...rest } = pad;
  return file
    ? { ...rest, fileId: file.id, fileName: file.name, updatedAt: now }
    : { ...rest, fileId: null, updatedAt: now };
}

/**
 * Pads for the document being read first, then the rest; most recently
 * worked on first within each group.
 */
export function sortScratchpads(
  pads: readonly Scratchpad[],
  activeFileId: string | null,
): Scratchpad[] {
  const rank = (pad: Scratchpad) => (activeFileId && pad.fileId === activeFileId ? 0 : 1);
  return [...pads].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
}

// ---- taking work out of a pad ------------------------------------------------

/**
 * What an action on the pad applies to: the selected text when there is a
 * selection, otherwise the whole pad. Null when that is only whitespace.
 */
export function selectedWork(
  content: string,
  start: number,
  end: number,
): { markdown: string; whole: boolean } | null {
  const whole = start === end;
  const markdown = (whole ? content : content.slice(Math.min(start, end), Math.max(start, end)))
    .replace(/^\s*\n/, "")
    .trimEnd();
  return markdown.trim() ? { markdown, whole } : null;
}

/**
 * A durable note made from rough work. Its link back is the pad, not a
 * passage in a document; `fileId` carries the pad's document association (or
 * "" for none) so the note travels with that document like any other.
 */
export function noteFromScratchpad(pad: Scratchpad, markdown: string, now = Date.now()): Note {
  return {
    id: newNoteId(),
    fileId: pad.fileId ?? "",
    fileName: pad.fileName ?? "",
    content: markdown,
    source: { quote: "" },
    origin: { kind: "rough-work", scratchpadId: pad.id, title: pad.title },
    createdAt: now,
    updatedAt: now,
  };
}

// ---- inserting into a document -------------------------------------------------

export interface InsertionPoint {
  kind: "page" | "end";
  /** Offset in the document's Markdown. */
  offset: number;
  /** For `page`: the page's title. */
  title?: string;
  /** For `page`: its id, so the reader can be taken there afterwards. */
  subtopicId?: string;
}

/**
 * Where rough work can go in a document: the end of the page the reader is on
 * (when the document is read page by page), and the end of the document.
 * `at` is that page, or a heading on it; null when there are no pages.
 */
export function insertionPoints(
  file: { content: string; name: string; subtopics?: MdChunk[] },
  at: string | null | undefined,
): InsertionPoint[] {
  const end: InsertionPoint = { kind: "end", offset: file.content.length };
  if (!at) return [end];
  const chunks = fileSubtopics(file);
  const subtopicId = chunks.some((chunk) => chunk.id === at)
    ? at
    : headingChunkMap(file.content)[at];
  const range = chunkRanges(file.content, chunks).find((r) => r.id === subtopicId);
  // The last page ends where the document does; offering both would be the
  // same choice twice.
  if (!range || range.to >= file.content.trimEnd().length) return [end];
  const title = chunks.find((chunk) => chunk.id === subtopicId)?.title;
  return [{ kind: "page", offset: range.to, title, subtopicId }, end];
}

/**
 * `markdown` placed at `offset` as a block of its own: one blank line either
 * side, whatever the surrounding text ended or started with. `span` is where
 * it landed, so the reader can be shown it and the insertion undone exactly.
 */
export function insertIntoDocument(
  content: string,
  markdown: string,
  offset: number,
): { content: string; span: { start: number; end: number } } {
  const at = Math.max(0, Math.min(offset, content.length));
  const head = content.slice(0, at).replace(/\n+$/, "");
  const tail = content.slice(at).replace(/^\n+/, "");
  const block = markdown.trim();
  const start = head ? head.length + 2 : 0;
  return {
    content: `${head}${head ? "\n\n" : ""}${block}${tail ? `\n\n${tail}` : "\n"}`,
    span: { start, end: start + block.length },
  };
}

// ---- draft recovery ---------------------------------------------------------------
//
// The editor journals pads in the same per-tab draft journal documents use
// (draft-journal.ts), under ids that cannot collide with a file id.

const DRAFT_PREFIX = "rough:";

export const scratchpadDraftId = (padId: string) => `${DRAFT_PREFIX}${padId}`;

/** The pad a journal entry belongs to, or null for a document's entry. */
export function scratchpadOfDraft(draftId: string): string | null {
  return draftId.startsWith(DRAFT_PREFIX) ? draftId.slice(DRAFT_PREFIX.length) : null;
}

/** Pads as the journal sees documents: an id and the text storage holds. */
export function scratchpadDrafts(
  pads: readonly Scratchpad[] | undefined,
): { id: string; content: string }[] {
  return (pads ?? []).map((pad) => ({ id: scratchpadDraftId(pad.id), content: pad.content }));
}

/** The page (H1 section) an offset in the document's Markdown falls on. */
export function pageAt(
  file: { content: string; name: string; subtopics?: MdChunk[] },
  offset: number,
): string | undefined {
  return chunkRanges(file.content, fileSubtopics(file)).find(
    (range) => offset >= range.from && offset <= range.to,
  )?.id;
}
