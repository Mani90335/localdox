// Share links. Two shapes exist, both carrying only a short bytebin key in the
// URL so a large document survives being pasted into a chat client:
//
//   #share=<key>        a whole workspace — imported on load, no questions asked
//   #share-files=<key>  a hand-picked set of files — the recipient chooses
//                       between a new workspace and the one they are already in
//
// Older links carry the compressed payload inline instead of a key; `fetchShare`
// still reads those.

import type { PersistedFile } from "./persistence";

const BYTEBIN_URL = "https://bytebin.lucko.me";

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

export function serializeSharedFiles(files: PersistedFile[], sourceName: string): string {
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
    })),
  };
  return JSON.stringify(payload);
}

/** Parse a `#share-files=` payload. Throws when it isn't one. */
export function parseSharedFiles(json: string): SharedFilesPayload {
  const data = JSON.parse(json);
  if (!data || !Array.isArray(data.files)) throw new Error("Not a shared file link");
  const files: PersistedFile[] = data.files
    .filter((f: any) => f && typeof f.content === "string")
    .map((f: any) => ({
      id: typeof f.id === "string" ? f.id : crypto.randomUUID(),
      name: typeof f.name === "string" && f.name.trim() ? f.name : "untitled.md",
      content: f.content,
      data: typeof f.data === "string" ? f.data : undefined,
      mimeType: typeof f.mimeType === "string" ? f.mimeType : undefined,
      size: typeof f.size === "number" ? f.size : undefined,
      addedAt: typeof f.addedAt === "number" ? f.addedAt : undefined,
      kind: typeof f.kind === "string" ? f.kind : undefined,
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
    return res.text();
  }
  return decodeAndDecompress(keyOrData);
}

/** Clipboard write with a fallback for browsers/contexts without the async API. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
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
    document.execCommand("copy");
  } finally {
    document.body.removeChild(field);
  }
}

export function copyLink(url: string): Promise<void> {
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
  writer.write(compressedData as any);
  writer.close();

  const response = new Response(ds.readable);
  const decompressedBuffer = await response.arrayBuffer();

  const decoder = new TextDecoder();

  return decoder.decode(decompressedBuffer);
}
