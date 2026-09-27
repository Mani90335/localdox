import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useMediaQuery } from "@/hooks/use-media-query";

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

const FRAME_MESSAGE = "docucraft:interactive";
const MIN_FRAME_HEIGHT = 176;
const MAX_FRAME_HEIGHT = 960;

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
  const [frameReady, setFrameReady] = useState(false);
  const [frameHeight, setFrameHeight] = useState(300);
  const [error, setError] = useState<RuntimeError | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [compiled, setCompiled] = useState<string | RuntimeError | null>(null);

  useEffect(() => setSource(code), [code]);

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
    const syncTheme = () =>
      setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Babel is a sizeable browser compiler. Load and run it only for React
  // examples that have reached the viewport (or entered playground mode).
  useEffect(() => {
    if (kind !== "react" || !visible) return;
    let cancelled = false;
    setCompiled(null);
    void import("@babel/standalone").then(({ transform }) => {
      try {
        if (/^\s*import\s/m.test(source)) {
          throw new Error("React and hooks are provided automatically; remove import statements.");
        }
        const output = transform(source, {
          filename: "interactive-component.tsx",
          presets: ["typescript", ["react", { runtime: "classic" }]],
          plugins: ["transform-modules-commonjs"],
        }).code;
        if (!cancelled) setCompiled(output);
      } catch (cause) {
        if (!cancelled) setCompiled(toRuntimeError(cause));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [kind, source, visible]);

  const sendToFrame = useCallback(() => {
    const frame = iframeRef.current?.contentWindow;
    if (!frame || !visible || !frameReady) return;
    if (compiled === null) return;
    if (typeof compiled !== "string") {
      setError(compiled);
      return;
    }
    setError(null);
    const id = `${++runId.current}`;
    if (kind === "react") {
      frame.postMessage({ type: "docucraft:interactive-run", id, code: compiled, theme }, "*");
    }
  }, [compiled, frameReady, kind, theme, visible]);

  useEffect(() => {
    if (kind === "react") sendToFrame();
  }, [sendToFrame]);

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
      if (data.event === "booted") setFrameReady(true);
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
        src={kind === "react" ? "/interactive-runtime" : undefined}
        srcDoc={kind === "html" ? htmlDocument(source, theme) : undefined}
        onLoad={() => {
          if (kind === "html") setFrameReady(true);
        }}
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

function htmlDocument(source: string, theme: "light" | "dark") {
  const colors =
    theme === "dark"
      ? "color-scheme:dark;background:#151b2b;color:#edf2ff"
      : "color-scheme:light;background:#fff;color:#172033";
  return `<!doctype html><html><head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src data:; media-src data: blob:" />
    <style>html,body{min-height:100%;margin:0}body{padding:18px;font:15px/1.5 ui-sans-serif,system-ui,sans-serif;${colors}}*{box-sizing:border-box}</style>
    <script>
      (() => {
        const deny=()=>{throw new Error('This API is disabled inside interactive documentation blocks.')};
        const UnsafeFunction=Function;
        window.open=deny; window.fetch=deny; window.eval=deny; window.Function=deny;
        ['localStorage','sessionStorage','indexedDB','caches','Notification','Clipboard','showOpenFilePicker','showSaveFilePicker'].forEach((name)=>{try{Object.defineProperty(window,name,{configurable:true,get:deny,set:deny})}catch{}});
        try{Object.defineProperty(document,'cookie',{configurable:true,get:deny,set:deny})}catch{}
        if(navigator.mediaDevices) navigator.mediaDevices.getUserMedia=deny;
        if(navigator.geolocation) navigator.geolocation.getCurrentPosition=deny;
        new ResizeObserver(()=>parent.postMessage({type:'${FRAME_MESSAGE}',event:'height',height:document.documentElement.scrollHeight},'*')).observe(document.documentElement);
        addEventListener('error',(event)=>parent.postMessage({type:'${FRAME_MESSAGE}',event:'error',message:event.message,stack:event.error&&event.error.stack},'*'));
        parent.postMessage({type:'${FRAME_MESSAGE}',event:'booted'},'*');
        void UnsafeFunction;
      })();
    </script>
  </head><body>${source}</body></html>`;
}
