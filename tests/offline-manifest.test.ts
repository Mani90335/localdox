import assert from "node:assert/strict";
import { test } from "node:test";
import {
  missingCoreModules,
  planOfflineManifest,
  planShell,
  type PlannedChunk,
  type PlannedFile,
} from "../build/offline-manifest.ts";

function chunk(fileName: string, options: Partial<PlannedChunk> = {}): PlannedChunk {
  return {
    type: "chunk",
    fileName,
    code: "",
    isEntry: false,
    imports: [],
    dynamicImports: [],
    moduleIds: [],
    viteMetadata: { importedCss: new Set(), importedAssets: new Set() },
    ...options,
  };
}

function asset(fileName: string, source: string | Uint8Array = fileName): PlannedFile {
  return { type: "asset", fileName, source };
}

function bundleOf(...files: PlannedFile[]): Record<string, PlannedFile> {
  return Object.fromEntries(files.map((file) => [file.fileName, file]));
}

/** A bundle shaped like the real one: entry, routes, and lazy capabilities. */
function appBundle() {
  return bundleOf(
    chunk("assets/index-A1.js", {
      isEntry: true,
      imports: ["assets/react-B2.js"],
      dynamicImports: ["assets/settings-C3.js", "assets/pdf-D4.js"],
      code: 'import"./react-B2.js";const r=()=>import("./settings-C3.js");__vite__mapDeps(["assets/pdf-D4.js","assets/pdf-E5.css"]);',
      viteMetadata: { importedCss: new Set(["assets/styles-F6.css"]), importedAssets: new Set() },
    }),
    chunk("assets/react-B2.js"),
    chunk("assets/settings-C3.js", {
      moduleIds: ["/app/src/routes/settings.tsx?tsr-split=component"],
      imports: ["assets/DocsApp-G7.js"],
    }),
    chunk("assets/DocsApp-G7.js", {
      code: 'new Worker(new URL("/assets/document-index.worker-H8.js",import.meta.url))',
    }),
    chunk("assets/pdf-D4.js", {
      imports: ["assets/pdfjs-I9.js"],
      code: 'new URL("/assets/pdf.worker-J0.mjs",import.meta.url)',
    }),
    chunk("assets/pdfjs-I9.js"),
    asset("assets/styles-F6.css"),
    asset("assets/pdf-E5.css"),
    asset("assets/document-index.worker-H8.js"),
    asset("assets/pdf.worker-J0.mjs"),
    asset("assets/index-A1.js.map"),
    asset("pdfjs/cmaps/UniJIS-UTF16-H.bcmap", new Uint8Array([1, 2, 3])),
  );
}

test("the shell is the entry and route graphs, their CSS and referenced workers", () => {
  assert.deepEqual(planShell(appBundle()), [
    "assets/DocsApp-G7.js",
    "assets/document-index.worker-H8.js",
    "assets/index-A1.js",
    "assets/react-B2.js",
    "assets/settings-C3.js",
    "assets/styles-F6.css",
  ]);
});

test("dynamic imports, their preload lists and their workers stay optional", () => {
  const shell = planShell(appBundle());
  for (const optional of [
    "assets/pdf-D4.js",
    "assets/pdfjs-I9.js",
    "assets/pdf-E5.css",
    "assets/pdf.worker-J0.mjs",
  ]) {
    assert.ok(!shell.includes(optional), optional);
  }
});

test("the manifest lists every requestable file with its size", () => {
  const manifest = planOfflineManifest(appBundle(), [
    { fileName: "favicon.svg", source: new TextEncoder().encode("<svg/>") },
    { fileName: "og-image.jpg", source: new Uint8Array(10) },
  ]);
  const urls = manifest.files.map(([url]) => url);
  assert.ok(urls.includes("/assets/pdf-D4.js"));
  assert.ok(urls.includes("/pdfjs/cmaps/UniJIS-UTF16-H.bcmap"));
  assert.ok(urls.includes("/favicon.svg"));
  // Crawler-only images, source maps and the worker itself are never fetched by the app.
  assert.ok(!urls.includes("/og-image.jpg"));
  assert.ok(!urls.includes("/assets/index-A1.js.map"));
  assert.ok(!urls.includes("/sw.js"));
  assert.deepEqual(
    manifest.files.find(([url]) => url === "/pdfjs/cmaps/UniJIS-UTF16-H.bcmap")?.[1],
    3,
  );
  assert.ok(manifest.shell.includes("/favicon.svg"));
  assert.ok(manifest.shell.includes("/assets/index-A1.js"));
  assert.ok(manifest.shell.every((url) => urls.includes(url)));
});

test("hashed names are their own key; other files carry a content tag", () => {
  const manifest = planOfflineManifest(appBundle(), [
    { fileName: "favicon.svg", source: new TextEncoder().encode("<svg/>") },
  ]);
  const tag = (url: string) => manifest.files.find(([u]) => u === url)?.[2];
  assert.equal(tag("/assets/index-A1.js"), null);
  assert.match(tag("/favicon.svg") ?? "", /^[0-9a-f]{16}$/);
  assert.match(tag("/pdfjs/cmaps/UniJIS-UTF16-H.bcmap") ?? "", /^[0-9a-f]{16}$/);
});

test("the version changes with any file's content or the worker code, and only then", () => {
  const publicFiles = [{ fileName: "favicon.svg", source: new TextEncoder().encode("<svg/>") }];
  const base = planOfflineManifest(appBundle(), publicFiles, "worker v1").version;
  assert.equal(planOfflineManifest(appBundle(), publicFiles, "worker v1").version, base);

  const edited = appBundle();
  (edited["assets/pdfjs-I9.js"] as PlannedChunk).code = "changed";
  assert.notEqual(planOfflineManifest(edited, publicFiles, "worker v1").version, base);

  const icon = [{ fileName: "favicon.svg", source: new TextEncoder().encode("<svg></svg>") }];
  const iconVersion = planOfflineManifest(appBundle(), icon, "worker v1");
  assert.notEqual(iconVersion.version, base);
  assert.notEqual(
    iconVersion.files.find(([url]) => url === "/favicon.svg")?.[2],
    planOfflineManifest(appBundle(), publicFiles).files.find(
      ([url]) => url === "/favicon.svg",
    )?.[2],
  );

  assert.notEqual(planOfflineManifest(appBundle(), publicFiles, "worker v2").version, base);
});

test("build output replaces a public file of the same name", () => {
  const manifest = planOfflineManifest(bundleOf(asset("robots.txt", "from build")), [
    { fileName: "robots.txt", source: new TextEncoder().encode("from public, longer") },
  ]);
  assert.deepEqual(
    manifest.files.filter(([url]) => url === "/robots.txt").map(([, bytes]) => bytes),
    [10],
  );
});

test("named core modules join the shell with their static imports", () => {
  const bundle = appBundle();
  Object.assign(
    bundle,
    bundleOf(
      chunk("assets/SettingsPage-K1.js", {
        moduleIds: ["/app/src/components/docs/pages/SettingsPage.tsx", "/app/src/x.ts"],
        imports: ["assets/tabs-L2.js"],
      }),
      chunk("assets/tabs-L2.js"),
      chunk("assets/OtherSettingsPage-M3.js", {
        moduleIds: ["/app/src/components/docs/pages/OtherSettingsPage.tsx"],
      }),
    ),
  );
  const core = ["src/components/docs/pages/SettingsPage.tsx"];
  assert.ok(!planShell(bundle).includes("assets/SettingsPage-K1.js"));
  const shell = planShell(bundle, core);
  assert.ok(shell.includes("assets/SettingsPage-K1.js"));
  assert.ok(shell.includes("assets/tabs-L2.js"));
  // A path is matched whole, not as a suffix of a longer file name.
  assert.ok(!shell.includes("assets/OtherSettingsPage-M3.js"));
  assert.deepEqual(missingCoreModules(bundle, core), []);
  assert.deepEqual(missingCoreModules(bundle, ["src/components/docs/pages/Renamed.tsx"]), [
    "src/components/docs/pages/Renamed.tsx",
  ]);
});

test("the version changes when the precached set changes, even with the same files", () => {
  const bundle = appBundle();
  Object.assign(
    bundle,
    bundleOf(
      chunk("assets/SavedPage-N4.js", {
        moduleIds: ["/app/src/components/docs/pages/SavedPage.tsx"],
      }),
    ),
  );
  const without = planOfflineManifest(bundle, [], "worker");
  const withCore = planOfflineManifest(bundle, [], "worker", [
    "src/components/docs/pages/SavedPage.tsx",
  ]);
  assert.deepEqual(withCore.files, without.files);
  assert.notEqual(withCore.version, without.version);
});
