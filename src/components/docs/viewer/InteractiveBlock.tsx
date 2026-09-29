import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useMediaQuery } from "@/hooks/use-media-query";
import { htmlFrameDocument, reactFrameDocument } from "@/services/interactive/frame-document";
import { FRAME_MESSAGE, RUN_MESSAGE, type RunMessage } from "@/services/interactive/frame-protocol";

export type InteractiveKind = "html" | "react";
export type InteractiveMode = "standard" | "preview" | "split" | "playground";

interface InteractiveBlockProps {
  kind: InteractiveKind;
  code: string;
  meta?: string;
}

interface RuntimeError {
  message: string;
  stack?: string;
}

const MIN_FRAME_HEIGHT = 176;
const MAX_FRAME_HEIGHT = 960;
/** How long a playground waits after the last keystroke before it compiles. */
const EDIT_SETTLE_MS = 400;

export function interactiveMode(meta?: string): InteractiveMode {
  const flags = new Set((meta ?? "").toLowerCase().split(/\s+/).filter(Boolean));
  if (flags.has("playground")) return "playground";
  if (flags.has("split")) return "split";
  if (flags.has("preview")) return "preview";
  return "standard";
}

export function InteractiveBlock({ kind, code, meta }: InteractiveBlockProps) {
  const mode = interactiveMode(meta);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const runId = useRef(0);
  const [source, setSource] = useState(code);
  const [visible, setVisible] = useState(false);
  // Counts "booted" messages. A frame that reloads boots again and must be
  // sent the current code again; a flag would already be set and stay silent.
  const [frameBoots, setFrameBoots] = useState(0);
  const [frameHeight, setFrameHeight] = useState(300);
  const [error, setError] = useState<RuntimeError | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [compiled, setCompiled] = useState<string | RuntimeError | null>(null);
  const [runtime, setRuntime] = useState<string | null>(null);

  // What the preview shows. The document's code applies at once; playground
  // edits apply once typing pauses. Each keystroke used to compile, remount
  // the example (losing its state) and flash an error for every half-typed
  // line, and an HTML example reloaded its frame per keystroke.
  const [settled, setSettled] = useState(code);

  useEffect(() => {
    setSource(code);
    setSettled(code);
  }, [code]);

  useEffect(() => {
    if (source === settled) return;
    const timer = setTimeout(() => setSettled(source), EDIT_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [source, settled]);

  // Avoid compiling/mounting below-the-fold examples until they approach the
  // reader. The frame stays empty until then, so each document can hold many demos.
  useEffect(() => {
    if (!sectionRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setVisible(true),
      { rootMargin: "320px 0px" },
    );
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const syncTheme = () => setTheme(pageTheme());
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Compiled by Babel in a worker, once per distinct source, and only for
  // examples near the viewport (services/interactive/compiler-client.ts).
  // The preview keeps its last run until the new code arrives.
  useEffect(() => {
    if (kind !== "react" || !visible) return;
    let cancelled = false;
    import("@/services/interactive/compiler")
      .then(({ compiler }) => compiler.compile(settled))
      .then(
        (result) =>
          !cancelled &&
          setCompiled(result.ok ? result.code : { message: result.message, stack: result.stack }),
        (cause) => !cancelled && setCompiled(toRuntimeError(cause)),
      );
    return () => {
      cancelled = true;
    };
  }, [kind, settled, visible]);

  // A compile error shows at once; it doesn't wait for the frame.
  useEffect(() => {
    if (compiled !== null && typeof compiled !== "string") setError(compiled);
  }, [compiled]);

  // React and the preview runtime, inlined into the frame (see frame-document.ts).
  useEffect(() => {
    if (kind !== "react" || !visible) return;
    let cancelled = false;
    import("virtual:interactive-frame-runtime").then(
      (module) => !cancelled && setRuntime(module.default),
      (cause) => !cancelled && setError(toRuntimeError(cause)),
    );
    return () => {
      cancelled = true;
    };
  }, [kind, visible]);
  // Built once per runtime: the theme travels with each run, so switching it
  // doesn't reload the frame.
  const reactDocument = useMemo(
    () => (runtime ? reactFrameDocument(runtime, pageTheme()) : undefined),
    [runtime],
  );

  const sendToFrame = useCallback(() => {
    const frame = iframeRef.current?.contentWindow;
    if (!frame || !visible || frameBoots === 0) return;
    if (typeof compiled !== "string") return;
    setError(null);
    const message: RunMessage = {
      type: RUN_MESSAGE,
      id: `${++runId.current}`,
      code: compiled,
      theme,
    };
    frame.postMessage(message, "*");
  }, [compiled, frameBoots, theme, visible]);

  useEffect(() => sendToFrame(), [sendToFrame]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || event.data?.type !== FRAME_MESSAGE)
        return;
      const data = event.data as {
        event?: string;
        height?: number;
        message?: string;
        stack?: string;
      };
      if (data.event === "booted") setFrameBoots((boots) => boots + 1);
      if (data.event === "height" && typeof data.height === "number") {
        setFrameHeight(Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, data.height + 2)));
      }
      if (data.event === "error")
        setError({ message: data.message ?? "The preview failed.", stack: data.stack });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const playground = mode === "playground";
  const sourcePanel = playground ? (
    <textarea
      aria-label="Interactive component source"
      value={source}
      onChange={(event) => setSource(event.target.value)}
      spellCheck={false}
      className="interactive-editor"
    />
  ) : (
    <pre className="interactive-source">
      <code>{source}</code>
    </pre>
  );

  const preview = visible ? (
    <div className="interactive-preview">
      <iframe
        ref={iframeRef}
        title={`Interactive ${kind} preview`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={kind === "html" ? htmlFrameDocument(settled, theme) : reactDocument}
        style={{ height: frameHeight }}
      />
      {error && <ErrorPanel error={error} onDismiss={() => setError(null)} />}
    </div>
  ) : (
    <div className="interactive-loading">Preparing live example…</div>
  );

  const showSource = mode === "split" || playground;
  const split = mode === "split" || playground;
  /* Matches the 640px the rest of this block's narrow-screen styling uses. */
  const stackSplit = useMediaQuery("(max-width: 640px)");

  return (
    <section ref={sectionRef} className="interactive-block not-prose">
      {showSource && split ? (
        /* Code beside preview needs two readable columns. On a phone the block
           is ~290px wide, so each half would be ~145px — narrower than a line
           of the code it is showing. The stylesheet used to try to stack these
           through `[data-panel-group-direction="horizontal"]`, an attribute
           this version of the library does not emit, so the rule never applied
           and the two panes stayed side by side however narrow the screen got.
           Driving the group's own orientation is what actually turns it. */
        <ResizablePanelGroup
          orientation={stackSplit ? "vertical" : "horizontal"}
          className="interactive-split"
        >
          <ResizablePanel defaultSize="50%" minSize="25%">
            {sourcePanel}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="50%" minSize="25%">
            {preview}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        preview
      )}
    </section>
  );
}

function ErrorPanel({ error, onDismiss }: { error: RuntimeError; onDismiss: () => void }) {
  return (
    <div className="interactive-error" role="alert">
      <div>
        <strong>Preview error</strong>
        <button onClick={onDismiss} aria-label="Dismiss error">
          <X size={14} />
        </button>
      </div>
      <p>{error.message}</p>
      {error.stack && <pre>{error.stack}</pre>}
    </div>
  );
}

function toRuntimeError(value: unknown): RuntimeError {
  const error = value instanceof Error ? value : new Error(String(value));
  return { message: error.message, stack: error.stack };
}

function pageTheme(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}
