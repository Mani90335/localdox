// Notes — passages the reader copied out of a document to keep.
//
// A note is a *snapshot*: its Markdown is written once, when the passage is
// copied, and only the reader's own edits change it afterwards. Editing or
// deleting the source document never reaches into a note. That is the whole
// difference from a highlight, which is a live mark on the document and moves
// (or orphans) when the text under it changes.
//
// What a note keeps of its source is a way back, not a dependency:
//
//  - `fileId` names the document. It is kept after the document is deleted —
//    the note is still the reader's — and the link then says the source is gone.
//  - `fileName` is the name at the moment of copying, shown only once the
//    document no longer exists. While it exists, its current name is shown, so
//    a rename never leaves a note pointing at a name nobody recognises.
//  - `source` is a quote anchor — the rendered text that was selected plus a
//    little context either side — the same scheme highlights use (see
//    text-offsets.ts). Offsets are kept as a hint only: any edit above the
//    passage shifts them, while the quote still finds it.
//
// Following a note back (`resolveNoteSource`) works on the Markdown source,
// so it can name the page the passage lives on *now* before anything renders.

import { fileSubtopics, headingChunkMap, type MdChunk } from "../markdown/markdown-utils.ts";
import { locateInSource } from "../markdown/source-locate.ts";
import { relocateAnchor, type SourceAnchor, type SourceSpan } from "../markdown/source-address.ts";

/** Where a note was copied from. */
export interface NoteSource {
  /** The rendered text that was selected — what the passage is found by. */
  quote: string;
  /** Rendered text just before and after the quote, to tell repeats apart. */
  prefix?: string;
  suffix?: string;
  /** Character offsets within the rendered page at copy time (a hint only). */
  start?: number;
  end?: number;
  /** The page (H1 section) it was on; absent when copied in single-page mode. */
  subtopicId?: string;
  /** The nearest heading above the passage, for when the passage is gone. */
  headingId?: string;
  /** That heading's text, shown on the note's source link. */
  sectionTitle?: string;
  /**
   * The passage's span in the file's Markdown, with its own first and last
   * characters to find it again by after edits (source-address.ts). Followed
   * first; the rendered quote above is the fallback. Absent on notes taken
   * before addressing existed.
   */
  anchor?: SourceAnchor;
}

export interface Note {
  id: string;
  /** The source document. Kept after it is deleted; see `resolveNoteSource`. */
  fileId: string;
  /** The source's name when the note was taken. */
  fileName: string;
  /** The copied passage, as Markdown. */
  content: string;
  source: NoteSource;
  createdAt: number;
  updatedAt: number;
}

/** What the reader produces; the workspace adds identity and the file. */
export interface NoteDraft {
  content: string;
  source: NoteSource;
}

/**
 * Longest note the app will store. Far beyond any passage worth keeping, and
 * low enough that a select-all on an enormous document cannot bloat every
 * autosave of the workspace record.
 */
export const MAX_NOTE_CHARS = 200_000;

export const newNoteId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `nt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function createNote(
  draft: NoteDraft,
  file: { id: string; name: string },
  now = Date.now(),
): Note {
  return {
    id: newNoteId(),
    fileId: file.id,
    fileName: file.name,
    content: draft.content.slice(0, MAX_NOTE_CHARS),
    source: draft.source,
    createdAt: now,
    updatedAt: now,
  };
}

/** The note with new content, or the same note when nothing changed. */
export function editNote(note: Note, content: string, now = Date.now()): Note {
  const next = content.slice(0, MAX_NOTE_CHARS);
  return next === note.content ? note : { ...note, content: next, updatedAt: now };
}

/** Newest first, by when the note was taken: editing one doesn't reorder the list. */
export function sortNotes(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Notes matching every word of `query`, in their content, source name or
 * section. `nameOf` gives a document's current name, so a renamed source is
 * found by the name the reader sees.
 */
export function searchNotes(
  notes: readonly Note[],
  query: string,
  nameOf: (fileId: string) => string | undefined = () => undefined,
): Note[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...notes];
  return notes.filter((note) => {
    const hay = [note.content, nameOf(note.fileId) ?? note.fileName, note.source.sectionTitle ?? ""]
      .join("\n")
      .toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

// ---- following a note back to its source -------------------------------------

export type NoteSourceStatus =
  /**
   * The passage is in the document; `subtopicId` is the page it is on now,
   * and `span` its exact file span when the note's source anchor still holds.
   */
  | { kind: "found"; subtopicId: string; moved: boolean; span?: SourceSpan }
  /**
   * The document exists but the passage is gone. `target` is where it was —
   * the heading above it, or its page — or null when neither survives.
   */
  | { kind: "missing-passage"; target: string | null }
  /** The document is in the Bin — restorable, so not "gone". */
  | { kind: "binned" }
  /** The document is no longer in this workspace. */
  | { kind: "missing-document" };

/**
 * Shortest line of a quote trusted to identify a passage on its own. A short
 * line ("Introduction", "See below") recurs across documents, and a link that
 * confidently lands on a different copy is worse than one that says the
 * passage is gone.
 */
const MIN_ANCHOR_LINE = 20;

/** Where each page starts and ends in the document source. */
function chunkRanges(content: string, chunks: MdChunk[]) {
  const ranges: Array<{ id: string; from: number; to: number }> = [];
  let cursor = 0;
  for (const chunk of chunks) {
    const at = content.indexOf(chunk.content, cursor);
    if (at < 0) continue;
    cursor = at + chunk.content.length;
    ranges.push({ id: chunk.id, from: at, to: cursor });
  }
  return ranges;
}

/**
 * Find the quote in the source. The whole quote first; then its longest
 * lines, because a selection that crossed an equation or a table carries
 * rendered text (KaTeX glyphs, cell gaps) the Markdown never contains, while
 * its plain lines still match exactly.
 */
function locateQuote(
  content: string,
  quote: string,
  prefer?: { from: number; to: number },
): SourceSpan | null {
  const whole = locateInSource(content, quote, prefer, { exactOnly: true });
  if (whole) return whole;
  const lines = [
    ...new Set(
      quote
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line.length >= MIN_ANCHOR_LINE),
    ),
  ].sort((a, b) => b.length - a.length);
  for (const line of lines) {
    const span = locateInSource(content, line, prefer, { exactOnly: true });
    if (span) return span;
  }
  return null;
}

/**
 * Where a note's passage is now.
 *
 * Pure: it reads the document's Markdown, never the rendered page, so the
 * caller can open the right page before rendering it. The reader then finds
 * the exact characters on that page by the same quote.
 */
export function resolveNoteSource(
  note: Pick<Note, "source">,
  file:
    { content: string; name: string; subtopics?: MdChunk[]; deletedAt?: number | null } | undefined,
): NoteSourceStatus {
  if (!file) return { kind: "missing-document" };
  if (file.deletedAt != null) return { kind: "binned" };

  const chunks = fileSubtopics(file);
  const ranges = chunkRanges(file.content, chunks);
  const home = ranges.find((range) => range.id === note.source.subtopicId);
  const pageOf = (offset: number) =>
    ranges.find((range) => offset >= range.from && offset <= range.to)?.id ??
    chunks[0]?.id ??
    "preamble";

  // Exactly where it was copied from, or where the same source text moved to.
  const anchored = note.source.anchor && relocateAnchor(file.content, note.source.anchor);
  if (anchored) {
    const page = pageOf(anchored.start);
    return {
      kind: "found",
      subtopicId: page,
      moved: !!note.source.subtopicId && page !== note.source.subtopicId,
      span: anchored,
    };
  }
  // The page it was copied from is searched first, so a passage repeated on
  // another page doesn't pull the link away from the reader's own copy.
  const span = locateQuote(
    file.content,
    note.source.quote,
    home ? { from: home.from, to: home.to } : undefined,
  );

  if (span) {
    const page = pageOf(span.start);
    return {
      kind: "found",
      subtopicId: page,
      moved: !!note.source.subtopicId && page !== note.source.subtopicId,
    };
  }

  // The words are gone. Open where they were: the heading above them if it
  // still exists, else the page they were on.
  const heading =
    note.source.headingId && headingChunkMap(file.content)[note.source.headingId]
      ? note.source.headingId
      : undefined;
  return { kind: "missing-passage", target: heading ?? home?.id ?? null };
}
