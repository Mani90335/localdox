import {
  isValidElement,
  useContext,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { ExtraProps } from "react-markdown";
import { mediaKind, parseMediaSpec } from "@/lib/markdown/markdown-media";
import { isLocalReference } from "@/lib/markdown/media-references";
import { detectEmbed, EmbedFrame } from "@/lib/markdown/media-embeds";
import { isArtifactUrl } from "@/lib/workspace/workspace-artifacts";
import { ConvertedRemoteImage } from "@/services/doc-conversion";
import { MarkdownMedia } from "../MarkdownMedia";
import { MarkdownRenderContext, type MarkdownRenderContextValue } from "./contexts";
import { TaskContext, SegmentLineContext } from "./contexts";
import { HeadingLink } from "./HeadingLink";
import { SavableBlock } from "./SavableBlock";
import { CodeBlock } from "./CodeBlock";
import { Callout } from "./Callout";
import { extractText } from "./extract-text";

// The viewer's markdown renderers, assembled into react-markdown's
// `components` map by `markdown-components.ts`. Props are passed through
// unchanged, as they were when these lived inline in MarkdownViewer.

type Props<Tag extends keyof React.JSX.IntrinsicElements> = ComponentProps<Tag> & ExtraProps;

export function MarkdownCheckbox({ node, ...props }: Props<"input">) {
  const tasks = useContext(TaskContext);
  const segmentLine = useContext(SegmentLineContext);
  // The source render is deferred for large documents. Reflect the click now,
  // then reconcile with source edits when the parsed state arrives.
  const [checked, setChecked] = useState(Boolean(props.checked));
  useEffect(() => setChecked(Boolean(props.checked)), [props.checked]);
  const line = Number(node?.properties?.["data-task-line"] ?? node?.properties?.dataTaskLine);
  const enabled = props.type === "checkbox" && tasks && Number.isInteger(line);
  return (
    <input
      {...props}
      checked={checked}
      disabled={!enabled}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        if (enabled) {
          setChecked(event.target.checked);
          tasks.toggle(tasks.lineOffset + segmentLine + line, event.target.checked);
        }
      }}
    />
  );
}

function useRenderContext(): MarkdownRenderContextValue {
  const value = useContext(MarkdownRenderContext);
  if (!value) throw new Error("Markdown renderers need a MarkdownRenderContext");
  return value;
}

export const MarkdownH1 = (props: Props<"h1">) => <HeadingLink as="h1" {...props} />;
export const MarkdownH2 = (props: Props<"h2">) => <HeadingLink as="h2" {...props} />;
export const MarkdownH3 = (props: Props<"h3">) => <HeadingLink as="h3" {...props} />;
export const MarkdownH4 = (props: Props<"h4">) => <HeadingLink as="h4" {...props} />;
export const MarkdownH5 = (props: Props<"h5">) => <HeadingLink as="h5" {...props} />;
export const MarkdownH6 = (props: Props<"h6">) => <HeadingLink as="h6" {...props} />;

/** The href of a paragraph that is a single bare link (`<https://…>`), if it is one. */
function bareLinkHref(children: ReactNode): string | null {
  // Match on props.href rather than element type — the custom `a` override
  // makes the child's type the component, not the string "a".
  const kids = Array.isArray(children) ? children : [children];
  const solo = kids.filter((child) => !(typeof child === "string" && !child.trim()));
  const only = solo.length === 1 ? solo[0] : null;
  if (!isValidElement<{ href?: unknown; children?: ReactNode }>(only)) return null;
  const { href, children: inner } = only.props;
  if (typeof href !== "string" || !href) return null;
  const text = typeof inner === "string" ? inner : Array.isArray(inner) ? inner.join("") : "";
  return text === href || text === "" ? href : null;
}

/** A paragraph that is one embeddable link: a video, an embed, an attachment. */
function EmbeddedLink({ href }: { href: string }) {
  const { media } = useRenderContext();
  const embed = detectEmbed(href);
  if (embed) return <EmbedFrame embed={embed} />;
  return <MarkdownMedia src={href} context={media} />;
}

export function MarkdownParagraph(props: Props<"p">) {
  const href = bareLinkHref(props.children);
  if (href && (detectEmbed(href) || mediaKind(href))) return <EmbeddedLink href={href} />;
  return <p {...props}>{props.children}</p>;
}

export function MarkdownBlockquote(props: Props<"blockquote">) {
  return (
    <SavableBlock blockType="quote">
      <Callout {...props} />
    </SavableBlock>
  );
}

export function MarkdownPre(props: Props<"pre">) {
  const codeEl = Array.isArray(props.children) ? props.children[0] : props.children;
  const code = isValidElement<{ className?: unknown; children?: ReactNode }>(codeEl)
    ? codeEl.props
    : null;
  const isMermaid = typeof code?.className === "string" && /language-mermaid/.test(code.className);
  return (
    <SavableBlock
      blockType="code"
      className={isMermaid ? "docs-savable-mermaid" : "docs-savable-code"}
      // A diagram puts the save action in its own control tray, so the
      // star is not drawn floating beside it. Its rendered text is the
      // stylesheet Mermaid injects rather than anything the reader sees,
      // so the source is what identifies it.
      renderOwnSaveAction={isMermaid}
      identity={isMermaid ? extractText(code?.children).trim() : undefined}
    >
      <CodeBlock {...props} />
    </SavableBlock>
  );
}

export function MarkdownImage(props: Props<"img"> & { "data-media"?: string }) {
  const { file, media, openLightbox } = useRenderContext();
  const src = typeof props.src === "string" ? props.src : "";
  if (file.derivedFrom) return <ConvertedRemoteImage src={src} alt={props.alt} />;
  if (isArtifactUrl(src) || isLocalReference(src) || mediaKind(src) !== "image") {
    return (
      <MarkdownMedia
        src={src}
        alt={props.alt}
        spec={parseMediaSpec(props["data-media"])}
        context={media}
      />
    );
  }
  return (
    <SavableBlock blockType="image" as="span" identity={src} className="inline-block">
      <img
        {...props}
        loading="lazy"
        onClick={() => openLightbox({ src, alt: props.alt })}
        className="cursor-zoom-in"
      />
    </SavableBlock>
  );
}

export function MarkdownLink(props: Props<"a">) {
  const { file, media, anchorTargets, onNav, contentRef } = useRenderContext();
  const href = typeof props.href === "string" ? props.href : "";
  if (isArtifactUrl(href) || isLocalReference(href))
    return (
      <MarkdownMedia src={href} linkOnly context={media}>
        {props.children}
      </MarkdownMedia>
    );
  // An in-page reference (`[see](#recommended-controls)`) used to be left
  // to the browser, which looks for the element and finds nothing: in
  // paginated mode the target heading usually lives in a *different*
  // chunk that isn't mounted, so the click did nothing at all. Resolve it
  // through the app's own navigation instead — switch to the chunk that
  // owns the heading, then scroll to it.
  if (href.startsWith("#")) {
    let rawTarget = href.slice(1);
    try {
      rawTarget = decodeURIComponent(rawTarget);
    } catch {
      /* malformed fragment stays literal */
    }
    const targetId = anchorTargets[rawTarget] ?? rawTarget;
    return (
      <a
        {...props}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          // Footnotes are appended to each converted page. Follow their
          // local targets without changing the currently selected page.
          if (file.derivedFrom && rawTarget.startsWith("user-content-fn")) {
            const note = contentRef.current?.querySelector(`#${CSS.escape(rawTarget)}`);
            if (note) {
              note.scrollIntoView({ behavior: "smooth", block: "start" });
              return;
            }
          }
          // Selecting the chunk mounts it; the viewer scrolls to the heading
          // once it exists (a long document may still be mounting).
          onNav(file.id, targetId);
          requestAnimationFrame(() => {
            document
              .getElementById(targetId)
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }}
      >
        {props.children}
      </a>
    );
  }
  return (
    <a {...props} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
      {props.children}
    </a>
  );
}

export function MarkdownTable(props: Props<"table">) {
  return (
    <SavableBlock blockType="table" className="docs-savable-table">
      <div className="docs-table-wrap">
        <table {...props} />
      </div>
    </SavableBlock>
  );
}

export const MarkdownDiv = (props: Props<"div">) => <div {...props}>{props.children}</div>;
export const MarkdownLi = (props: Props<"li">) => <li {...props}>{props.children}</li>;
export const MarkdownTd = (props: Props<"td">) => <td {...props}>{props.children}</td>;
export const MarkdownTh = (props: Props<"th">) => <th {...props}>{props.children}</th>;
