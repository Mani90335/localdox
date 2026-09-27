import assert from "node:assert/strict";
import { test } from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import {
  findReferencedFile,
  filePath,
  artifactUrl,
  artifactReference,
} from "../src/lib/markdown/media-references.ts";
import { getDocumentKind } from "../src/lib/markdown/document-utils.ts";
import {
  resolveWorkspaceArtifact,
  prepareWorkspaceEmbeds,
} from "../src/lib/workspace/workspace-artifacts.ts";
import { persistence, newWorkspaceRecord } from "../src/lib/workspace/persistence.ts";
Object.assign(globalThis, { indexedDB, IDBKeyRange });
const folders = [
  { id: "root", name: "Projects", createdAt: 0 },
  { id: "docs", name: "Docs", parentId: "root", createdAt: 0 },
  { id: "media", name: "Media", parentId: "root", createdAt: 0 },
];
const files = [
  { id: "doc", name: "guide.md", content: "# Guide", folderId: "docs" },
  { id: "pic", name: "photo.png", content: "", folderId: "media" },
  { id: "voice", name: "voice.wav", content: "", folderId: "docs" },
  { id: "bin", name: "gone.png", content: "", deletedAt: 1 },
];
test("media paths support nested folders, sibling references, roots and bare names", () => {
  assert.equal(filePath(files[1], folders), "Projects/Media/photo.png");
  assert.equal(findReferencedFile("../Media/photo.png", files, folders, files[0])?.id, "pic");
  assert.equal(findReferencedFile("./voice.wav", files, folders, files[0])?.id, "voice");
  assert.equal(findReferencedFile("/Projects/Media/photo.png", files, folders)?.id, "pic");
  assert.equal(findReferencedFile("photo.png", files, folders)?.id, "pic");
  assert.equal(findReferencedFile("gone.png", files, folders), null);
  assert.equal(findReferencedFile("../../../photo.png", files, folders, files[0]), null);
  assert.equal(
    findReferencedFile(
      "photo.png",
      [...files, { ...files[1], id: "copy", folderId: "docs" }],
      folders,
    ),
    null,
  );
});
test("reference URLs preserve special characters and media MIME types route correctly", () => {
  const reference = "Team/Media/a [b] #c %.mp4";
  assert.equal(artifactReference(artifactUrl(reference)), reference);
  assert.equal(getDocumentKind("recording", "audio/flac"), "audio");
  assert.equal(getDocumentKind("clip", "video/mp4"), "video");
  assert.equal(getDocumentKind("photo", "image/avif"), "image");
  assert.equal(getDocumentKind("movie.ogv"), "video");
});
test("workspace references use live files, resolve other workspaces and survive renamed files", async () => {
  const current = newWorkspaceRecord("Media tests A");
  current.files = files;
  current.folders = folders;
  await persistence.putWorkspace(current);
  const other = newWorkspaceRecord("Media tests B");
  other.files = [{ id: "other", name: "clip.mp4", content: "", folderId: "media" }];
  other.folders = folders;
  await persistence.putWorkspace(other);
  assert.equal(
    (
      await resolveWorkspaceArtifact(
        "../Media/photo.png",
        current.id,
        "",
        files,
        current.name,
        folders,
        files[0],
      )
    )?.file.id,
    "pic",
  );
  assert.equal(
    (await resolveWorkspaceArtifact("Media tests B/Projects/Media/clip.mp4", current.id))?.file.id,
    "other",
  );
  const live = files.map((file) =>
    file.id === "pic" ? { ...file, name: "renamed.png", folderId: null } : file,
  );
  assert.equal(
    (await resolveWorkspaceArtifact(`@${current.id}/pic`, current.id, "", live))?.file.name,
    "renamed.png",
  );
  assert.equal(await resolveWorkspaceArtifact(`@${current.id}/bin`, current.id, "", files), null);
  assert.equal(await resolveWorkspaceArtifact("missing.mp4", current.id), null);
});
test("legacy embeds are left untouched inside fenced, indented and inline code", () => {
  const literal = "~~~md\n![[clip.mp4]]\n~~~\n\n`![[clip.mp4]]`\n\n    ![[clip.mp4]]";
  assert.equal(prepareWorkspaceEmbeds(literal), literal);
  assert.match(prepareWorkspaceEmbeds("![[clip.mp4]]"), /https:\/\/workspace-artifact.local/);
});

test("in-memory attachments resolve without reading or cloning workspace storage", async () => {
  const get = persistence.getWorkspace;
  const list = persistence.listWorkspaceSummaries;
  persistence.getWorkspace = async () => {
    throw new Error("Unexpected storage read");
  };
  persistence.listWorkspaceSummaries = async () => {
    throw new Error("Unexpected summary read");
  };
  try {
    assert.equal(
      (await resolveWorkspaceArtifact("@live/pic", "live", "", files, "Live", folders))?.file.id,
      "pic",
    );
    assert.equal(
      (
        await resolveWorkspaceArtifact(
          "../Media/photo.png",
          "live",
          "",
          files,
          "Live",
          folders,
          files[0],
        )
      )?.file.id,
      "pic",
    );
  } finally {
    persistence.getWorkspace = get;
    persistence.listWorkspaceSummaries = list;
  }
});
