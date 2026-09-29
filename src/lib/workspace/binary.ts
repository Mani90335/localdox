/** Immutable binary body. `id` survives structured clones; edits get a new id. */
export type BinaryBody = { id: string; blob: Blob };
/** Strings remain readable for legacy records and portable JSON imports. */
export type FileData = string | BinaryBody;

export function binaryBody(blob: Blob): BinaryBody {
  return { id: crypto.randomUUID(), blob };
}

export function sameData(a?: FileData, b?: FileData): boolean {
  return a === b || (!!a && !!b && typeof a !== "string" && typeof b !== "string" && a.id === b.id);
}

export function dataBytes(data?: FileData): number {
  return typeof data === "string" ? data.length : (data?.blob.size ?? 0);
}

/** Decode legacy data URLs in bounded chunks, without a full binary string. */
export function dataBlob(data?: FileData, fallbackType = "application/octet-stream"): Blob | null {
  if (data === undefined) return null;
  if (typeof data !== "string") return data.blob;
  const comma = data.indexOf(",");
  if (!data.startsWith("data:") || comma < 0) throw new Error("Invalid file data URL");
  const header = data.slice(0, comma);
  const type = header.slice(5).split(";")[0] || fallbackType;
  if (!/;base64$/i.test(header)) {
    // Percent escapes represent bytes, including non-UTF-8 legacy encodings.
    const parts = data.slice(comma + 1).split(/(%[\da-f]{2})/i);
    return new Blob(parts.map((part) => /^%[\da-f]{2}$/i.test(part)
      ? new Uint8Array([parseInt(part.slice(1), 16)]) : part), { type });
  }
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const payload = data.slice(comma + 1).replace(/\s/g, "");
  for (let offset = 0; offset < payload.length; offset += 32768) {
    const binary = atob(payload.slice(offset, offset + 32768));
    parts.push(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  }
  return new Blob(parts, { type });
}

export async function dataBuffer(data?: FileData): Promise<ArrayBuffer | null> {
  return dataBlob(data)?.arrayBuffer() ?? null;
}

/** Keep unreadable historical values intact rather than making an upgrade destructive. */
export function migrateData(data?: FileData): FileData | undefined {
  if (typeof data !== "string") return data;
  try {
    return binaryBody(dataBlob(data)!);
  } catch {
    return data;
  }
}

export async function portableData(data?: FileData): Promise<string | undefined> {
  if (typeof data === "string" || data === undefined) return data;
  // Only explicit exports pay for base64. Bound the intermediate binary strings.
  const bytes = new Uint8Array(await data.blob.arrayBuffer());
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 24576) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24576))));
  }
  return `data:${data.blob.type || "application/octet-stream"};base64,${chunks.join("")}`;
}

export async function portableFiles<T extends { data?: FileData }>(files: readonly T[]) {
  const result: (Omit<T, "data"> & { data?: string })[] = [];
  // Avoid materializing every binary's ArrayBuffer concurrently.
  for (const file of files) result.push({ ...file, data: await portableData(file.data) });
  return result;
}

const fingerprints = new WeakMap<Blob, Promise<string>>();
export async function dataFingerprint(data: FileData): Promise<string> {
  const blob = dataBlob(data)!;
  let pending = fingerprints.get(blob);
  if (!pending) {
    pending = blob.arrayBuffer().then((bytes) => crypto.subtle.digest("SHA-256", bytes))
      .then((hash) => Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(""));
    fingerprints.set(blob, pending);
  }
  return pending;
}
