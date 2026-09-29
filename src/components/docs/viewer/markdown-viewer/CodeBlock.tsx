import { useEffect, useRef, useState } from "react";
import { Check, Copy, Expand, Minimize2 } from "lucide-react";
import { MermaidBlock } from "@/services/diagrams";
import { MindMapBlock } from "@/services/mindmap";
import { JsonTree } from "../JsonTree";
import { InteractiveBlock } from "../InteractiveBlock";
import { extractText } from "./extract-text";

/**
 * A ```json fence, rendered as a browsable tree with a full-screen control.
 *
 * Structured data in a document has the same problem a diagram does: it gets
 * the width of a text column, which is the one place a deep tree is least
 * readable. Full screen is the element's own rather than an overlay, so the
 * branches the reader has opened survive going in and coming back out, and
 * Escape or the browser's own exit are followed like any other fullscreen.
 */
function JsonFigure({ value }: { value: unknown }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === hostRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggle = () => {
    const el = hostRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => setFull(false));
  };

  return (
    <div
      ref={hostRef}
      className={`overflow-hidden border-border bg-background ${
        full ? "flex h-screen w-screen flex-col rounded-none border-0" : "my-6 rounded-xl border"
      }`}
    >
      <div className="flex items-center justify-end border-b border-border/70 bg-background/40 px-2 py-1.5">
        <button
          onClick={toggle}
          title={full ? "Exit full screen" : "Full screen"}
          aria-label={full ? "Exit full screen" : "Full screen"}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
        </button>
      </div>
      {/* In full screen the tree's own panel fills the screen rather than
          sitting as a short card at the top of an empty one. */}
      <div
        className={full ? "min-h-0 flex-1 overflow-auto *:min-h-full" : "max-h-128 overflow-auto"}
      >
        <JsonTree value={value} />
      </div>
    </div>
  );
}

export function CodeBlock({ children, ...rest }: any) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  // Detect Mermaid
  const codeEl: any = Array.isArray(children) ? children[0] : children;
  const cls = codeEl?.props?.className ?? "";
  if (typeof cls === "string" && /language-mermaid/.test(cls)) {
    const raw = extractText(codeEl?.props?.children);
    return <MermaidBlock code={raw} />;
  }

  const encodedLang = /language-([\w+-]+)/.exec(cls)?.[1];
  const [lang, encodedMeta] = encodedLang?.split("--") ?? [];
  const meta =
    codeEl?.props?.node?.data?.meta ??
    codeEl?.props?.node?.meta ??
    encodedMeta?.replaceAll("-", " ") ??
    "";

  // ```mindmap fences hold JSON and draw as an interactive map, the same way
  // ```mermaid fences hold diagram source. Any fence meta becomes the root's
  // name when the JSON does not carry one.
  if (lang === "mindmap") {
    return <MindMapBlock code={extractText(codeEl?.props?.children)} title={meta} />;
  }

  if (lang === "interactive-html" || lang === "interactive-react") {
    return (
      <InteractiveBlock
        kind={lang === "interactive-html" ? "html" : "react"}
        code={extractText(codeEl?.props?.children)}
        meta={meta}
      />
    );
  }

  // A ```json fence renders as a browsable tree rather than a wall of text.
  // Malformed JSON falls through to the plain code block below, so a typo
  // still shows the author what they wrote instead of an error.
  if (lang === "json") {
    const raw = extractText(codeEl?.props?.children);
    try {
      const parsed = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object") {
        return <JsonFigure value={parsed} />;
      }
    } catch {
      // Not valid JSON — fall through.
    }
  }

  return (
    <div className="group relative my-6">
      {/* {lang && (
        <div className="absolute left-3 top-2 z-10 rounded bg-background/60 px-1.5 py-0.5 text-xs font-mono uppercase tracking-wider text-muted-foreground backdrop-blur">
          {lang}
        </div>
      )} */}
      <button
        onClick={() => {
          const code = ref.current?.innerText ?? "";
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        aria-label={copied ? "Copied" : "Copy code"}
        /* A hover-only reveal leaves this button unreachable on touch, so
           `hover-none:opacity-100` pins it there. Being permanently visible is
           also why it loses its label on a touch device: the word doubled the
           button's width, and parked over the first line of a code block on a
           phone that was the difference between covering the end of a line and
           covering half of it. The tick that replaces the icon still reports
           the copy, and `aria-label` carries the name either way. */
        className="absolute right-2 top-2 z-10 inline-flex min-h-9 items-center gap-1 rounded-md border border-border/50 bg-background/80 px-2.5 py-1.5 text-xs text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:text-foreground group-hover:opacity-100 coarse:min-h-11 coarse:min-w-11 coarse:justify-center coarse:px-0 [@media(hover:none)]:opacity-100"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        <span className="coarse:hidden">{copied ? "Copied" : "Copy"}</span>
      </button>
      <pre ref={ref} {...rest}>
        {children}
      </pre>
    </div>
  );
}
