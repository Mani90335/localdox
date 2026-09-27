// Shared helpers for the vendor-asset plugins (`vite-mathjax-asset.ts`,
// `vite-pdfjs-assets.ts`): walking a package directory and guessing a
// content type from a file extension. Split out once a second plugin needed
// the same two functions, rather than duplicated per plugin.

import { promises as fs } from "node:fs";
import path from "node:path";

/** Every file under a directory, as paths relative to it. */
export async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full));
  }
  return out;
}

export function contentType(file: string): string {
  if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".woff2")) return "font/woff2";
  if (file.endsWith(".woff")) return "font/woff";
  if (file.endsWith(".ttf")) return "font/ttf";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}
