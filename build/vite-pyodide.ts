// Publishes the advanced math engine (Pyodide + SymPy, see pyodide-packages.ts)
// under a versioned `/pyodide/<version>/`, in dev and in the build, and tells
// the app where it is and how big it is through `virtual:pyodide-assets`.
//
// The files are optional: nothing references them until a reader asks for an
// advanced computation, so the offline shell doesn't precache them; the
// service worker caches them on first use, or with "Download all features".

import { createReadStream, promises as fs } from "node:fs";
import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";
import { pyodideAssets, type PyodideAssets } from "./pyodide-packages";
import { contentType } from "./vite-asset-utils";

const ID = "virtual:pyodide-assets";
const RESOLVED = `\0${ID}`;

export function pyodide(): Plugin {
  let assets: Promise<PyodideAssets> | null = null;
  let module: Promise<string> | null = null;
  const load = (log?: (message: string) => void) => (assets ??= pyodideAssets({ log }));

  return {
    name: "docucraft:pyodide",

    resolveId(id) {
      return id === ID ? RESOLVED : undefined;
    },

    load(id) {
      if (id !== RESOLVED) return;
      module ??= load().then(async ({ base, version, files }) => {
        // What the reader downloads, compressed, for the consent message.
        let bytes = 0;
        for (const file of files) {
          bytes += gzipSync(file.text ?? (await fs.readFile(file.path!))).length;
        }
        return `export const PYODIDE_BASE = ${JSON.stringify(base)};
export const PYODIDE_VERSION = ${JSON.stringify(version)};
export const PYODIDE_DOWNLOAD_BYTES = ${bytes};`;
      });
      return module;
    },

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0];
        if (!url?.startsWith("/pyodide/")) return next();
        const { base, files } = await load((message) => server.config.logger.info(message));
        // Only the listed names are served: no path is ever built from the request.
        const file = url.startsWith(base)
          ? files.find((f) => f.name === url.slice(base.length))
          : null;
        if (!file) return next();
        res.setHeader(
          "Content-Type",
          file.name.endsWith(".wasm") ? "application/wasm" : contentType(file.name),
        );
        res.setHeader("Cache-Control", "public, max-age=3600");
        if (file.text !== undefined) res.end(file.text);
        else createReadStream(file.path!).pipe(res);
      });
    },

    // Published by the client build only; the server build just resolves the module.
    async generateBundle() {
      if (this.environment.name !== "client") return;
      const { base, files } = await load((message) => this.info(message));
      for (const file of files) {
        this.emitFile({
          type: "asset",
          fileName: `${base.slice(1)}${file.name}`,
          source: file.text ?? (await fs.readFile(file.path!)),
        });
      }
    },
  };
}
