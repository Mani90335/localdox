// Plans what the offline service worker (`build/offline-sw.js`) stores.
//
// Split from the Vite plugin so the planning rules can be unit tested against
// a synthetic bundle, without running a build.
//
// Two lists come out of a build:
//
// - `shell`: what a cold, offline start needs before any document is open —
//   the client entry, every route chunk (TanStack Router loads route components
//   lazily, so an offline deep link to /settings needs its chunk), everything
//   those import statically, their CSS, and the workers and other non-code
//   assets they reference by URL (the search worker, for instance). Dynamic
//   imports are not followed: they are the optional capabilities (PDF, math,
//   conversion, diagrams…) the reader may never use.
// - `files`: every file the app can request, with its size. These are cached
//   when first used, or all at once by an explicit download from Settings.

import { createHash } from "node:crypto";

/** The subset of a Rollup/Rolldown output chunk this planner reads. */
export type PlannedChunk = {
  type: "chunk";
  fileName: string;
  code: string;
  isEntry: boolean;
  imports: string[];
  dynamicImports: string[];
  moduleIds: string[];
  viteMetadata?: { importedCss: Set<string>; importedAssets: Set<string> };
};

export type PlannedAsset = {
  type: "asset";
  fileName: string;
  source: string | Uint8Array;
};

export type PlannedFile = PlannedChunk | PlannedAsset;

/** A file copied verbatim from `public/`. */
export type PublicFile = { fileName: string; source: Uint8Array };

/** `[url, bytes, versionTag]`: the tag is null for content-hashed names. */
export type ManifestFile = [url: string, bytes: number, tag: string | null];

export type OfflineManifest = {
  version: string;
  /** URLs precached at install, before the worker takes control. */
  shell: string[];
  files: ManifestFile[];
};

/** The navigation fallback: TanStack Start's client-only SPA shell. */
export const SHELL_HTML = "/_shell.html";

/** Route modules, including TanStack's `?tsr-split=…` component chunks. */
const ROUTE_MODULE = /[\\/]src[\\/]routes[\\/][^\\/]+\.tsx?(?:\?|$)/;

/** Whether a module id is the source file at `relative` (a repo-relative path). */
function isModule(id: string, relative: string): boolean {
  const file = id.split("?")[0].replaceAll("\\", "/");
  return file === relative || file.endsWith(`/${relative}`);
}

/** Core modules no chunk contains, so a rename can't silently shrink the shell. */
export function missingCoreModules(bundle: Record<string, PlannedFile>, core: string[]): string[] {
  const chunks = Object.values(bundle).filter((file) => file.type === "chunk");
  return core.filter(
    (relative) => !chunks.some((chunk) => chunk.moduleIds.some((id) => isModule(id, relative))),
  );
}

/** Vite's content-hashed build output. Its URL already names its bytes. */
const HASHED = /^assets\//;

/** Published, but never requested by the app itself. */
const NOT_REQUESTED = [/\.map$/, /^og-image\.[a-z]+$/, /(^|\/)LICENSE[^/]*$/i, /^sw\.js$/];

function byteLength(source: string | Uint8Array): number {
  return typeof source === "string" ? Buffer.byteLength(source) : source.byteLength;
}

function digest(source: string | Uint8Array): string {
  return createHash("sha256").update(source).digest("hex");
}

function sourceOf(file: PlannedFile): string | Uint8Array {
  return file.type === "chunk" ? file.code : file.source;
}

function basename(fileName: string): string {
  return fileName.slice(fileName.lastIndexOf("/") + 1);
}

/**
 * Chunks and assets a cold offline start needs, as bundle file names.
 *
 * `core` names source modules that are lazy but part of the app itself
 * (settings, the document viewer shell), as repo-relative paths; their
 * chunks join the shell like routes do.
 *
 * Non-code assets referenced from shell chunks (workers, WASM, images) are
 * found by name, the way Vite writes `new URL("…", import.meta.url)` into the
 * code. Chunks and stylesheets named in a chunk's code are skipped: those are
 * dynamic imports and their preload lists, which are deliberately optional.
 */
export function planShell(bundle: Record<string, PlannedFile>, core: string[] = []): string[] {
  const files = Object.values(bundle);
  const shell = new Set<string>();
  const pending: string[] = [];
  const add = (fileName: string) => {
    if (!bundle[fileName] || shell.has(fileName)) return;
    shell.add(fileName);
    pending.push(fileName);
  };

  for (const file of files) {
    if (file.type !== "chunk") continue;
    if (
      file.isEntry ||
      file.moduleIds.some(
        (id) => ROUTE_MODULE.test(id) || core.some((relative) => isModule(id, relative)),
      )
    ) {
      add(file.fileName);
    }
  }

  const referable = files.filter(
    (file) =>
      file.type === "asset" &&
      !file.fileName.endsWith(".css") &&
      !NOT_REQUESTED.some((pattern) => pattern.test(file.fileName)),
  );

  while (pending.length) {
    const file = bundle[pending.pop()!];
    if (file.type !== "chunk") continue;
    for (const imported of file.imports) add(imported);
    for (const css of file.viteMetadata?.importedCss ?? []) add(css);
    for (const asset of file.viteMetadata?.importedAssets ?? []) add(asset);
    for (const asset of referable) {
      if (file.code.includes(basename(asset.fileName))) add(asset.fileName);
    }
  }
  return [...shell].sort();
}

/**
 * The full manifest. `extra` is hashed into the version so a change to the
 * worker's own code also installs a new worker.
 */
export function planOfflineManifest(
  bundle: Record<string, PlannedFile>,
  publicFiles: PublicFile[],
  extra = "",
  core: string[] = [],
): OfflineManifest {
  const entries = new Map<string, { bytes: number; hash: string }>();
  const record = (fileName: string, source: string | Uint8Array) => {
    if (NOT_REQUESTED.some((pattern) => pattern.test(fileName))) return;
    entries.set(fileName, { bytes: byteLength(source), hash: digest(source) });
  };
  for (const file of publicFiles) record(file.fileName, file.source);
  // Build output wins over a same-named public file, as it does on disk.
  for (const file of Object.values(bundle)) record(file.fileName, sourceOf(file));

  const names = [...entries.keys()].sort();
  const files: ManifestFile[] = names.map((fileName) => {
    const { bytes, hash } = entries.get(fileName)!;
    return [`/${fileName}`, bytes, HASHED.test(fileName) ? null : hash.slice(0, 16)];
  });

  const shell = planShell(bundle, core)
    .filter((fileName) => entries.has(fileName))
    .map((fileName) => `/${fileName}`);
  // Public files the shell HTML itself links to.
  if (entries.has("favicon.svg")) shell.push("/favicon.svg");

  // Names the shell cache, so it covers what is precached as well as the bytes.
  const version = createHash("sha256")
    .update(extra)
    .update(names.map((name) => `${name}:${entries.get(name)!.hash}`).join("\n"))
    .update(`\nshell:${shell.join("\n")}`)
    .digest("hex")
    .slice(0, 16);

  return { version, shell, files };
}
