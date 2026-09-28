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
    // Emits /sw.js so the app reopens offline. See the plugin's header.
    offlineShell({
      // Lazy, but needed offline without a download: opening local files of
      // any kind, Settings (including the offline status) and Saved.
      core: [
        "src/components/docs/viewer/DocumentViewer.tsx",
        "src/components/docs/pages/SettingsPage.tsx",
        "src/components/docs/pages/SavedPage.tsx",
      ],
    }),
    nitro({ preset: "node-server" }),
  ],
  resolve: {
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
