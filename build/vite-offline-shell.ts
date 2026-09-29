// Emits `/sw.js`, the service worker that lets Localdox reopen offline.
//
// The worker's logic lives in `offline-sw.js`; this plugin prepends the build's
// manifest (see `offline-manifest.ts` for what goes in it). Client build only:
// the dev server serves modules individually and registers no worker.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { walk } from "./vite-asset-utils";
import {
  missingCoreModules,
  planOfflineManifest,
  type PlannedFile,
  type PublicFile,
} from "./offline-manifest";

const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), "offline-sw.js");

export function offlineShell(
  options: {
    /**
     * Lazily loaded source modules that belong to the app itself rather than
     * an optional capability, as repo-relative paths. They are cached at
     * install with the shell; the build fails if one matches no chunk.
     */
    core?: string[];
  } = {},
): Plugin {
  const core = options.core ?? [];
  let publicDir = "";

  return {
    name: "docucraft:offline-shell",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",

    configResolved(config) {
      publicDir = config.publicDir;
    },

    generateBundle: {
      // After the pdf.js and MathJax plugins have emitted their assets.
      order: "post",
      async handler(_options, bundle) {
        const planned = bundle as unknown as Record<string, PlannedFile>;
        const missing = missingCoreModules(planned, core);
        if (missing.length) {
          this.error(`Offline shell: no chunk contains ${missing.join(", ")}`);
        }
        const publicFiles: PublicFile[] = [];
        if (publicDir) {
          for (const relative of await walk(publicDir).catch(() => [])) {
            publicFiles.push({
              fileName: relative.split(path.sep).join("/"),
              source: await fs.readFile(path.join(publicDir, relative)),
            });
          }
        }
        const template = await fs.readFile(TEMPLATE, "utf8");
        const manifest = planOfflineManifest(planned, publicFiles, template, core);
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: `self.__LOCALDOX_OFFLINE__ = ${JSON.stringify(manifest)};\n${template}`,
        });
      },
    },
  };
}
