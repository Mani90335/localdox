// Run with no concurrent builds/tests: node scripts/bench-binary-storage.mjs
// Uses an isolated browser profile and its own temporary database. No app data.
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
try {
  const page = await browser.newPage();
  await page.route("http://binary-benchmark.local/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Binary storage measurement</title>",
    }),
  );
  await page.goto("http://binary-benchmark.local/");
  const results = await page.evaluate(async () => {
    const bytesPerFile = 5 * 1024 * 1024;
    const fileCount = 8;
    const rows = [];
    const name = "localdox-binary-benchmark";
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("files", { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const commit = (records) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction("files", "readwrite");
        const store = tx.objectStore("files");
        store.clear();
        for (const record of records) store.put(record);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    const read = () =>
      new Promise((resolve, reject) => {
        const tx = db.transaction("files");
        const req = tx.objectStore("files").getAll();
        tx.oncomplete = () => resolve(req.result);
        tx.onabort = () => reject(tx.error);
      });
    for (let run = 0; run < 5; run++) {
      // Alternate order to reduce order bias. Same deterministic bytes in both.
      for (const format of run % 2 ? ["blob", "data-url"] : ["data-url", "blob"]) {
        let records = [];
        const start = performance.now();
        for (let id = 0; id < fileCount; id++) {
          const bytes = new Uint8Array(bytesPerFile);
          let seed = id + 1;
          for (let i = 0; i < bytes.length; i++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            bytes[i] = seed >>> 24;
          }
          const blob = new Blob([bytes], { type: "application/pdf" });
          const data =
            format === "blob"
              ? { id: `body-${id}`, blob }
              : await new Promise((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(reader.result);
                  reader.onerror = () => reject(reader.error);
                  reader.readAsDataURL(blob);
                });
          records.push({ id, name: `${id}.pdf`, content: "", data });
        }
        const prepareMs = performance.now() - start;
        const logicalBodyBytes = records.reduce(
          (sum, file) =>
            sum + (typeof file.data === "string" ? file.data.length : file.data.blob.size),
          0,
        );
        const writeStart = performance.now();
        await commit(records);
        const writeMs = performance.now() - writeStart;
        records = [];
        const readStart = performance.now();
        const loaded = await read();
        const readMs = performance.now() - readStart;
        rows.push({
          run: run + 1,
          format,
          logicalBodyBytes,
          prepareMs,
          writeMs,
          readMs,
          rows: loaded.length,
        });
      }
    }
    db.close();
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });
    return { bytesPerFile, fileCount, rows };
  });
  const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  const summaries = ["data-url", "blob"].map((format) => {
    const rows = results.rows.filter((row) => row.format === format);
    return {
      format,
      logicalBodyBytes: rows[0].logicalBodyBytes,
      medianPrepareMs: median(rows.map((row) => row.prepareMs)),
      medianWriteMs: median(rows.map((row) => row.writeMs)),
      medianReadMs: median(rows.map((row) => row.readMs)),
    };
  });
  const report = {
    date: new Date().toISOString(),
    browser: browser.version(),
    platform: process.platform,
    scope:
      "Unthrottled IndexedDB binary representation microbenchmark, five alternating runs, eight 5 MiB deterministic payloads. Preparation includes fixture byte generation. Logical body bytes exclude metadata and browser disk overhead. No forced GC, retained-heap, OPFS, mobile, or full-app startup claims.",
    ...results,
    summaries,
  };
  await writeFile("docs/d02-binary-storage-results.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(summaries, null, 2));
} finally {
  await browser.close();
}
