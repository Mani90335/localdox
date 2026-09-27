import { useEffect, useState, type ReactNode } from "react";
import { resolveMedia, type MediaContext } from "@/lib/markdown/media-context";
import { dataUrlToBlob, getDocumentKind } from "@/lib/markdown/document-utils";
import {
  artifactReference,
  isArtifactUrl,
  isLocalReference,
} from "@/lib/markdown/media-references";
import { mediaKind, mediaUrlTransform, type MediaSpec } from "@/lib/markdown/markdown-media";
import { type ResolvedArtifact } from "@/lib/workspace/workspace-artifacts";
import { InlineArtifact } from "./InlineArtifact";
import { detectEmbed, EmbedFrame } from "@/lib/markdown/media-embeds";

export function MarkdownMedia({
  src,
  alt = "Attachment",
  spec = {},
  context,
  linkOnly,
  children,
}: {
  src: string;
  alt?: string;
  spec?: MediaSpec;
  context: MediaContext;
  linkOnly?: boolean;
  children?: ReactNode;
}) {
  const key = JSON.stringify([src, spec, context.workspaceId, context.sourceFile?.id]);
  const [failed, setFailed] = useState<string | null>(null);
  const [state, setState] = useState<{
    key: string;
    urls: Record<string, string>;
    artifact?: ResolvedArtifact;
    error?: string;
  }>();
  const {
    workspaceId,
    workspaceRevision,
    workspaceFiles,
    workspaceFolders,
    workspaceName,
    sourceFile,
  } = context;
  useEffect(() => {
    let alive = true;
    setFailed(null);
    const objectUrls: string[] = [];
    const sources = [
      ...new Set(
        [src, spec.poster, ...(spec.sources?.map((item) => item.src) ?? [])].filter(
          (item): item is string => !!item,
        ),
      ),
    ];
    void (async () => {
      const urls: Record<string, string> = {};
      let primary: ResolvedArtifact | undefined;
      for (const value of sources) {
        if (isArtifactUrl(value) || isLocalReference(value)) {
          const artifact = await resolveMedia(value, {
            workspaceId,
            workspaceRevision,
            workspaceFiles,
            workspaceFolders,
            workspaceName,
            sourceFile,
          });
          if (!alive) return;
          if (!artifact)
            throw new Error(
              `Couldn’t find ${isArtifactUrl(value) ? artifactReference(value) : value}. Choose the file again or check its workspace and folder path.`,
            );
          if (value === src) primary = artifact;
          const file = artifact.file;
          const blob = file.data
            ? dataUrlToBlob(file.data, file.mimeType)
            : new Blob([file.content], { type: file.mimeType || "text/plain" });
          if (!blob) throw new Error(`Couldn’t read ${file.name}.`);
          urls[value] = URL.createObjectURL(blob);
          objectUrls.push(urls[value]);
        } else {
          urls[value] = mediaUrlTransform(value);
          if (!urls[value]) throw new Error("This media URL is not supported.");
        }
      }
      if (alive) setState({ key, urls, artifact: primary });
    })().catch((error) => {
      if (alive) setState({ key, urls: {}, error: error.message });
    });
    return () => {
      alive = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
    // The serialized spec is stable across Markdown renderer calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    key,
    workspaceId,
    workspaceRevision,
    workspaceFiles,
    workspaceFolders,
    workspaceName,
    sourceFile,
  ]);
  if (!state || state.key !== key) return <span role="status">Loading {alt}…</span>;
  if (state.error)
    return (
      <span className="artifact-error" role="status">
        {state.error}
      </span>
    );
  const file = state.artifact?.file;
  const url = state.urls[src];
  const label = file?.name || alt;
  if (linkOnly)
    return (
      <a href={url} download={file?.name} target={file ? undefined : "_blank"} rel="noreferrer">
        {children || label}
      </a>
    );
  const kind = spec.kind ?? (file ? getDocumentKind(file.name, file.mimeType) : mediaKind(src));
  const fallback = (
    <a href={url} download={file?.name} target={file ? undefined : "_blank"} rel="noreferrer">
      Download {label}
    </a>
  );
  if (kind === "image")
    return (
      <span>
        <img
          src={url}
          alt={alt}
          loading="lazy"
          className="artifact-image"
          onError={() => setFailed("The image could not be displayed.")}
        />
        {failed && (
          <span role="status">
            {failed} {fallback}
          </span>
        )}
      </span>
    );
  if (kind === "video" || kind === "audio") {
    const Player = kind;
    return (
      <span className="markdown-media-player">
        <Player
          controls
          playsInline
          preload="metadata"
          src={spec.sources?.length ? undefined : url}
          poster={kind === "video" && spec.poster ? state.urls[spec.poster] : undefined}
          aria-label={alt}
          onError={() =>
            setFailed(
              "This media could not be played. You can download it to open in another player.",
            )
          }
        >
          {spec.sources?.map((source, index) => (
            <source key={index} src={state.urls[source.src]} type={source.type} />
          ))}
          {fallback}
        </Player>
        <span className="markdown-media-download">
          {failed && <span role="status">{failed} </span>}
          {fallback}
        </span>
      </span>
    );
  }
  if (file)
    return (
      <InlineArtifact
        reference={isArtifactUrl(src) ? artifactReference(src) : src}
        currentWorkspaceId={workspaceId}
        workspaceRevision={workspaceRevision}
        currentWorkspaceFiles={workspaceFiles}
        currentWorkspaceFolders={workspaceFolders}
        currentWorkspaceName={workspaceName}
        sourceFile={sourceFile}
        depth={context.depth}
        ancestors={context.ancestors}
      />
    );
  const embed = detectEmbed(src);
  if (embed) return <EmbedFrame embed={embed} />;
  // Image URLs often have no extension (CDNs, signed URLs).
  return <img src={url} alt={alt} loading="lazy" className="artifact-image" />;
}
