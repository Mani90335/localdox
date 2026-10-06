// Validation for everything that enters storage from outside this tab: backup
// files, whole-workspace share links and shared-file links.
//
// Nothing here writes. Callers validate the complete payload first and only
// then commit it, so a malformed or oversized import leaves storage untouched.
//
// Validation is strict about structure (types, unique ids, acyclic folders,
// size budgets) and lenient about vocabulary: a `kind` this build does not
// know, or a field it has never heard of, is dropped rather than rejected, so
// a backup written by a newer build still opens in an older one.

import { z } from "zod";
import type { DocumentKind } from "../markdown/markdown-utils.ts";
import { MAX_NOTE_CHARS } from "./notes.ts";
import { MAX_SCRATCHPAD_CHARS, MAX_SCRATCHPAD_TITLE } from "./rough-work.ts";

/** Upper bound on the raw JSON of one import and on its decoded payload bytes. */
export const MAX_IMPORT_BYTES = 128 * 1024 * 1024;
export const MAX_IMPORT_FILES = 10_000;
export const MAX_FOLDER_DEPTH = 64;

const DOCUMENT_KINDS = new Set<DocumentKind>([
  "markdown",
  "mermaid",
  "board",
  "text",
  "docx",
  "pdf",
  "spreadsheet",
  "csv",
  "json",
  "presentation",
  "google-doc",
  "google-slide",
  "image",
  "video",
  "audio",
  "html",
  "exam",
  "exam-rules",
  "practice",
  "unknown",
]);

const id = z.string().min(1).max(512);
const optionalText = z.string().optional();
const count = z.number().finite().nonnegative();
const optionalCount = count.optional().catch(undefined);

// Quote anchoring shared by highlights and saved items.
const anchor = {
  text: optionalText,
  subtopicId: optionalText,
  start: optionalCount,
  end: optionalCount,
  prefix: optionalText,
  suffix: optionalText,
  orphaned: z.boolean().optional(),
};

export const importedFileSchema = z.object({
  id,
  name: z
    .string()
    .max(4096)
    .transform((name) => name.trim() || "untitled.md")
    .catch("untitled.md"),
  content: z.string(),
  data: optionalText,
  mimeType: optionalText.catch(undefined),
  size: optionalCount,
  addedAt: optionalCount,
  kind: z
    .string()
    .optional()
    .catch(undefined)
    .transform((kind) =>
      kind && DOCUMENT_KINDS.has(kind as DocumentKind) ? (kind as DocumentKind) : undefined,
    ),
  folderId: id.nullish().catch(null),
  deletedAt: count.nullish().catch(null),
  derivedFrom: z.unknown().optional(),
});

const folderSchema = z.object({
  id,
  name: z.string(),
  createdAt: count.catch(0),
  parentId: id.nullish().catch(null),
  purpose: z.literal("embed-media").optional().catch(undefined),
});

const savedSchema = z.object({
  id,
  fileId: id,
  kind: z.enum(["file", "section", "block"]),
  title: z.string(),
  ...anchor,
  headingId: optionalText,
  blockType: z
    .enum(["table", "code", "quote", "image", "list", "text"])
    .optional()
    .catch(undefined),
  blockSrc: optionalText,
  note: optionalText,
  createdAt: count.catch(0),
});

const highlightSchema = z.object({
  id,
  fileId: id,
  ...anchor,
  text: z.string(),
  color: z.string(),
  label: optionalText,
  createdAt: optionalCount,
});

const noteSchema = z
  .object({
    id,
    // "" for a note saved from rough work that had no document.
    fileId: z.string().max(512),
    fileName: z.string().max(4096).catch(""),
    content: z.string().max(MAX_NOTE_CHARS),
    source: z
      .object({
        quote: z.string().catch(""),
        prefix: optionalText.catch(undefined),
        suffix: optionalText.catch(undefined),
        start: optionalCount,
        end: optionalCount,
        subtopicId: optionalText.catch(undefined),
        headingId: optionalText.catch(undefined),
        sectionTitle: optionalText.catch(undefined),
        anchor: z
          .object({ start: count, end: count, head: z.string(), tail: z.string() })
          .optional()
          .catch(undefined),
      })
      .catch({ quote: "" }),
    origin: z
      .object({
        kind: z.literal("rough-work"),
        scratchpadId: id,
        title: z.string().max(4096).catch(""),
      })
      .optional()
      .catch(undefined),
    createdAt: count.catch(0),
    updatedAt: count.optional().catch(undefined),
  })
  .transform(({ updatedAt, origin, ...note }) => ({
    ...note,
    ...(origin ? { origin } : {}),
    updatedAt: updatedAt ?? note.createdAt,
  }));

const scratchpadSchema = z
  .object({
    id,
    title: z
      .string()
      .transform((title) => title.trim().slice(0, MAX_SCRATCHPAD_TITLE) || "Scratchpad")
      .catch("Scratchpad"),
    content: z.string().max(MAX_SCRATCHPAD_CHARS),
    fileId: id.nullish().catch(null),
    fileName: z.string().max(4096).optional().catch(undefined),
    createdAt: count.catch(0),
    updatedAt: count.optional().catch(undefined),
  })
  .transform(({ updatedAt, fileId, fileName, ...pad }) => ({
    ...pad,
    fileId: fileId ?? null,
    ...(fileId && fileName !== undefined ? { fileName } : {}),
    updatedAt: updatedAt ?? pad.createdAt,
  }));

const ids = z
  .array(z.unknown())
  .transform((list) => list.filter((value): value is string => typeof value === "string"));

const paneSchema = z.object({ id, tabs: ids, activeTabId: id.nullable().catch(null) });

const uiSchema = z
  .object({
    activeFileId: id.nullable().catch(null),
    expanded: z.record(z.boolean()).catch({}),
    sidebarCollapsed: z.boolean().catch(false),
    scrollTop: count.catch(0),
    fileOrder: ids.optional().catch(undefined),
    recentFileIds: ids.optional().catch(undefined),
    panes: z.array(paneSchema).max(4).optional().catch(undefined),
    focusedPaneId: id.nullish().catch(null),
  })
  .catch({
    activeFileId: null,
    expanded: {},
    sidebarCollapsed: false,
    scrollTop: 0,
    focusedPaneId: null,
  });

const workspaceSchema = z.object({
  kind: z.enum(["exam", "documentation", "reader"]).default("reader"),
  id: id.optional().catch(undefined),
  name: z
    .string()
    .transform((name) => name.trim() || "Imported workspace")
    .catch("Imported workspace"),
  createdAt: count.optional().catch(undefined),
  files: z.array(importedFileSchema).max(MAX_IMPORT_FILES),
  folders: z.array(folderSchema).max(MAX_IMPORT_FILES).default([]),
  // Absent in exports written before saved items existed; `migrateBookmarks`
  // rebuilds file/section stars from `bookmarks` on hydrate in that case.
  saved: z.array(savedSchema).max(100_000).optional(),
  highlights: z.array(highlightSchema).max(100_000).default([]),
  // Absent in exports written before notes existed.
  notes: z.array(noteSchema).max(100_000).default([]),
  // Absent in exports written before rough work existed.
  scratchpads: z.array(scratchpadSchema).max(MAX_IMPORT_FILES).default([]),
  bookmarks: ids.default([]),
  ui: uiSchema,
});

export type ImportedWorkspace = z.output<typeof workspaceSchema>;
export type ImportedFile = z.output<typeof importedFileSchema>;

export class ImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportValidationError";
  }
}

/** Parse JSON after checking its size, so a huge paste fails before allocation. */
export function parseImportJson(json: string): unknown {
  // UTF-16 length is a cheap lower bound; only encode when it could be close.
  if (json.length > MAX_IMPORT_BYTES) throw tooLarge();
  if (
    json.length > MAX_IMPORT_BYTES / 3 &&
    new TextEncoder().encode(json).byteLength > MAX_IMPORT_BYTES
  )
    throw tooLarge();
  try {
    return JSON.parse(json);
  } catch {
    throw new ImportValidationError("This file is not valid JSON.");
  }
}

function tooLarge() {
  return new ImportValidationError(
    `This import is larger than the ${MAX_IMPORT_BYTES / 1024 / 1024} MiB limit.`,
  );
}

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const where = issue?.path.length ? issue.path.join(".") : "backup";
  return `Invalid backup at ${where}: ${issue?.message ?? "unrecognized content"}.`;
}

/** Bytes a file occupies once decoded — base64 data URLs count their payload. */
export function decodedBytes(file: { content: string; data?: string }): number {
  let bytes = file.content.length;
  if (file.data) {
    const comma = file.data.indexOf(",");
    const payload = comma >= 0 ? file.data.length - comma - 1 : file.data.length;
    bytes += /;base64,/.test(file.data.slice(0, comma + 1)) ? Math.floor(payload * 0.75) : payload;
  }
  return bytes;
}

export function assertImportBudget(files: { content: string; data?: string }[]): void {
  if (files.length > MAX_IMPORT_FILES)
    throw new ImportValidationError(`Imports are limited to ${MAX_IMPORT_FILES} files.`);
  let total = 0;
  for (const file of files) {
    total += decodedBytes(file);
    if (total > MAX_IMPORT_BYTES) throw tooLarge();
  }
}

function assertUnique(list: { id: string }[], what: string) {
  const seen = new Set<string>();
  for (const item of list) {
    if (seen.has(item.id))
      throw new ImportValidationError(`The backup contains two ${what} with the id “${item.id}”.`);
    seen.add(item.id);
  }
}

/**
 * Validate a workspace payload. Throws `ImportValidationError` with a message
 * fit to show the reader; never returns a partially valid workspace.
 */
export function validateWorkspaceImport(value: unknown): ImportedWorkspace {
  const result = workspaceSchema.safeParse(value);
  if (!result.success) throw new ImportValidationError(describeIssue(result.error));
  const w = result.data;

  assertImportBudget(w.files);
  assertUnique(w.files, "files");
  assertUnique(w.folders, "folders");
  assertUnique(w.saved ?? [], "saved items");
  assertUnique(w.highlights, "highlights");
  assertUnique(w.notes, "notes");
  assertUnique(w.scratchpads, "scratchpads");

  const folders = new Map(w.folders.map((folder) => [folder.id, folder]));
  for (const folder of w.folders) {
    const seen = new Set<string>();
    let cursor: string | null | undefined = folder.id;
    while (cursor) {
      if (seen.has(cursor))
        throw new ImportValidationError(`Folder “${folder.name}” is nested inside itself.`);
      if (seen.size >= MAX_FOLDER_DEPTH)
        throw new ImportValidationError(
          `Folders are nested more than ${MAX_FOLDER_DEPTH} levels deep.`,
        );
      seen.add(cursor);
      cursor = folders.get(cursor)?.parentId;
    }
  }

  // Dangling references are dropped rather than rejected: they carry no data
  // of their own and an otherwise faithful backup should still open. Notes and
  // scratchpads are the exception — each carries text of its own, so one whose
  // document is gone is still worth keeping.
  const fileIds = new Set(w.files.map((file) => file.id));
  const live = (fileId: string) => fileIds.has(fileId);
  return {
    ...w,
    files: w.files.map((file) => ({
      ...file,
      folderId: file.folderId && folders.has(file.folderId) ? file.folderId : null,
    })),
    folders: w.folders.map((folder) => ({
      ...folder,
      parentId: folder.parentId && folders.has(folder.parentId) ? folder.parentId : null,
    })),
    saved: w.saved?.filter((item) => live(item.fileId)),
    highlights: w.highlights.filter((item) => live(item.fileId)),
    ui: {
      ...w.ui,
      activeFileId: w.ui.activeFileId && live(w.ui.activeFileId) ? w.ui.activeFileId : null,
      fileOrder: w.ui.fileOrder?.filter(live),
      recentFileIds: w.ui.recentFileIds?.filter(live),
      panes: w.ui.panes?.map((pane) => ({
        ...pane,
        tabs: pane.tabs.filter(live),
        activeTabId: pane.activeTabId && live(pane.activeTabId) ? pane.activeTabId : null,
      })),
    },
  };
}

/** Validate a shared-file list (the `#share-files=` payload's `files`). */
export function validateImportedFiles(value: unknown): ImportedFile[] {
  const result = z.array(importedFileSchema).max(MAX_IMPORT_FILES).safeParse(value);
  if (!result.success) throw new ImportValidationError(describeIssue(result.error));
  assertImportBudget(result.data);
  assertUnique(result.data, "files");
  return result.data;
}
