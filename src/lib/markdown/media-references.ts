import type { FolderRecord, PersistedFile } from "../workspace/persistence";

export const ARTIFACT_URL_PREFIX = "https://workspace-artifact.local/";
export const isArtifactUrl = (value?: string): boolean =>
  typeof value === "string" && value.startsWith(ARTIFACT_URL_PREFIX);
export function decodeReference(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
export const artifactReference = (value: string) =>
  decodeReference(value.slice(ARTIFACT_URL_PREFIX.length));
export const artifactUrl = (reference: string) =>
  ARTIFACT_URL_PREFIX + encodeURIComponent(reference);
export const fileReference = (workspaceId: string, fileId: string) => `@${workspaceId}/${fileId}`;
export const isLocalReference = (value: string) =>
  !!value &&
  !value.startsWith("#") &&
  !value.startsWith("//") &&
  !/^[a-z][a-z\d+.-]*:/i.test(value);

export function folderPath(folderId: string | null | undefined, folders: FolderRecord[]) {
  const names: string[] = [];
  const seen = new Set<string>();
  while (folderId && !seen.has(folderId)) {
    seen.add(folderId);
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) break;
    names.unshift(folder.name);
    folderId = folder.parentId;
  }
  return names.join("/");
}
export function filePath(file: Pick<PersistedFile, "name" | "folderId">, folders: FolderRecord[]) {
  return [folderPath(file.folderId, folders), file.name].filter(Boolean).join("/");
}
export function normalizePath(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

export function findReferencedFile<T extends PersistedFile>(
  reference: string,
  files: T[],
  folders: FolderRecord[],
  source?: Pick<PersistedFile, "folderId">,
) {
  const live = files.filter((file) => !file.deletedAt);
  const clean = reference;
  const directory = folderPath(source?.folderId, folders);
  const relative = normalizePath(`${directory}/${clean}`);
  const root = normalizePath(clean);
  const match = (path: string | null) =>
    path === null
      ? []
      : live.filter((file) => filePath(file, folders).toLowerCase() === path.toLowerCase());
  if (!clean.startsWith("/")) {
    const nearby = match(relative);
    if (nearby.length) return nearby.length === 1 ? nearby[0] : null;
  }
  const exact = match(root);
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  if (!clean.includes("/")) {
    const named = live.filter((file) => file.name.toLowerCase() === clean.toLowerCase());
    if (named.length === 1) return named[0];
  }
  return null;
}
