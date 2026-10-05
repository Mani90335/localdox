// The files the advanced math engine (Pyodide + SymPy) needs, gathered for the
// build, the dev server and the unit tests.
//
// Pyodide itself comes from the `pyodide` npm package, pinned in package.json
// and checked by bun.lock. SymPy and mpmath are Python wheels Pyodide does not
// ship on npm, so they are downloaded once from Pyodide's own release (the
// same version) into node_modules/.cache, and each is checked against the
// SHA-256 that the npm package's pyodide-lock.json records. The chain of trust
// is bun.lock → pyodide package → its lock file → the wheels: a wheel that
// doesn't match is refused, never published.
//
// Only what SymPy needs is published, with a lock file trimmed to those two
// packages, so Pyodide can't be asked to load anything else.

import { createHash } from "node:crypto";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

/** Python packages loaded on top of Pyodide's standard library. */
export const PYTHON_PACKAGES = ["sympy", "mpmath"] as const;

/** Pyodide's runtime files, published as they are. */
const RUNTIME = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip"];

export interface PublishedFile {
  /** File name under the published directory. */
  name: string;
  /** Where it is read from: a path on disk, or generated text. */
  path?: string;
  text?: string;
}

export interface PyodideAssets {
  version: string;
  /** Public path, e.g. "/pyodide/314.0.7/". Versioned, so files never go stale. */
  base: string;
  files: PublishedFile[];
}

interface LockPackage {
  name: string;
  version: string;
  file_name: string;
  sha256: string;
  depends: string[];
}
interface Lock {
  info: Record<string, unknown>;
  packages: Record<string, LockPackage>;
}

export function pyodideRoot(): string {
  return path.dirname(require.resolve("pyodide/package.json"));
}

export function pyodideVersion(root = pyodideRoot()): string {
  return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
}

export interface AssetOptions {
  log?: (message: string) => void;
  /** Where wheels are kept between builds; node_modules/.cache by default. */
  cacheDir?: string;
  fetch?: typeof fetch;
}

function defaultCacheDir(version: string): string {
  return path.join(process.cwd(), "node_modules", ".cache", "localdox-pyodide", version);
}

async function sha256(file: string): Promise<string> {
  return createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
}

/**
 * Every published file, wheels downloaded (once) and verified. Throws when a
 * wheel can't be fetched or doesn't match its recorded hash.
 */
export async function pyodideAssets({
  log = () => {},
  cacheDir,
  fetch: download = fetch,
}: AssetOptions = {}): Promise<PyodideAssets> {
  const root = pyodideRoot();
  const version = pyodideVersion(root);
  const lock: Lock = JSON.parse(await fs.readFile(path.join(root, "pyodide-lock.json"), "utf8"));
  const dir = cacheDir ?? defaultCacheDir(version);
  await fs.mkdir(dir, { recursive: true });

  const wanted = Object.values(lock.packages).filter((entry) =>
    (PYTHON_PACKAGES as readonly string[]).includes(entry.name),
  );
  if (wanted.length !== PYTHON_PACKAGES.length) {
    throw new Error(`pyodide ${version}'s lock file doesn't list ${PYTHON_PACKAGES.join(", ")}`);
  }
  const wheels: PublishedFile[] = [];
  for (const entry of wanted) {
    const file = path.join(dir, entry.file_name);
    if (!existsSync(file) || (await sha256(file)) !== entry.sha256) {
      const url = `https://cdn.jsdelivr.net/pyodide/v${version}/full/${entry.file_name}`;
      log(`Downloading ${entry.file_name} for the advanced math engine`);
      const response = await download(url);
      if (!response.ok) throw new Error(`Couldn't download ${url}: ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== entry.sha256) {
        throw new Error(
          `${entry.file_name} doesn't match pyodide-lock.json (sha256 ${digest}, expected ${entry.sha256})`,
        );
      }
      await fs.writeFile(file, bytes);
    }
    wheels.push({ name: entry.file_name, path: file });
  }

  const trimmed: Lock = {
    info: lock.info,
    packages: Object.fromEntries(wanted.map((entry) => [entry.name, entry])),
  };
  return {
    version,
    base: `/pyodide/${version}/`,
    files: [
      ...RUNTIME.map((name) => ({ name, path: path.join(root, name) })),
      { name: "pyodide-lock.json", text: JSON.stringify(trimmed) },
      ...wheels,
    ],
  };
}

/** Copies the published layout into `dir` (for the unit tests, which run Pyodide in Node). */
export async function mirrorPyodide(dir: string, options?: AssetOptions): Promise<PyodideAssets> {
  const assets = await pyodideAssets(options);
  await fs.mkdir(dir, { recursive: true });
  for (const file of assets.files) {
    const target = path.join(dir, file.name);
    if (file.text !== undefined) await fs.writeFile(target, file.text);
    else if (!existsSync(target)) await fs.copyFile(file.path!, target);
  }
  return assets;
}
