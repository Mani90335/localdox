import { lazy, Suspense, useEffect, useMemo, useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { dataUrlToBlob, getDocumentKind } from "@/lib/markdown/document-utils";
const DocumentViewer = lazy(() =>
  import("./DocumentViewer").then((module) => ({ default: module.DocumentViewer })),
);
import { MermaidBlock } from "@/services/diagrams";
import { BoardEmbed } from "@/services/board";
import {
  prepareWorkspaceEmbeds,
  resolveWorkspaceArtifact,
  artifactReference,
  isArtifactUrl,
  type ResolvedArtifact,
} from "@/lib/workspace/workspace-artifacts";

interface Props {
  reference: string;
  currentWorkspaceId?: string | null;
  workspaceRevision?: string;
  currentWorkspaceFiles?: MdFile[];
  currentWorkspaceName?: string;
  depth?: number;
  ancestors?: string[];
  onOpenArtifact?: (fileId: string, workspaceId: string) => void;
}

export function InlineArtifact({
  reference,
  currentWorkspaceId,
  workspaceRevision,
  currentWorkspaceFiles,
  currentWorkspaceName,
  depth = 0,
  ancestors = [],
  onOpenArtifact,
}: Props) {
  const [artifact, setArtifact] = useState<ResolvedArtifact | null>();

  useEffect(() => {
    let alive = true;
    setArtifact(undefined);
    void resolveWorkspaceArtifact(
      reference,
      currentWorkspaceId,
      workspaceRevision,
      currentWorkspaceFiles,
      currentWorkspaceName,
    )
      .then((result) => alive && setArtifact(result))
      .catch(() => {
        if (alive) setArtifact(null);
      });
    return () => {
      alive = false;
    };
  }, [
    reference,
    currentWorkspaceId,
    workspaceRevision,
    currentWorkspaceFiles,
    currentWorkspaceName,
  ]);

  const objectUrl = useObjectUrl(artifact?.file);
  if (artifact === undefined) return <div className="artifact-loading">Loading {reference}…</div>;
  if (!artifact)
    return (
      <div className="artifact-error">
        Couldn’t find <strong>{reference}</strong> in this workspace.
      </div>
    );

  const { file } = artifact;
  const kind = file.kind ?? getDocumentKind(file.name, file.mimeType);
  const isPresentation = kind === "presentation";
  const isMermaid = kind === "mermaid";
  // A board brings its own framed, fixed-height viewport (it is a canvas, not a
  // document that flows), so it opts out of the generic one the same way a
  // diagram does.
  const isBoard = kind === "board";

  // Reading-only embed: no header, footer, or controls — just the content.
  return (
    <section className="not-prose my-6">
      <div
        className={
          isPresentation
            ? "presentation-embed-viewport overflow-hidden rounded-xl border border-border"
            : isMermaid || isBoard
              ? "overflow-visible"
              : "artifact-viewport overflow-hidden rounded-xl border border-border"
        }
      >
        {renderArtifact(file, objectUrl, {
          currentWorkspaceId,
          workspaceRevision,
          depth,
          ancestors,
          onOpenArtifact,
        })}
      </div>
    </section>
  );
}

function renderArtifact(file: MdFile, objectUrl: string | null, context: Omit<Props, "reference">) {
  const kind = file.kind ?? getDocumentKind(file.name, file.mimeType);
  if (kind === "image")
    return <img src={objectUrl ?? file.data} alt={file.name} className="artifact-image" />;
  if (kind === "video")
    return <video src={objectUrl ?? file.data} controls className="artifact-media" />;
  if (kind === "audio")
    return <audio src={objectUrl ?? file.data} controls className="w-full px-4 py-6" />;
  if (kind === "html")
    return <iframe title={file.name} srcDoc={file.content} sandbox="" className="artifact-html" />;
  if (kind === "mermaid") return <MermaidBlock code={file.content} name={file.name} />;
  if (kind === "board") return <BoardEmbed content={file.content} name={file.name} />;
  if (kind === "markdown" || kind === "text") {
    if ((context.depth ?? 0) >= 4 || (context.ancestors ?? []).includes(file.id))
      return (
        <div className="artifact-error">
          Nested Markdown stopped here to prevent a circular embed.
        </div>
      );
    return <EmbeddedMarkdown file={file} {...context} />;
  }
  return (
    <Suspense fallback={<div className="artifact-loading">Loading {file.name}…</div>}>
      <DocumentViewer file={file} embedded />
    </Suspense>
  );
}

function EmbeddedMarkdown({
  file,
  currentWorkspaceId,
  workspaceRevision,
  currentWorkspaceFiles,
  currentWorkspaceName,
  depth = 0,
  ancestors = [],
  onOpenArtifact,
}: { file: MdFile } & Omit<Props, "reference">) {
  const content = useMemo(() => prepareWorkspaceEmbeds(file.content), [file.content]);
  return (
    <article className="artifact-markdown docs-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: (props: ComponentPropsWithoutRef<"pre">) => {
            const codeElement = Array.isArray(props.children) ? props.children[0] : props.children;
            if (
              typeof codeElement === "object" &&
              codeElement &&
              "props" in codeElement &&
              /language-mermaid/.test(String(codeElement.props.className ?? ""))
            ) {
              const value = codeElement.props.children;
              const source = Array.isArray(value) ? value.join("") : String(value ?? "");
              return <MermaidBlock code={source} />;
            }
            return <pre {...props} />;
          },
          img: (props: ComponentPropsWithoutRef<"img">) =>
            isArtifactUrl(props.src) ? (
              <InlineArtifact
                reference={artifactReference(props.src)}
                currentWorkspaceId={currentWorkspaceId}
                workspaceRevision={workspaceRevision}
                currentWorkspaceFiles={currentWorkspaceFiles}
                currentWorkspaceName={currentWorkspaceName}
                depth={depth + 1}
                ancestors={[...ancestors, file.id]}
                onOpenArtifact={onOpenArtifact}
              />
            ) : (
              <img {...props} loading="lazy" />
            ),
          a: (props: ComponentPropsWithoutRef<"a">) => (
            <a
              {...props}
              target={props.href?.startsWith("http") ? "_blank" : undefined}
              rel="noreferrer"
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}

function useObjectUrl(file?: MdFile) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const blob = file.data
      ? dataUrlToBlob(file.data)
      : new Blob([file.content], { type: file.mimeType || "text/plain" });
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}
