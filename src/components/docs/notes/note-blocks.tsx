import {
  isValidElement,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { peekRenderedMath } from "@/services/math/renderer";
import { idleTypesetter } from "@/services/math/idle-typeset";
import type { RenderedMath } from "@/services/math/types";
import { NoteRenderContext } from "./note-render-context";
import { loadKatexStyles } from "@/lib/fonts/fonts";
import { cancelIdleCallbackSafe, requestIdleCallbackSafe } from "@/lib/platform/keyboard";

// How a note's equations and diagrams are drawn in the Notes panel.
//
// The panel sits beside a document that may be typesetting hundreds of
// equations and laying out diagrams of its own, so nothing here competes with
// it. Every block follows the same order:
//
//  1. The reader's own cache. A passage copied a moment ago was drawn a moment
//     ago, with the same source and settings, so its equations and diagrams
//     cost a lookup.
//  2. Otherwise, wait until the note is on screen and the browser is idle,
//     then draw it — and put the result back in the shared cache.
//  3. Until then, or if it can't be drawn cheaply, show the source. Nothing a
//     note holds is ever hidden behind a renderer.

// ---- what is on screen ----------------------------------------------------------

/**
 * How far outside the screen a block starts drawing, so a short scroll lands
 * on finished equations.
 */
const AHEAD_PX = 200;

// One observer for every equation and diagram in the panel, rather than one each.
let observer: IntersectionObserver | null = null;
const onEnter = new WeakMap<Element, () => void>();

function watch(element: Element, enter: () => void): () => void {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer!.unobserve(entry.target);
        const callback = onEnter.get(entry.target);
        onEnter.delete(entry.target);
        callback?.();
      }
    },
    { rootMargin: `${AHEAD_PX}px 0px` },
  );
  onEnter.set(element, enter);
  observer.observe(element);
  return () => {
    onEnter.delete(element);
    observer?.unobserve(element);
  };
}

/** On screen now: in the viewport, and not hidden below its note's fold. */
function onScreenNow(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.bottom < -AHEAD_PX || rect.top > window.innerHeight + AHEAD_PX) return false;
  const fold = element.closest(".docs-note")?.getBoundingClientRect();
  return !fold || (rect.top <= fold.bottom && rect.bottom >= fold.top);
}

/**
 * Whether a block has been on screen yet (it stays drawn once it has).
 *
 * Measured. A note copied from a long passage can hold hundreds of equations
 * behind its fold; inserting all of their markup when the panel opened cost a
 * 130 ms frame and two ~70 ms ones, against none for the same note shown as
 * source. What is on screen at first paint is found in a layout effect, so a
 * cached equation still paints with the note and never flashes its source;
 * the rest wait for the shared observer — which also sees the fold, since an
 * `overflow: hidden` ancestor clips what it reports.
 */
function useOnScreen<T extends Element>(enabled: boolean) {
  const ref = useRef<T>(null);
  const [onScreen, setOnScreen] = useState(false);
  useLayoutEffect(() => {
    if (onScreen || !enabled) return;
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined" || onScreenNow(element)) {
      setOnScreen(true);
      return;
    }
    return watch(element, () => setOnScreen(true));
  }, [onScreen, enabled]);
  return [ref, onScreen] as const;
}

// ---- math ---------------------------------------------------------------------

/**
 * One equation. Read from the shared cache during render, so an equation the
 * document has drawn paints with the note in a single commit; typeset in idle
 * time otherwise (see services/math/idle-typeset.ts). Never charged to the
 * reader's per-task math budget.
 */
export function NoteMath({ latex, display }: { latex: string; display: boolean }) {
  const { renderer, visible } = useContext(NoteRenderContext);
  const [ref, onScreen] = useOnScreen<HTMLElement>(visible);
  const key = `${renderer}|${display ? "d" : "i"}|${latex}`;
  const [drawn, setDrawn] = useState<{ key: string; result: RenderedMath } | null>(null);
  const result = !onScreen
    ? undefined
    : drawn?.key === key
      ? drawn.result
      : peekRenderedMath(latex, display, renderer);

  useEffect(() => {
    if (result || !onScreen) return;
    let alive = true;
    void idleTypesetter.typeset({ latex, displayMode: display, renderer }).then((next) => {
      if (alive && next) setDrawn({ key, result: next });
    });
    return () => {
      alive = false;
    };
  }, [result, onScreen, key, latex, display, renderer]);

  // KaTeX's stylesheet is fetched once, and only by a page showing math.
  const typeset = Boolean(result);
  useEffect(() => {
    if (typeset) loadKatexStyles();
  }, [typeset]);

  if (!result) {
    // The source, as the note stores it, until (or unless) it is drawn.
    return display ? (
      <pre ref={ref as React.Ref<HTMLPreElement>} className="docs-note-math-source">
        <code>{latex}</code>
      </pre>
    ) : (
      <code ref={ref}>{latex}</code>
    );
  }
  return display ? (
    <div
      className="docs-note-math docs-note-math-display"
      // Sanitized by the renderer before it is ever cached.
      dangerouslySetInnerHTML={{ __html: result.html }}
    />
  ) : (
    <span className="docs-note-math" dangerouslySetInnerHTML={{ __html: result.html }} />
  );
}

// ---- diagrams -----------------------------------------------------------------

function useDarkTheme(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setDark(root.classList.contains("dark")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/**
 * The same SVG may be on the page twice — in the document and in a note —
 * and Mermaid namespaces its styles and arrowhead markers by the SVG's id.
 * Suffixing every use of that id keeps the copies from sharing (or stealing)
 * each other's definitions.
 */
function withUniqueIds(svg: string, suffix: string): string {
  const id = /<svg\b[^>]*?\sid="([^"]+)"/.exec(svg)?.[1];
  return id ? svg.split(id).join(`${id}-${suffix}`) : svg;
}

type DiagramState =
  { status: "pending" } | { status: "ready"; svg: string } | { status: "source"; reason: string };

function SourceFigure({ caption, code }: { caption: string; code: string }) {
  return (
    <figure className="docs-note-diagram-source">
      <figcaption>{caption}</figcaption>
      <pre>
        <code>{code}</code>
      </pre>
    </figure>
  );
}

/**
 * A Mermaid diagram, drawn as a still SVG through the reader's render cache —
 * so one copied from a document is the SVG the document already made. A
 * diagram the reader itself would hand to the GPU engine, flatten to an
 * image, or hold back as too heavy is shown as source here: a side panel is
 * not the place to spend seconds of layout.
 */
export function NoteDiagram({ source }: { source: string }) {
  const { visible } = useContext(NoteRenderContext);
  const [ref, onScreen] = useOnScreen<HTMLDivElement>(visible);
  const dark = useDarkTheme();
  const suffix = `note${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [state, setState] = useState<DiagramState>({ status: "pending" });
  const code = source.trim();

  useEffect(() => {
    if (!onScreen) return;
    let alive = true;
    const handle = requestIdleCallbackSafe(() => {
      void (async () => {
        try {
          const [{ decideDiagramRender }, { renderMermaid }, { isRenderedDiagramTooLarge }] =
            await Promise.all([
              import("@/services/diagrams/render-decision"),
              import("@/services/diagrams/mermaid-render-cache"),
              import("@/services/diagrams/mermaid-performance"),
            ]);
          if (decideDiagramRender(code, false).renderer !== "svg") {
            if (alive)
              setState({
                status: "source",
                reason: "Large diagram — open its document to see it drawn",
              });
            return;
          }
          const { svg } = await renderMermaid(code, dark, false);
          if (!alive) return;
          setState(
            isRenderedDiagramTooLarge(svg)
              ? { status: "source", reason: "Large diagram — open its document to see it drawn" }
              : { status: "ready", svg: withUniqueIds(svg, suffix) },
          );
        } catch {
          if (alive) setState({ status: "source", reason: "This diagram could not be drawn" });
        }
      })();
    });
    return () => {
      alive = false;
      cancelIdleCallbackSafe(handle);
    };
  }, [code, dark, onScreen, suffix]);

  if (state.status === "ready") {
    return (
      <div
        className="docs-note-diagram"
        role="img"
        aria-label="Diagram"
        // Mermaid's own output, the same markup the reader inserts.
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    );
  }
  if (state.status === "source") return <SourceFigure caption={state.reason} code={code} />;
  return (
    <div ref={ref} className="docs-note-diagram-pending" role="status" aria-label="Drawing diagram">
      Drawing diagram…
    </div>
  );
}

// The reader's own mind map component, behind its own lazy boundary: a
// notes list without one never downloads it.
const MindMapBlock = lazy(() =>
  import("@/services/mindmap").then((module) => ({ default: module.MindMapBlock })),
);

export function NoteMindMap({ source }: { source: string }) {
  const { visible } = useContext(NoteRenderContext);
  const [ref, onScreen] = useOnScreen<HTMLDivElement>(visible);
  const pending = (
    <div
      ref={ref}
      className="docs-note-diagram-pending"
      role="status"
      aria-label="Drawing mind map"
    >
      Drawing mind map…
    </div>
  );
  if (!onScreen) return pending;
  return (
    <Suspense fallback={pending}>
      <MindMapBlock code={source} />
    </Suspense>
  );
}

// ---- Markdown wiring ------------------------------------------------------------

const textOf = (children: ReactNode): string =>
  Array.isArray(children)
    ? children.map(textOf).join("")
    : typeof children === "string"
      ? children
      : "";

/** Fences that render as a block of their own rather than as code in a `<pre>`. */
const OWN_BLOCK = /\b(?:math-display|language-mermaid|language-mindmap)\b/;

type MarkdownProps<Tag extends "pre" | "code"> = ComponentProps<Tag> & { node?: unknown };

/** A `<pre>`, unless what it holds draws as a block of its own. */
export function NotePre({ node: _node, children, ...rest }: MarkdownProps<"pre">) {
  const child = Array.isArray(children) ? children[0] : children;
  const cls = isValidElement<{ className?: string }>(child) ? (child.props.className ?? "") : "";
  if (OWN_BLOCK.test(cls)) return <>{children}</>;
  return <pre {...rest}>{children}</pre>;
}

/** Code, or — by its class — an equation, a Mermaid diagram or a mind map. */
export function NoteCode({
  node: _node,
  className = "",
  children,
  ...rest
}: MarkdownProps<"code">) {
  if (/\bmath-inline\b/.test(className))
    return <NoteMath latex={textOf(children)} display={false} />;
  if (/\bmath-display\b/.test(className)) return <NoteMath latex={textOf(children)} display />;
  if (/\blanguage-mermaid\b/.test(className)) return <NoteDiagram source={textOf(children)} />;
  if (/\blanguage-mindmap\b/.test(className)) return <NoteMindMap source={textOf(children)} />;
  return (
    <code className={className || undefined} {...rest}>
      {children}
    </code>
  );
}
