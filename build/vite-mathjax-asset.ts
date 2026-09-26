// Publishes MathJax's prebuilt bundle and its font package as static assets
// under `/vendor/`, in dev and in the build.
//
// MathJax 4 ships as a self-executing IIFE that configures itself from
// `window.MathJax` and expects to be loaded by a `<script>` tag. Importing it
// as a module would pull ~1 MB into a Vite chunk *and* run it during module
// evaluation, before its configuration could be assigned — so it has to be a
// plain URL. Copying it from `node_modules` at build time rather than vendoring
// it into `public/` keeps a megabyte of generated code out of the repository
// and keeps the served copy pinned to whatever version is installed.
//
// MathJax 4 keeps its fonts in a separate package (`@mathjax/mathjax-newcm-font`)
// and resolves them through its own loader under the name
// `@mathjax/mathjax-newcm-font/js/…`. That name has to resolve to a URL in the
// browser, which is why *both* packages are published here and why the adapter
// configures `loader.paths` to point at them. Fonts are loaded lazily by
// MathJax as glyphs are needed, so publishing the whole set costs nothing until
// a document actually uses it.

import { createReadStream, existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

const require = createRequire(import.meta.url);

/** Public path prefix. Must match `VENDOR_PREFIX` in the adapter. */
const PREFIX = "/vendor/";

/** The one MathJax bundle the app loads. */
const ENTRY = "tex-mml-chtml.js";

/**
 * Package name → published directory under the prefix. The font package's name
 * is preserved so MathJax's own `@mathjax/…` loader path resolves against it.
 */
const PACKAGES = [
  { name: "mathjax", dir: "mathjax" },
  { name: "@mathjax/mathjax-newcm-font", dir: "@mathjax/mathjax-newcm-font" },
] as const;

function packageRoot(name: string): string | null {
  try {
    return path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    return null;
  }
}

/** Every file under a directory, as paths relative to it. */
async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full));
  }
  return out;
}

/**
 * Which files of a package are published.
 *
 * MathJax's own package is huge (every input/output combination, the full
 * source-map set) and the app loads exactly one bundle from it. The font
 * package, by contrast, is fetched piecemeal by MathJax at runtime, so its
 * runtime directories go over whole — but not its type declarations or maps.
 */
function publishedPaths(pkg: string, relative: string): string[] {
  const posix = relative.split(path.sep).join("/");
  if (posix.endsWith(".map") || posix.endsWith(".d.ts")) return [];
  if (pkg === "mathjax") return posix === ENTRY ? [posix] : [];

  // Font package. The woff2 files are fetched at their own path; the glyph
  // modules are imported as `…/js/chtml/…`, which the package's own exports map
  // to `mjs/` — a mapping the browser cannot perform. Published at the `js`
  // path only, since that is the single name MathJax actually requests;
  // publishing both doubled ~1.5 MB of assets for no reader.
  if (posix.startsWith("chtml/woff2/")) return [posix];
  if (posix.startsWith("mjs/chtml/")) return [`js/${posix.slice("mjs/".length)}`];
  return [];
}

export function mathjaxAsset(): Plugin {
  const roots = new Map<string, string>();
  for (const pkg of PACKAGES) {
    const root = packageRoot(pkg.name);
    if (root) roots.set(pkg.dir, root);
  }

  return {
    name: "docucraft:mathjax-asset",

    // Dev: serve straight out of node_modules. No copying, so an upgrade takes
    // effect on the next reload.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        if (!url?.startsWith(PREFIX)) return next();

        const requested = url.slice(PREFIX.length);
        // Longest prefix first, so `@mathjax/mathjax-newcm-font` is matched
        // before any shorter directory that happens to share its start.
        const match = [...roots.entries()]
          .sort((a, b) => b[0].length - a[0].length)
          .find(([dir]) => requested === dir || requested.startsWith(`${dir}/`));
        if (!match) return next();

        const [dir, root] = match;
        // Contained to the package directory: a `..` in the request must not be
        // able to read the rest of the machine.
        const relative = path.normalize(requested.slice(dir.length + 1));
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }

        // `js/chtml/…` is the name MathJax imports fonts by; the package's own
        // exports map it to `mjs/`, which the browser cannot do for itself.
        const onDisk = relative.startsWith(`js${path.sep}`)
          ? path.join("mjs", relative.slice(3))
          : relative;

        const file = path.join(root, onDisk);
        if (!file.startsWith(root + path.sep) || !existsSync(file)) return next();

        res.setHeader("Content-Type", contentType(file));
        // The version is pinned by package.json, so a long cache is safe in dev
        // and matches what the build emits.
        res.setHeader("Cache-Control", "public, max-age=3600");
        createReadStream(file).pipe(res);
      });
    },

    // Build: emit the bundle and the font package as assets at the same paths.
    async generateBundle() {
      if (!roots.has("mathjax")) {
        this.warn("mathjax is not installed — the MathJax fallback will not be available");
        return;
      }

      for (const [dir, root] of roots) {
        for (const relative of await walk(root)) {
          const targets = publishedPaths(dir === "mathjax" ? "mathjax" : "font", relative);
          if (!targets.length) continue;
          const source = await fs.readFile(path.join(root, relative));
          for (const target of targets) {
            this.emitFile({ type: "asset", fileName: `vendor/${dir}/${target}`, source });
          }
        }
      }
    },
  };
}

function contentType(file: string): string {
  if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".woff2")) return "font/woff2";
  if (file.endsWith(".woff")) return "font/woff";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}
