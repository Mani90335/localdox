// Publishes pdf.js's cmaps and standard-font data as static assets under
// `/pdfjs/`, in dev and in the build.
//
// pdf.js needs these two directories to render a meaningful slice of
// real-world PDFs correctly: `cmaps/` for CJK/Type0 embedded fonts,
// `standard_fonts/` for glyphs (Symbol, ZapfDingbats, …) that a PDF is
// allowed to reference without embedding. Skipping them is the most common
// cause of "some PDFs render with missing or garbled glyphs" bugs in a
// hand-rolled pdf.js integration. `getDocument()`'s `cMapUrl` and
// `standardFontDataUrl` point here; pdf.js fetches individual files from
// them lazily, only for the encodings a given document actually uses, so
// publishing the whole ~2.4 MB set costs nothing until then.
//
// Copied from `node_modules` rather than vendored into `public/`, matching
// `vite-mathjax-asset.ts`: keeps generated vendor bytes out of the repository
// and pinned to whatever `pdfjs-dist` version is installed.

import { createReadStream, existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";
import { walk, contentType } from "./vite-asset-utils";

const require = createRequire(import.meta.url);

/** Public path prefix. Must match `PDFJS_PREFIX` wherever `getDocument()` is called. */
const PREFIX = "/pdfjs/";

const DIRS = ["cmaps", "standard_fonts"] as const;

function packageRoot(): string | null {
  try {
    return path.dirname(require.resolve("pdfjs-dist/package.json"));
  } catch {
    return null;
  }
}

/** License text isn't runtime glyph/encoding data pdf.js will ever request. */
function isPublished(relativePosix: string): boolean {
  return !/(^|\/)LICENSE/i.test(relativePosix);
}

export function pdfjsAssets(): Plugin {
  const root = packageRoot();

  return {
    name: "docucraft:pdfjs-assets",

    // Dev: serve straight out of node_modules. No copying, so an upgrade
    // takes effect on the next reload.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        if (!root || !url?.startsWith(PREFIX)) return next();

        const requested = url.slice(PREFIX.length);
        if (!DIRS.some((dir) => requested === dir || requested.startsWith(`${dir}/`))) {
          return next();
        }

        // Contained to the package directory: a `..` in the request must not
        // be able to read the rest of the machine.
        const relative = path.normalize(requested);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }

        const file = path.join(root, relative);
        if (!file.startsWith(root + path.sep) || !existsSync(file)) return next();

        res.setHeader("Content-Type", contentType(file));
        // The version is pinned by package.json, so a long cache is safe in
        // dev and matches what the build emits.
        res.setHeader("Cache-Control", "public, max-age=3600");
        createReadStream(file).pipe(res);
      });
    },

    // Build: emit both directories as assets at the same paths.
    async generateBundle() {
      if (!root) {
        this.warn("pdfjs-dist is not installed — PDF cmaps/fonts will not be published");
        return;
      }
      for (const dir of DIRS) {
        const dirRoot = path.join(root, dir);
        for (const relative of await walk(dirRoot)) {
          const posix = relative.split(path.sep).join("/");
          if (!isPublished(posix)) continue;
          const source = await fs.readFile(path.join(dirRoot, relative));
          this.emitFile({ type: "asset", fileName: `pdfjs/${dir}/${posix}`, source });
        }
      }
    },
  };
}
