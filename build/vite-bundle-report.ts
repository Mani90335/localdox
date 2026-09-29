import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";

/** Build evidence only: never imported by the application or offline catalog. */
export function bundleReport(): Plugin {
  return {
    name: "localdox:bundle-report",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const files = Object.values(bundle).map((file) => {
          const bytes = Buffer.from(file.type === "chunk" ? file.code : file.source);
          return {
            file: file.fileName,
            bytes: bytes.length,
            gzip: gzipSync(bytes).length,
            ...(file.type === "chunk"
              ? {
                  imports: file.imports,
                  dynamicImports: file.dynamicImports,
                  modules: Object.keys(file.modules).map((id) =>
                    id.replaceAll("\\", "/").replace(`${process.cwd().replaceAll("\\", "/")}/`, ""),
                  ),
                }
              : {}),
          };
        });
        this.emitFile({
          type: "asset",
          fileName: "bundle-report.json",
          source: JSON.stringify({ files }, null, 2),
        });
      },
    },
  };
}
