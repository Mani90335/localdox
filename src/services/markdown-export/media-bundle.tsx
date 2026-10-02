import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeSlug from "rehype-slug";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import JSZip from "jszip";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { getDocumentKind, dataUrlToArrayBuffer } from "@/lib/markdown/document-utils";
import { prepareWorkspaceEmbeds } from "@/lib/workspace/workspace-artifacts";
import {
  artifactReference,
  isArtifactUrl,
  isLocalReference,
} from "@/lib/markdown/media-references";
import {
  mediaKind,
  mediaUrlTransform,
  remarkMedia,
  parseMediaSpec,
  type MediaSpec,
} from "@/lib/markdown/markdown-media";
import { detectEmbed } from "@/lib/markdown/media-embeds";
import { resolveMedia, type MediaContext } from "@/lib/markdown/media-context";

const CSS = `
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#fff;color:#20242b;font:17px/1.75 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:900px;margin:auto;padding:48px 28px 80px;overflow-wrap:anywhere}h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.8em 0 .65em;color:#111827}h1{font-size:2.2em;border-bottom:1px solid #e5e7eb;padding-bottom:.4em}h2{font-size:1.6em}a{color:#1d4ed8;text-underline-offset:3px}p,ul,ol,blockquote,pre,figure,.markdown-media-paragraph{margin:1.2em 0}figure{margin-inline:0}img,video{display:block;max-width:100%;height:auto;border-radius:8px}video{width:100%;max-height:80vh;background:#111}audio{width:100%}iframe{display:block;width:100%;min-height:480px;border:1px solid #e5e7eb;border-radius:8px}figcaption{font-size:.85em;margin-top:8px;color:#64748b}pre{padding:20px;background:#f3f4f6;border-radius:8px;overflow:auto;white-space:pre;overflow-wrap:normal}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.88em}:not(pre)>code{background:#f3f4f6;border-radius:4px;padding:2px 5px}blockquote{border-left:4px solid #cbd5e1;padding:4px 20px;color:#475569}table{display:block;max-width:100%;overflow:auto;border-collapse:collapse}th,td{padding:10px 14px;border:1px solid #d1d5db;text-align:left}th{background:#f8fafc}hr{border:0;border-top:1px solid #e5e7eb;margin:2em 0}.hljs-keyword,.hljs-selector-tag{color:#7c3aed}.hljs-string,.hljs-attr{color:#047857}.hljs-number,.hljs-literal{color:#b45309}.hljs-comment{color:#64748b}.embedded-document{padding:0 20px;border-left:3px solid #e5e7eb}math[display=block]{display:block;overflow:auto;margin:1em 0}@media(max-width:600px){main{padding:24px 16px}body{font-size:16px}h1{font-size:1.8em}}@media print{main{max-width:none;padding:0}pre,figure,blockquote{break-inside:avoid}}
`;
const local = (src: string) => isArtifactUrl(src) || isLocalReference(src);
// Control characters and separators cannot become ZIP entry names.
const safeName = (name: string) =>
  // eslint-disable-next-line no-control-regex
  name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/^\.+/, "_") || "attachment";
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Render from the entire source, independent of pagination, folded headings,
 * mounted players and temporary object URLs. Web media is never fetched. */
export async function buildMarkdownHTML(
  file: MdFile,
  context: MediaContext,
): Promise<{ blob: Blob; name: string; html: string }> {
  const zip = new JSZip();
  const assets = new Map<string, string>();
  const resolutions = new Map<string, ReturnType<typeof resolveMedia>>();
  const resolve = (src: string, ctx: MediaContext) => {
    const key = JSON.stringify([ctx.workspaceId, ctx.sourceFile?.id, src]);
    if (!resolutions.has(key)) resolutions.set(key, resolveMedia(src, ctx));
    return resolutions.get(key)!;
  };
  const asset = async (src: string, ctx: MediaContext) => {
    if (!local(src)) {
      const url = mediaUrlTransform(src);
      if (!url) throw new Error("The document contains an unsupported media URL.");
      return { url, artifact: null };
    }
    const artifact = await resolve(src, ctx);
    if (!artifact)
      throw new Error(
        `Could not export: attachment “${isArtifactUrl(src) ? artifactReference(src) : src}” is missing or ambiguous. Choose its file again.`,
      );
    const key = `${artifact.workspaceId}/${artifact.file.id}`;
    let path = assets.get(key);
    if (!path) {
      path = `media/${assets.size + 1}-${safeName(artifact.file.name)}`;
      const bytes = artifact.file.data
        ? await dataUrlToArrayBuffer(artifact.file.data)
        : artifact.file.content;
      if (bytes === null) throw new Error(`Could not read ${artifact.file.name}.`);
      zip.file(path, bytes);
      assets.set(key, path);
    }
    return { url: path.split("/").map(encodeURIComponent).join("/"), artifact };
  };

  async function renderDocument(
    document: MdFile,
    ctx: MediaContext,
    ancestors: string[],
  ): Promise<string> {
    const requests = new Map<
      string,
      { src: string; alt: string; spec: MediaSpec; link: boolean }
    >();
    const rendered = new Map<string, ReactNode>();
    const diagrams = new Map<string, string | null>();
    const media = (
      src: string,
      alt: string,
      spec: MediaSpec,
      link = false,
      children?: ReactNode,
    ) => {
      const key = JSON.stringify([src, alt, spec, link]);
      requests.set(key, { src, alt, spec, link });
      if (!rendered.has(key)) return <span />;
      const result = rendered.get(key);
      return link ? (
        <a href={String(result)} download>
          {children || alt}
        </a>
      ) : (
        result
      );
    };
    const render = () =>
      renderToStaticMarkup(
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath, remarkMedia]}
          rehypePlugins={[
            rehypeSlug,
            [rehypeKatex, { output: "mathml" }],
            [rehypeHighlight, { detect: false, ignoreMissing: true }],
          ]}
          urlTransform={mediaUrlTransform}
          components={{
            pre: ({ children }) => {
              const child = Array.isArray(children) ? children[0] : children;
              if (child && typeof child === "object" && "props" in child) {
                const props = child.props as { className?: string; children?: ReactNode };
                if (/language-(mermaid|mmd)\b/.test(props.className ?? "")) {
                  const source = String(props.children ?? "").trim();
                  if (!diagrams.has(source)) diagrams.set(source, null);
                  const svg = diagrams.get(source);
                  if (svg)
                    return (
                      <figure>
                        <img
                          alt="Diagram"
                          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
                        />
                      </figure>
                    );
                }
              }
              return <pre>{children}</pre>;
            },
            img: (props) =>
              media(
                props.src ?? "",
                props.alt ?? "Attachment",
                parseMediaSpec((props as Record<string, unknown>)["data-media"]),
              ),
            a: ({ href = "", children }) =>
              local(href) ? (
                media(href, "Attachment", {}, true, children)
              ) : (
                <a href={href} rel="noreferrer">
                  {children}
                </a>
              ),
            p: ({ children }) => {
              const child = Array.isArray(children)
                ? children.length === 1
                  ? children[0]
                  : null
                : children;
              if (child && typeof child === "object" && "props" in child) {
                const props = child.props as { href?: string; children?: ReactNode };
                if (
                  props.href &&
                  props.children === props.href &&
                  (mediaKind(props.href) || detectEmbed(props.href))
                )
                  return media(props.href, "Media", {});
              }
              return <p>{children}</p>;
            },
          }}
        >
          {prepareWorkspaceEmbeds(document.content)}
        </ReactMarkdown>,
      );
    render(); // Discover references through the parser, excluding code examples.
    if (diagrams.size) {
      const { renderMermaid } = await import("../diagrams/mermaid-render-cache");
      for (const source of diagrams.keys()) {
        try {
          diagrams.set(source, (await renderMermaid(source, false, false)).svg);
        } catch {
          /* Keep the source readable when a diagram cannot render. */
        }
      }
    }
    for (const [key, request] of requests) {
      const { src, alt, spec, link } = request;
      const { url, artifact } = await asset(src, ctx);
      if (link) {
        rendered.set(key, url);
        continue;
      }
      const attached = artifact?.file;
      const kind =
        spec.kind ??
        (attached ? getDocumentKind(attached.name, attached.mimeType) : mediaKind(src));
      const download = (
        <a href={url} download={attached?.name}>
          Download {attached?.name || alt}
        </a>
      );
      if (kind === "image") rendered.set(key, <img src={url} alt={alt} loading="lazy" />);
      else if (kind === "video" || kind === "audio") {
        const poster = spec.poster ? (await asset(spec.poster, ctx)).url : undefined;
        const sources: ReactNode[] = [];
        for (const [index, source] of (spec.sources ?? []).entries())
          sources.push(
            <source key={index} src={(await asset(source.src, ctx)).url} type={source.type} />,
          );
        rendered.set(
          key,
          <figure>
            {createElement(
              kind,
              {
                controls: true,
                preload: "metadata",
                playsInline: true,
                src: sources.length ? undefined : url,
                poster: kind === "video" ? poster : undefined,
                "aria-label": alt,
              },
              ...sources,
              download,
            )}
            <figcaption>{download}</figcaption>
          </figure>,
        );
      } else if (
        attached &&
        (kind === "markdown" || kind === "text") &&
        artifact &&
        ancestors.length < 5 &&
        !ancestors.includes(`${artifact.workspaceId}/${attached.id}`)
      ) {
        const nested = await renderDocument(
          attached,
          {
            ...ctx,
            workspaceId: artifact.workspaceId,
            workspaceName: artifact.workspaceName,
            workspaceFiles:
              artifact.workspaceId === ctx.workspaceId ? ctx.workspaceFiles : undefined,
            workspaceFolders:
              artifact.workspaceId === ctx.workspaceId ? ctx.workspaceFolders : undefined,
            sourceFile: attached,
          },
          [...ancestors, `${artifact.workspaceId}/${attached.id}`],
        );
        rendered.set(
          key,
          <section className="embedded-document" dangerouslySetInnerHTML={{ __html: nested }} />,
        );
      } else if (attached) {
        rendered.set(
          key,
          <figure>
            {(kind === "pdf" || kind === "html") && (
              <iframe src={url} title={attached.name} sandbox="" />
            )}
            <figcaption>{download}</figcaption>
          </figure>,
        );
      } else {
        const embed = detectEmbed(src);
        rendered.set(
          key,
          embed ? (
            <iframe
              src={embed.src}
              title={embed.title}
              allow={embed.allow}
              allowFullScreen
              style={{ aspectRatio: embed.aspect ?? "16 / 9", minHeight: 0 }}
            />
          ) : (
            <img src={url} alt={alt} loading="lazy" />
          ),
        );
      }
    }
    return render();
  }
  const body = await renderDocument(file, { ...context, sourceFile: file }, [
    `${context.workspaceId}/${file.id}`,
  ]);
  const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(file.name)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;
  const base = safeName(file.name.replace(/\.(md|markdown|mdx|txt)$/i, ""));
  if (assets.size) {
    zip.file("index.html", html);
    return { blob: await zip.generateAsync({ type: "blob" }), name: `${base}.zip`, html };
  }
  return {
    blob: new Blob([html], { type: "text/html;charset=utf-8" }),
    name: `${base}.html`,
    html,
  };
}
