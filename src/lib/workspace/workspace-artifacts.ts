import type { MdFile } from "../markdown/markdown-utils.ts";
import { getDocumentKind } from "../markdown/document-utils.ts";
import { parseHeadings, splitIntoSubtopics } from "../markdown/markdown-utils.ts";
import { persistence, type FileEntry, type PersistedFile } from "./persistence.ts";

export interface ResolvedArtifact {
  file: MdFile;
  workspaceId: string;
  workspaceName: string;
}

export interface ArtifactViewerDefinition {
  extensions: string[];
  label: string;
}

import {
  artifactReference,
  isArtifactUrl,
  ARTIFACT_URL_PREFIX,
  decodeReference,
  findReferencedFile,
} from "../markdown/media-references.ts";
export {
  artifactReference,
  isArtifactUrl,
  ARTIFACT_URL_PREFIX,
} from "../markdown/media-references.ts";
import type { FolderRecord } from "./persistence.ts";

/** A small public registry makes adding another file viewer a one-line change. */
export const ViewerRegistry = {
  definitions: [] as ArtifactViewerDefinition[],
  register(definition: ArtifactViewerDefinition) {
    this.definitions.push(definition);
  },
  supports(name: string) {
    const ext = name.split(".").pop()?.toLowerCase();
    return this.definitions.some((definition) => definition.extensions.includes(ext ?? ""));
  },
};

[
  ["pdf"],
  ["ppt", "pptx"],
  ["xlsx", "xls", "csv"],
  ["docx"],
  ["json"],
  ["md", "markdown", "mdx", "txt"],
  ["mmd", "mermaid"],
  ["board", "excalidraw"],
  ["png", "jpg", "jpeg", "webp", "gif", "svg"],
  ["mp4", "webm", "mov", "mp3", "wav", "ogg", "m4a"],
  ["html", "htm"],
].forEach((extensions) =>
  ViewerRegistry.register({ extensions, label: extensions[0].toUpperCase() }),
);

function hydrateFile(file: PersistedFile): MdFile {
  const kind = file.kind ?? getDocumentKind(file.name, file.mimeType);
  const textOutline = kind === "markdown" || kind === "text";
  return {
    ...file,
    kind,
    headings: textOutline ? parseHeadings(file.content, file.id) : [],
    subtopics: textOutline ? splitIntoSubtopics(file.content, file.name) : [],
  };
}

/**
 * Current in-memory files take precedence over persisted autosave snapshots.
 * Stored workspaces are searched by name and path without their binary
 * bodies; only the one file a reference resolves to is read in full.
 */
export async function resolveWorkspaceArtifact(
  reference: string,
  currentWorkspaceId?: string | null,
  _revision?: string,
  currentFiles?: MdFile[],
  currentWorkspaceName = "Current workspace",
  currentFolders?: FolderRecord[],
  sourceFile?: MdFile,
): Promise<ResolvedArtifact | null> {
  const clean = decodeReference(reference).trim();
  // An entry from `currentFiles` is already complete; any other is read in
  // full now.
  const complete = async (
    workspaceId: string,
    workspaceName: string,
    entry: FileEntry,
  ): Promise<ResolvedArtifact | null> => {
    if (workspaceId === currentWorkspaceId && currentFiles)
      return { file: entry as MdFile, workspaceId, workspaceName };
    const file = await persistence.getFile(workspaceId, entry.id);
    return file ? { file: hydrateFile(file), workspaceId, workspaceName } : null;
  };
  const stable = /^@([^/]+)\/(.+)$/.exec(clean);
  if (stable) {
    if (stable[1] === currentWorkspaceId && currentFiles) {
      const file = currentFiles.find((item) => item.id === stable[2] && !item.deletedAt);
      return file ? { file, workspaceId: stable[1], workspaceName: currentWorkspaceName } : null;
    }
    const workspace = await persistence.getWorkspaceEntries(stable[1]);
    const entry = workspace?.files.find((item) => item.id === stable[2] && !item.deletedAt);
    return entry && workspace ? complete(workspace.id, workspace.name, entry) : null;
  }
  // Most media is in memory already. Avoid cloning every uploaded file from
  // IndexedDB once for every image/player in the document.
  const current =
    currentWorkspaceId && (!currentFiles || !currentFolders)
      ? await persistence.getWorkspaceEntries(currentWorkspaceId)
      : null;
  const folders = currentFolders ?? current?.folders ?? [];
  const files: FileEntry[] = currentFiles ?? current?.files ?? [];
  const local = findReferencedFile(clean, files, folders, sourceFile);
  if (local && currentWorkspaceId) return complete(currentWorkspaceId, currentWorkspaceName, local);
  // A repeated local name needs a path; don't silently pick a file elsewhere.
  if (
    !clean.includes("/") &&
    files.filter((file) => !file.deletedAt && file.name.toLowerCase() === clean.toLowerCase())
      .length > 1
  )
    return null;
  const summaries = await persistence.listWorkspaceSummaries();
  // Explicit workspace names can themselves contain slashes. Longest prefix wins.
  const qualified = summaries
    .filter((ws) => clean.toLowerCase().startsWith(ws.name.toLowerCase() + "/"))
    .sort((a, b) => b.name.length - a.name.length);
  const matches: { entry: FileEntry; workspaceId: string; workspaceName: string }[] = [];
  for (const summary of qualified.length
    ? qualified
    : summaries.filter((ws) => ws.id !== currentWorkspaceId)) {
    const isCurrent = summary.id === currentWorkspaceId;
    const workspace = isCurrent ? null : await persistence.getWorkspaceEntries(summary.id);
    if (!isCurrent && !workspace) continue;
    const entry = findReferencedFile(
      qualified.length ? clean.slice(summary.name.length + 1) : clean,
      workspace?.files ?? files,
      workspace ? (workspace.folders ?? []) : folders,
    );
    if (entry) matches.push({ entry, workspaceId: summary.id, workspaceName: summary.name });
  }
  // Ambiguous names must be qualified; never silently attach another file.
  if (matches.length !== 1) return null;
  const [match] = matches;
  return complete(match.workspaceId, match.workspaceName, match.entry);
}

export function clearArtifactResolutionCache() {
  /* Resolution always uses fresh records. */
}

/** Turn the two ergonomic Markdown forms into a standard custom image URL. */
export function prepareWorkspaceEmbeds(markdown: string) {
  if (!markdown.includes("![[") && !markdown.includes("@[file]")) return markdown;
  let fence: string | null = null;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
        return line;
      }
      if (fence || /^( {4}|\t)/.test(line)) return line;
      return line
        .split(/(`+[^`]*(?:`[^`]+)*?`+)/g)
        .map((part) =>
          part.startsWith("`")
            ? part
            : part
                .replace(
                  /!\[\[([^\]]+)\]\]/g,
                  (_, reference) =>
                    `![${reference}](${ARTIFACT_URL_PREFIX}${encodeURIComponent(reference.trim())})`,
                )
                .replace(
                  /@\[file\]\(([^)]+)\)/g,
                  (_, reference) =>
                    `![${reference}](${ARTIFACT_URL_PREFIX}${encodeURIComponent(reference.trim())})`,
                ),
        )
        .join("");
    })
    .join("\n");
}
