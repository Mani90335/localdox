// Bundles the ```interactive-react preview runtime into one classic script and
// exposes its text as `virtual:interactive-frame-runtime`.
//
// The preview runs in a sandboxed frame with an opaque origin. Such a frame
// can't import the app's module chunks: module scripts are fetched with CORS,
// and neither the dev server, `vite preview` nor Firebase Hosting sends
// Access-Control-Allow-Origin for them. It used to load the app itself at
// /interactive-runtime, which failed on exactly that, and would have failed
// next on the app shell's service-worker registration. So the frame gets
// React and the runtime (src/services/interactive/frame-runtime.tsx) inline,
// through `srcdoc`: no CORS, no route, no request per frame.
//
// The text is exported from a module the reader imports on demand, so it is
// an optional capability like any other: downloaded with the first React
// example, cached for offline use like any other build file.

import path from "node:path";
import { build, type Plugin } from "vite";

const ID = "virtual:interactive-frame-runtime";
const RESOLVED_ID = `\0${ID}`;
const ENTRY = path.resolve(import.meta.dirname, "../src/services/interactive/frame-runtime.tsx");

type Bundle = { code: string; files: string[] };

async function bundle(mode: "development" | "production"): Promise<Bundle> {
  const result = await build({
    configFile: false,
    envDir: false,
    publicDir: false,
    root: path.dirname(ENTRY),
    logLevel: "warn",
    mode,
    define: { "process.env.NODE_ENV": JSON.stringify(mode) },
    build: {
      write: false,
      emptyOutDir: false,
      sourcemap: false,
      minify: mode === "production",
      lib: {
        entry: ENTRY,
        formats: ["iife"],
        name: "LocaldoxInteractiveRuntime",
        fileName: () => "runtime.js",
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs
    .flatMap((output) => ("output" in output ? output.output : []))
    .find((file) => file.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("interactive runtime: no output chunk");
  // The script is inlined into HTML, where `</script` is escaped. The parser
  // would still misread it after a `<!--` (script data escaped state, where a
  // later `<script` makes it skip the closing tag), so refuse one. React DOM
  // itself contains `<script`, which is harmless without the `<!--`.
  if (chunk.code.includes("<!--")) throw new Error("interactive runtime: output contains <!--");
  return {
    code: chunk.code,
    files: chunk.moduleIds.filter((id) => path.isAbsolute(id) && !id.includes("node_modules")),
  };
}

export function interactiveRuntime(): Plugin {
  let mode: "development" | "production" = "production";
  let built: Promise<Bundle> | null = null;
  return {
    name: "docucraft:interactive-runtime",
    configResolved(config) {
      mode = config.command === "serve" ? "development" : "production";
    },
    resolveId(id) {
      if (id === ID) return RESOLVED_ID;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return;
      // One bundle per build, shared by the client and server environments.
      // The dev server rebuilds whenever the runtime's own sources change.
      built ??= bundle(mode);
      const { code, files } = await built;
      for (const file of files) this.addWatchFile(file);
      return `export default ${JSON.stringify(code)};`;
    },
    watchChange(file) {
      if (file.startsWith(path.dirname(ENTRY))) built = null;
    },
  };
}
