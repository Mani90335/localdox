import { dataBytes } from "./binary.ts";
import type { FileData } from "./binary.ts";
// Central upload/storage guards shared by every import path (DocsApp) and the
// Settings storage panel so both agree on the same numbers.
//
// Pure: no storage access here. Measuring and reserving live in
// storage-budget.ts; persistence.ts uses `storedFileBytes` to keep each
// workspace's total on its summary row.

/** Per-file cap: reject any single upload larger than this. */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

/** Total workspace storage is hard-capped at this fraction of the browser quota. */
export const STORAGE_QUOTA_FRACTION = 0.05;

/** Browser storage quota in bytes, or null when the API is unavailable. */
export async function getStorageQuota(): Promise<number | null> {
  if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
    const est = await navigator.storage.estimate();
    return est.quota ?? null;
  }
  return null;
}

/**
 * Hard storage cap in bytes (5% of the browser quota), or null when the quota
 * cannot be determined.
 */
export async function getMaxStorageBytes(): Promise<number | null> {
  const quota = await getStorageQuota();
  return quota == null ? null : capFromQuota(quota);
}

export function capFromQuota(quota: number): number {
  return Math.floor(quota * STORAGE_QUOTA_FRACTION);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// ---- what counts ----
//
// One unit everywhere: a document's text as UTF-8 plus its binary exactly as
// stored: Blob bytes, or legacy data URL characters until migrated. A file's `size`
// is what was picked from disk, so it omits text stored alongside CSV, goes stale after
// an edit and arrives unchecked in backups and share links; nothing here reads
// it.

const encoder = new TextEncoder();

/**
 * UTF-8 byte length. The encoded copy is short-lived; the browser's encoder
 * still measured 10–20× faster on 10 MB of text than a charCodeAt loop.
 */
export function utf8Length(text: string): number {
  return text ? encoder.encode(text).byteLength : 0;
}

/** Bytes one document occupies in local storage. */
export function storedFileBytes(file: { content: string; data?: FileData }): number {
  return utf8Length(file.content) + dataBytes(file.data);
}

export function storedBytes(files: readonly { content: string; data?: FileData }[]): number {
  let total = 0;
  for (const file of files) total += storedFileBytes(file);
  return total;
}

/** An import that would take the documents on this device past the cap. */
export class StorageLimitError extends Error {
  readonly needed: number;
  readonly used: number;
  readonly cap: number;

  constructor(needed: number, used: number, cap: number) {
    super(
      `Not enough space. This needs ${formatBytes(needed)}, and ${formatBytes(
        Math.max(0, cap - used),
      )} of the ${formatBytes(cap)} Localdox can use on this device is free. ` +
        `Empty the Bin or remove files, then try again.`,
    );
    this.name = "StorageLimitError";
    this.needed = needed;
    this.used = used;
    this.cap = cap;
  }
}

/** The browser itself refused the write (its quota, not ours). */
export function isQuotaExceeded(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}
