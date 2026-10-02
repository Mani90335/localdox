import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";
import path from "path";
import { mathjaxAsset } from "./build/vite-mathjax-asset";
import { pdfjsAssets } from "./build/vite-pdfjs-assets";
import { offlineShell } from "./build/vite-offline-shell";
import { interactiveRuntime } from "./build/vite-interactive-runtime";
import { bundleReport } from "./build/vite-bundle-report";
import { pyodide } from "./build/vite-pyodide";

export default defineConfig({
  plugins: [
    tanstackStart({
      server: { entry: "server" },
      // Generate TanStack Start's client-only HTML shell for Firebase Hosting.
      spa: {
        enabled: true,
        prerender: {
          crawlLinks: true,
        },
      },
    }),
    viteReact(),
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    // MathJax 4 is the math fallback, loaded by URL rather than imported — see
    // the plugin's own header for why, and `src/services/math/adapters/mathjax.ts`
    // for the consumer.
    mathjaxAsset(),
    pdfjsAssets(),
    // The ```interactive-react preview runtime, inlined into its sandboxed
    // frame. See the plugin's header.
    interactiveRuntime(),
    // The advanced math engine (Pyodide + SymPy), published under /pyodide/.
    pyodide(),
    // Emits /sw.js so the app reopens offline. See the plugin's header.
    offlineShell({
      // Lazy, but needed offline without a download: reading and editing
      // Markdown, opening local files of any kind, Settings (including the
      // offline status).
      core: [
        "src/components/docs/viewer/MarkdownViewer.tsx",
        "src/components/docs/editor/MarkdownEditor.tsx",
        "src/components/docs/viewer/DocumentViewer.tsx",
        "src/components/docs/pages/SettingsPage.tsx",
        // Split view's panes.
        "src/components/ui/resizable.tsx",
        // Search's main-thread fallback, for when the worker can't start.
        "src/lib/search/local-search-client.ts",
      ],
    }),
    // Run after the offline manifest: diagnostic metadata isn't an offline asset.
    bundleReport(),
    nitro({ preset: "node-server" }),
  ],
  resolve: {
    // Reader, Mermaid labels and rehype-katex export use the same renderer.
    // Otherwise their nested 0.16 installs duplicate the app's 0.17 runtime.
    dedupe: ["katex"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    // The WASM glue is already ESM. Keep its relative binary URL intact and
    // prevent first conversion from triggering a dependency-discovery reload.
    exclude: ["@firecrawl/anydoc-wasm"],
    // Pre-bundling is a dev-server optimization, independent of production
    // code splitting. Excluding these libraries causes large module waterfalls
    // and leaves CommonJS imports unconverted when a viewer is first opened.
    include: [
      "mermaid",
      "@babel/standalone",
      "xlsx",
      "mammoth/mammoth.browser",
      "dayjs",
      "@braintree/sanitize-url",
      "cytoscape",
      "cytoscape-cose-bilkent",
      "cytoscape-fcose",
      "pdfjs-dist",
      // Boards' pen strokes. Discovered at runtime instead, it makes the dev
      // server re-bundle every dependency and reload the page on first open.
      "perfect-freehand",
    ],
  },
  build: {
    // Terser-grade minification is worth the build time here: the app ships a
    // large markdown pipeline, and this is the cheapest win for low-end devices
    // on slow connections.
    cssMinify: "lightningcss",
    // These are all code-split now; anything still large is a real regression
    // rather than an expected big vendor chunk.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Keep the client React runtime in one long-lived chunk. HTML export's
        // server entry and both CJS renderers must stay behind its lazy import.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (
            /[\\/]node_modules[\\/]react-dom[\\/](?:server[.\\/]|cjs[\\/]react-dom-server)/.test(id)
          )
            return "react-dom-server";
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
        },
      },
    },
  },
});
