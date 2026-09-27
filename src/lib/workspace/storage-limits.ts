// Central upload/storage guards shared by the uploader (DocsApp) and the
// Settings storage panel so both agree on the same numbers.

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
  return quota == null ? null : Math.floor(quota * STORAGE_QUOTA_FRACTION);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
