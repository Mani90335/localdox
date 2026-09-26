import type { MdFile } from "../markdown/markdown-utils";
import { getDocumentKind } from "../markdown/document-utils";
import { parseHeadings, splitIntoSubtopics } from "../markdown/markdown-utils";
import { persistence, type WorkspaceRecord } from "./persistence";

export interface ResolvedArtifact {
  file: MdFile;
  workspaceId: string;
  workspaceName: string;
}

export interface ArtifactViewerDefinition {
  extensions: string[];
  label: string;
}

// React Markdown intentionally removes unknown URL schemes. A reserved HTTPS
// origin survives that safety filter while never causing a network request: it
// is intercepted by the custom image renderer before an <img> is created.
export const ARTIFACT_URL_PREFIX = "https://workspace-artifact.local/";

export function isArtifactUrl(value?: string): value is string {
  return typeof value === "string" && value.startsWith(ARTIFACT_URL_PREFIX);
}

export function artifactReference(value: string) {
  return decodeURIComponent(value.slice(ARTIFACT_URL_PREFIX.length));
}

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
  ["excalidraw"],
  ["png", "jpg", "jpeg", "webp", "gif", "svg"],
  ["mp4", "webm", "mov", "mp3", "wav", "ogg", "m4a"],
  ["html", "htm"],
].forEach((extensions) =>
  ViewerRegistry.register({ extensions, label: extensions[0].toUpperCase() }),
);

function hydrateFile(file: WorkspaceRecord["files"][number]): MdFile {
  const kind = file.kind ?? getDocumentKind(file.name, file.mimeType);
  const textOutline = kind === "markdown" || kind === "text";
  return {
    ...file,
    kind,
    headings: textOutline ? parseHeadings(file.content, file.id) : [],
    subtopics: textOutline ? splitIntoSubtopics(file.content, file.name) : [],
  };
}

const resolutionCache = new Map<string, Promise<ResolvedArtifact | null>>();

/** Resolve `File.ext` in the current workspace or `Workspace/File.ext` globally. */
export function resolveWorkspaceArtifact(
  reference: string,
  currentWorkspaceId?: string | null,
  revision?: string,
  currentFiles?: MdFile[],
  currentWorkspaceName = "Current workspace",
) {
  const clean = decodeURIComponent(reference).replace(/^\.\//, "").trim();
  if (!clean.includes("/") && currentFiles && currentWorkspaceId) {
    const file = currentFiles.find(
      (item) => item.name.toLocaleLowerCase() === clean.toLocaleLowerCase(),
    );
    if (file)
      return Promise.resolve({
        file,
        workspaceId: currentWorkspaceId,
        workspaceName: currentWorkspaceName,
      });
  }
  const cacheKey = `${currentWorkspaceId ?? ""}:${revision ?? ""}:${clean}`.toLocaleLowerCase();
  if (resolutionCache.has(cacheKey)) return resolutionCache.get(cacheKey)!;
  const result = persistence
    .listWorkspaceSummaries()
    .then(async (workspaces) => {
      const [workspacePart, ...fileParts] = clean.split("/");
      const hasWorkspace = fileParts.length > 0;
      const fileName = hasWorkspace ? fileParts.join("/") : clean;
      const candidates = hasWorkspace
        ? workspaces.filter(
            (workspace) => workspace.name.toLocaleLowerCase() === workspacePart.toLocaleLowerCase(),
          )
        : [
            ...workspaces.filter((workspace) => workspace.id === currentWorkspaceId),
            ...workspaces.filter((workspace) => workspace.id !== currentWorkspaceId),
          ];
      for (const summary of candidates) {
        const workspace = await persistence.getWorkspace(summary.id);
        if (!workspace) continue;
        const file = workspace.files.find(
          (item) => item.name.toLocaleLowerCase() === fileName.toLocaleLowerCase(),
        );
        if (file)
          return {
            file: hydrateFile(file),
            workspaceId: workspace.id,
            workspaceName: workspace.name,
          };
      }
      return null;
    })
    .catch((error) => {
      resolutionCache.delete(cacheKey);
      throw error;
    });
  if (resolutionCache.size >= 100) resolutionCache.delete(resolutionCache.keys().next().value!);
  resolutionCache.set(cacheKey, result);
  return result;
}

export function clearArtifactResolutionCache() {
  resolutionCache.clear();
}

/** Turn the two ergonomic Markdown forms into a standard custom image URL. */
export function prepareWorkspaceEmbeds(markdown: string) {
  if (!markdown.includes("![[") && !markdown.includes("@[file]")) return markdown;
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line
        .replace(
          /!\[\[([^\]]+)\]\]/g,
          (_, reference) =>
            `![${reference}](${ARTIFACT_URL_PREFIX}${encodeURIComponent(reference.trim())})`,
        )
        .replace(
          /@\[file\]\(([^)]+)\)/g,
          (_, reference) =>
            `![${reference}](${ARTIFACT_URL_PREFIX}${encodeURIComponent(reference.trim())})`,
        );
    })
    .join("\n");
}
