import init, { formatFromBytes, formatFromPath, toMarkdownBytes } from "@firecrawl/anydoc-wasm";
import { MAX_CONVERSION_INPUT, MAX_CONVERSION_OUTPUT } from "./types.ts";
import type { ConversionResult, ConversionSource } from "./types.ts";

/** Runs only inside the worker. No hosted OCR or document network requests. */
export async function convertDocument(source: ConversionSource): Promise<ConversionResult> {
  let bytes: Uint8Array;
  if (source.data) {
    const encoded = source.data.slice(source.data.indexOf(",") + 1);
    if (encoded.length > Math.ceil(MAX_CONVERSION_INPUT / 3) * 4) throw { code: "resourceLimit" };
    bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  } else {
    bytes = new TextEncoder().encode(source.content);
  }
  if (bytes.byteLength > MAX_CONVERSION_INPUT) throw { code: "resourceLimit" };
  const format = formatFromBytes(bytes) ?? formatFromPath(source.name);
  if (!format) throw { code: "unsupported" };
  const hash = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  const inputHash = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  const markdown = toMarkdownBytes(bytes, format);
  if (!markdown.trim()) throw { code: "empty" };
  if (new TextEncoder().encode(markdown).byteLength > MAX_CONVERSION_OUTPUT)
    throw { code: "outputLimit" };
  return { markdown, inputHash };
}

export async function initializeConverter() {
  await init();
}
