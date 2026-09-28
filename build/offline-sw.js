// Localdox offline service worker.
//
// `build/vite-offline-shell.ts` prepends `self.__LOCALDOX_OFFLINE__`, the
// build's manifest: `version`, the `shell` URLs a cold start needs, and every
// build `file` as `[url, bytes, tag]` (tag is null for content-hashed names).
//
// Policy:
// - Install precaches the shell for this version. The worker never calls
//   skipWaiting(): an open tab keeps the worker (and assets) it started with,
//   and a new version takes over once every Localdox tab has closed.
// - Navigations go to the network first, so an online reload always gets the
//   current deployment. With no network (or none within a few seconds), the
//   cached SPA shell answers, and the router renders the requested path.
// - Build files are served from cache, and cached on first use. Documents are
//   in IndexedDB and never pass through here; other origins (AI providers,
//   the share service) and non-GET requests are left alone.
// - A page can ask for status, or to download every file up front, through a
//   MessageChannel (see src/lib/offline/offline-shell.ts).

const MANIFEST = self.__LOCALDOX_OFFLINE__;
const VERSION = MANIFEST.version;
const SHELL_CACHE = `localdox-shell-${VERSION}`;
const SHELL_PREFIX = "localdox-shell-";
/** Shared across versions: hashed names can't go stale, tagged ones carry their hash. */
const ASSET_CACHE = "localdox-assets";
const SHELL_HTML = "/_shell.html";
const NAVIGATION_TIMEOUT_MS = 5000;
const CONCURRENCY = 4;

/** pathname → { bytes, key }. The key is the URL cached for that file. */
const FILES = new Map();
for (const [url, bytes, tag] of MANIFEST.files) {
  FILES.set(url, { bytes, key: tag ? `${url}?v=${tag}` : url });
}

const absolute = (url) => new URL(url, self.location.origin).href;

/**
 * Whether a 200 answer is really the file asked for. The host rewrites unknown
 * paths to the SPA shell, so after a deployment an old chunk comes back as
 * HTML with status 200. Cached, that would answer every later request for the
 * script with a page.
 */
const isFile = (url, response) =>
  response.status === 200 &&
  response.type === "basic" &&
  (url.endsWith(".html") || !/text\/html/i.test(response.headers.get("content-type") ?? ""));

/** Runs `task` over `items`, `limit` at a time. Stops starting new ones after a failure. */
async function pool(items, limit, task) {
  let next = 0;
  let failure = null;
  const run = async () => {
    while (!failure && next < items.length) {
      const item = items[next++];
      try {
        await task(item);
      } catch (error) {
        failure ??= error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  if (failure) throw failure;
}

/** Fetches a file for caching; hashed assets may come from the HTTP cache. */
async function fetchForCache(url) {
  const response = await fetch(url, { cache: url.startsWith("/assets/") ? "default" : "no-cache" });
  if (!isFile(url, response)) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  // A redirected response can't answer a navigation; keep only its content.
  return response.redirected
    ? new Response(await response.blob(), { status: 200, headers: response.headers })
    : response;
}

async function storeFile(cache, url) {
  const { key } = FILES.get(url);
  // Unchanged files are carried over from an earlier version's caches.
  const existing = await caches.match(key);
  await cache.put(key, existing ?? (await fetchForCache(url)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(SHELL_HTML, await fetchForCache(SHELL_HTML));
      await pool(MANIFEST.shell, CONCURRENCY, (url) => storeFile(cache, url));
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // No tab runs an older version any more (that is when activation happens).
      for (const name of await caches.keys()) {
        if (name.startsWith(SHELL_PREFIX) && name !== SHELL_CACHE) await caches.delete(name);
      }
      const keep = new Set([...FILES.values()].map((file) => absolute(file.key)));
      const assets = await caches.open(ASSET_CACHE);
      for (const request of await assets.keys()) {
        if (!keep.has(request.url)) await assets.delete(request);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
    return;
  }
  const file = !url.search && FILES.get(url.pathname);
  if (file) event.respondWith(fromCache(event, request, file));
});

async function shellResponse() {
  const own = await caches.open(SHELL_CACHE).then((cache) => cache.match(SHELL_HTML));
  return own ?? (await caches.match(SHELL_HTML));
}

async function navigate(request) {
  const network = fetch(request);
  const shell = await shellResponse();
  if (!shell) return network;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Navigation timed out")), NAVIGATION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([network, timeout]);
  } catch {
    network.catch(() => {});
    return shell;
  } finally {
    clearTimeout(timer);
  }
}

async function fromCache(event, request, file) {
  const cached = await caches.match(file.key);
  if (cached) return cached;
  const response = await fetch(request);
  if (isFile(new URL(request.url).pathname, response)) {
    const copy = response.clone();
    event.waitUntil(
      caches
        .open(ASSET_CACHE)
        .then((cache) => cache.put(file.key, copy))
        .catch(() => {}),
    );
  }
  return response;
}

/** Absolute URLs of every cached entry, across this worker's caches. */
async function cachedKeys() {
  const keys = new Set();
  for (const name of await caches.keys()) {
    if (name !== ASSET_CACHE && !name.startsWith(SHELL_PREFIX)) continue;
    for (const request of await (await caches.open(name)).keys()) keys.add(request.url);
  }
  return keys;
}

async function status() {
  const keys = await cachedKeys();
  const shellCache = await caches.open(SHELL_CACHE);
  let cachedFiles = 0;
  let cachedBytes = 0;
  let totalBytes = 0;
  for (const file of FILES.values()) {
    totalBytes += file.bytes;
    if (keys.has(absolute(file.key))) {
      cachedFiles++;
      cachedBytes += file.bytes;
    }
  }
  const shellReady =
    !!(await shellCache.match(SHELL_HTML)) &&
    MANIFEST.shell.every((url) => keys.has(absolute(FILES.get(url).key)));
  return {
    version: VERSION,
    shellReady,
    cachedFiles,
    totalFiles: FILES.size,
    cachedBytes,
    totalBytes,
    downloading: !!download,
  };
}

/** The one download in progress; later requests join it. */
let download = null;
const downloadPorts = new Set();

function broadcast(message) {
  for (const port of downloadPorts) port.postMessage(message);
}

async function downloadAll() {
  const keys = await cachedKeys();
  const shellCache = await caches.open(SHELL_CACHE);
  if (!(await shellCache.match(SHELL_HTML))) {
    await shellCache.put(SHELL_HTML, await fetchForCache(SHELL_HTML));
  }
  const missing = [...FILES].filter(([, file]) => !keys.has(absolute(file.key)));
  const totalBytes = missing.reduce((sum, [, file]) => sum + file.bytes, 0);
  const cache = await caches.open(ASSET_CACHE);
  let doneBytes = 0;
  let failed = 0;
  broadcast({ type: "progress", doneBytes, totalBytes });
  await pool(missing, CONCURRENCY, async ([url, file]) => {
    try {
      await cache.put(file.key, await fetchForCache(url));
    } catch (error) {
      // Storage is full: every further write fails too, so stop here.
      if (error && error.name === "QuotaExceededError") throw error;
      failed++;
    }
    doneBytes += file.bytes;
    broadcast({ type: "progress", doneBytes, totalBytes });
  });
  return { failed };
}

/** Caches build files a page loaded before this worker controlled it. */
async function cacheLoaded(urls) {
  const cache = await caches.open(ASSET_CACHE);
  const keys = await cachedKeys();
  const wanted = new Set();
  for (const href of Array.isArray(urls) ? urls : []) {
    let url;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    if (url.origin !== self.location.origin || url.search) continue;
    const file = FILES.get(url.pathname);
    if (file && !keys.has(absolute(file.key))) wanted.add(url.pathname);
  }
  await pool([...wanted], CONCURRENCY, async (url) => {
    try {
      await cache.put(FILES.get(url).key, await fetchForCache(url));
    } catch {
      // Best effort: it is cached on its next use instead.
    }
  });
}

function reply(port, work) {
  return work.then(
    (result) => port.postMessage({ ok: true, result }),
    (error) =>
      port.postMessage({
        ok: false,
        error: { name: error?.name ?? "Error", message: String(error?.message ?? error) },
      }),
  );
}

self.addEventListener("message", (event) => {
  const data = event.data ?? {};
  const port = event.ports[0];
  if (data.type === "cache-loaded") {
    event.waitUntil(cacheLoaded(data.urls));
  } else if (data.type === "status" && port) {
    event.waitUntil(reply(port, status()));
  } else if (data.type === "download" && port) {
    downloadPorts.add(port);
    download ??= downloadAll().finally(() => {
      download = null;
      downloadPorts.clear();
    });
    event.waitUntil(reply(port, download));
  }
});
