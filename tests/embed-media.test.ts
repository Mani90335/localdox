import assert from "node:assert/strict";
import { test } from "node:test";
import type { FolderRecord } from "../src/lib/workspace/persistence.ts";
import { EMBED_MEDIA_FOLDER, ensureEmbedMediaFolder, embedMediaFolderIds } from "../src/lib/workspace/embed-media.ts";

function folder(overrides: Partial<FolderRecord> & { id: string; name: string }): FolderRecord {
  return { createdAt: 0, parentId: null, ...overrides };
}

test("ensureEmbedMediaFolder creates the folder once, and reuses it thereafter", () => {
  const first = ensureEmbedMediaFolder([]);
  assert.equal(first.folder.name, EMBED_MEDIA_FOLDER);
  assert.equal(first.folder.purpose, "embed-media");
  assert.equal(first.folders.length, 1);

  const second = ensureEmbedMediaFolder(first.folders);
  assert.equal(second.folder.id, first.folder.id);
  assert.equal(second.folders.length, 1);
});

test("an existing top-level folder literally named embed-media is adopted, not duplicated", () => {
  const manual = folder({ id: "manual", name: EMBED_MEDIA_FOLDER });
  const { folder: adopted, folders } = ensureEmbedMediaFolder([manual]);
  assert.equal(adopted.id, "manual");
  assert.equal(adopted.purpose, "embed-media");
  assert.equal(folders.length, 1);
});

test("a folder tagged embed-media is adopted even after being renamed or moved", () => {
  const parent = folder({ id: "parent", name: "Docs" });
  const renamed = folder({ id: "tagged", name: "My attachments", parentId: "parent", purpose: "embed-media" });
  const { folder: adopted, folders } = ensureEmbedMediaFolder([parent, renamed]);
  assert.equal(adopted.id, "tagged");
  assert.equal(adopted.name, "My attachments");
  assert.equal(folders.length, 2);
});

test("embedMediaFolderIds includes the managed folder and every descendant, but nothing else", () => {
  const root = folder({ id: "root", name: EMBED_MEDIA_FOLDER, purpose: "embed-media" });
  const child = folder({ id: "child", name: "Images", parentId: "root" });
  const grandchild = folder({ id: "grandchild", name: "Screenshots", parentId: "child" });
  const unrelated = folder({ id: "other", name: "Notes" });

  const hidden = embedMediaFolderIds([root, child, grandchild, unrelated]);
  assert.deepEqual([...hidden].sort(), ["child", "grandchild", "root"]);
});

test("embedMediaFolderIds tolerates a cycle without hanging", () => {
  const a = folder({ id: "a", name: EMBED_MEDIA_FOLDER, purpose: "embed-media", parentId: "b" });
  const b = folder({ id: "b", name: "B", parentId: "a" });
  const hidden = embedMediaFolderIds([a, b]);
  assert.deepEqual([...hidden].sort(), ["a", "b"]);
});
