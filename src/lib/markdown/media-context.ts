import type { MdFile } from "./markdown-utils";
import type { FolderRecord } from "../workspace/persistence";
import { ARTIFACT_URL_PREFIX, isArtifactUrl } from "./media-references.ts";
import { resolveWorkspaceArtifact } from "../workspace/workspace-artifacts.ts";

export interface MediaContext {
  workspaceId?: string | null;
  workspaceRevision?: string;
  workspaceFiles?: MdFile[];
  workspaceFolders?: FolderRecord[];
  workspaceName?: string;
  sourceFile?: MdFile;
  depth?: number;
  ancestors?: string[];
}
export const resolveMedia = (src: string, context: MediaContext) =>
  resolveWorkspaceArtifact(
    isArtifactUrl(src) ? src.slice(ARTIFACT_URL_PREFIX.length) : src.split(/[?#]/)[0],
    context.workspaceId,
    context.workspaceRevision,
    context.workspaceFiles,
    context.workspaceName,
    context.workspaceFolders,
    context.sourceFile,
  );
