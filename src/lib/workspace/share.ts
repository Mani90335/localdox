import { portableFiles, migrateData } from "./binary.ts";
// Share links. Two shapes exist, both carrying only a short bytebin key in the
// URL so a large document survives being pasted into a chat client:
//
//   #share=<key>        a whole workspace — imported on load, no questions asked
//   #share-files=<key>  a hand-picked set of files — the recipient chooses
//                       between a new workspace and the one they are already in
//
// Older links carry the compressed payload inline instead of a key; `fetchShare`
// still reads those.

import type { FolderRecord, PersistedFile, WorkspaceRecord } from "./persistence";
import { parseDerivation, remapDerivation } from "../../services/doc-conversion/types.ts";
import { MAX_IMPORT_BYTES, parseImportJson, validateImportedFiles } from "./import-schema.ts";

const BYTEBIN_URL = "https://bytebin.lucko.me";

/** Where an uploaded share lives — shown to the sender before anything leaves. */
export const SHARE_HOST = new URL(BYTEBIN_URL).host;

export const SHARE_HASH = "#share=";
export const SHARE_FILES_HASH = "#share-files=";

export interface SharedFilesPayload {
  format: "localdox-files";
  version: 1;
  /** Workspace the files came from — the default name for a new workspace. */
  sourceName: string;
  sharedAt: number;
  files: PersistedFile[];
}

export async function serializeSharedFiles(
  files: PersistedFile[],
  sourceName: string,
): Promise<string> {
  const includedIds = new Map(files.map((file) => [file.id, file.id]));
  const payload: SharedFilesPayload = {
    format: "localdox-files",
    version: 1,
    sourceName: sourceName?.trim() || "Shared files",
    sharedAt: Date.now(),
    files: files.map((f) => ({
      id: f.id,
      name: f.name,
      content: f.content,
      data: f.data,
      mimeType: f.mimeType,
      size: f.size,
      addedAt: f.addedAt,
      kind: f.kind,
      derivedFrom: remapDerivation(f.derivedFrom, includedIds),
    })),
  };
  return JSON.stringify({ ...payload, files: await portableFiles(payload.files) });
}

/**
 * What a share leaves out unless the sender opts in. Notes and highlights
 * are private reading state, and the Bin holds what was thrown
 * away; none of it is part of "the documents" a reader means to hand over.
 */
export interface ShareSelection {
  /** Files to send. Binned files are sent only when listed here explicitly. */
  fileIds: string[];
  /** Carry notes and highlights on the included files. */
  includeAnnotations: boolean;
}

/**
 * The workspace a share link carries: only the chosen files, only the folders
 * they sit in, no Bin state, no reading history, and annotations only on
 * request. Every chosen file arrives live — a share is a hand-off, not a copy
 * of the sender's Bin.
 */
export function buildWorkspaceShare(
  record: WorkspaceRecord,
  selection: ShareSelection,
): WorkspaceRecord {
  const wanted = new Set(selection.fileIds);
  const files = record.files.filter((file) => wanted.has(file.id));
  const ids = new Map(files.map((file) => [file.id, file.id]));

  // Folders survive only as the path to an included file, so the names of
  // folders holding nothing shared don't travel either.
  const folderById = new Map((record.folders ?? []).map((folder) => [folder.id, folder]));
  const keptFolders = new Set<string>();
  for (const file of files) {
    let id = file.folderId ?? null;
    while (id && !keptFolders.has(id) && folderById.has(id)) {
      keptFolders.add(id);
      id = folderById.get(id)!.parentId ?? null;
    }
  }
  const folders: FolderRecord[] = (record.folders ?? [])
    .filter((folder) => keptFolders.has(folder.id))
    .map((folder) => ({ ...folder }));

  const onShared = (fileId: string) => ids.has(fileId);
  // Stars never travel: starring was removed from the app, so the sender can
  // no longer see what they would be handing over (see saved-items.ts).
  const highlights = selection.includeAnnotations
    ? (record.highlights ?? []).filter((h) => onShared(h.fileId))
    : [];
  const order = (record.ui.fileOrder ?? []).filter(onShared);
  const active =
    record.ui.activeFileId && onShared(record.ui.activeFileId)
      ? record.ui.activeFileId
      : (files[0]?.id ?? null);

  return {
    id: crypto.randomUUID(),
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: Date.now(),
    files: files.map((f) => {
      const file: PersistedFile = {
        id: f.id,
        name: f.name,
        content: f.content,
        folderId: f.folderId && keptFolders.has(f.folderId) ? f.folderId : null,
      };
      if (f.data !== undefined) file.data = f.data;
      if (f.mimeType !== undefined) file.mimeType = f.mimeType;
      if (f.size !== undefined) file.size = f.size;
      if (f.addedAt !== undefined) file.addedAt = f.addedAt;
      if (f.kind !== undefined) file.kind = f.kind;
      const derivedFrom = remapDerivation(f.derivedFrom, ids);
      if (derivedFrom) file.derivedFrom = derivedFrom;
      return file;
    }),
    folders,
    bookmarks: [],
    saved: [],
    highlights,
    ui: {
      activeFileId: active,
      expanded: {},
      sidebarCollapsed: false,
      scrollTop: 0,
      fileOrder: order,
      recentFileIds: [],
      panes: [],
      focusedPaneId: null,
    },
  };
}

/** How many private annotations a set of files carries — the opt-in's label. */
export function countAnnotations(record: WorkspaceRecord, fileIds: Iterable<string>): number {
  const ids = new Set(fileIds);
  return (record.highlights ?? []).filter((h) => ids.has(h.fileId)).length;
}

/** Parse a `#share-files=` payload. Throws when it isn't one. */
export function parseSharedFiles(json: string): SharedFilesPayload {
  const data = parseImportJson(json) as Partial<SharedFilesPayload> | null;
  if (!data || typeof data !== "object" || !Array.isArray(data.files))
    throw new Error("Not a shared file link");
  const validated = validateImportedFiles(data.files);
  const ids = new Map(validated.map((file) => [file.id, file.id]));
  const files: PersistedFile[] = validated.map((f) => ({
    id: f.id,
    name: f.name,
    content: f.content,
    data: migrateData(f.data),
    mimeType: f.mimeType,
    size: f.size,
    addedAt: f.addedAt,
    kind: f.kind,
    derivedFrom: remapDerivation(parseDerivation(f.derivedFrom), ids),
  }));
  if (files.length === 0) throw new Error("Shared link contains no readable files");
  return {
    format: "localdox-files",
    version: 1,
    sourceName:
      typeof data.sourceName === "string" && data.sourceName.trim()
        ? data.sourceName
        : "Shared files",
    sharedAt: typeof data.sharedAt === "number" ? data.sharedAt : Date.now(),
    files,
  };
}

/** Put a JSON payload on bytebin; returns the key that goes in the link hash. */
export async function uploadShare(json: string): Promise<string> {
  const res = await fetch(`${BYTEBIN_URL}/post`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: json,
  });
  if (!res.ok) throw new Error("Failed to upload share payload");
  const data = await res.json();
  if (!data?.key) throw new Error("Share upload returned no key");
  return data.key as string;
}

/**
 * Read what a share hash points at. Short values are bytebin keys; anything
 * longer is a legacy inline payload.
 */
export async function fetchShare(keyOrData: string): Promise<string> {
  if (keyOrData.length < 50) {
    const res = await fetch(`${BYTEBIN_URL}/${keyOrData}`);
    if (!res.ok) throw new Error("Failed to fetch from bytebin");
    return res.body ? readBounded(res.body) : res.text();
  }
  return decodeAndDecompress(keyOrData);
}

/**
 * Clipboard write with a fallback for browsers/contexts without the async API.
 * Resolves false when neither route took the text.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Insecure context or a denied permission — fall through to the old trick.
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(field);
  }
}

export function copyLink(url: string): Promise<boolean> {
  return copyText(url);
}

export function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  // Convert standard base64 to base64url
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function base64UrlDecode(base64Url: string): Uint8Array {
  // Convert base64url to standard base64
  let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  // Pad with '='
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function compressAndEncode(jsonStr: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(jsonStr);

  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();

  const response = new Response(cs.readable);
  const compressedBuffer = await response.arrayBuffer();

  return base64UrlEncode(compressedBuffer);
}

export async function decodeAndDecompress(encodedStr: string): Promise<string> {
  const compressedData = base64UrlDecode(encodedStr);

  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(compressedData as any).catch(() => {});
  writer.close().catch(() => {});

  return readBounded(ds.readable);
}

/**
 * Read a byte stream as UTF-8, stopping at the import budget. A small
 * compressed link can expand enormously; the budget has to apply while
 * decompressing, not after the whole result is already in memory.
 */
export async function readBounded(
  stream: ReadableStream<Uint8Array>,
  limit = MAX_IMPORT_BYTES,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error(`This share is larger than the ${limit / 1024 / 1024} MiB import limit.`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
