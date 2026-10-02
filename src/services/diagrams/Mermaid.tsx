import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Expand, LoaderCircle, Minimize2 } from "lucide-react";
import { toast } from "sonner";
import { largeDiagramMermaidConfig } from "./mermaid-config";
import { withMermaid } from "./mermaid-runtime";
import {
  allowHeavyRender,
  decideDiagramRender,
  heldBack,
  rememberOversized,
} from "./render-decision";
import { ModeTabs, type MermaidMode } from "./mermaid-mode-tabs";
import { baseName, download } from "./mermaid-diagram-helpers";
import { useCameraPreference, useStepPreferences } from "./mermaid-reader-preferences";
import { StageSpinner, MermaidError } from "./StageStatus";
import { AnimatorStage } from "./AnimatorStage";
import { StaticStage } from "./StaticStage";
import { HeldStage } from "./HeldStage";
import { PerformanceDiagramImage } from "./PerformanceDiagramImage";
import { Tray, TrayButton } from "./Tray";
import { ZoomControls } from "./ZoomControls";

// Re-exported so sibling modules that historically imported these from
// "./Mermaid" (MermaidExplainer.tsx, LargeDiagramStage.tsx,
// DiagramInteractionBar.tsx) keep working unchanged — the components
// themselves now live in their own files (Tray.tsx, ZoomControls.tsx,
// mermaid-mode-tabs.tsx).
export { Tray, TrayButton, ZoomControls };
export type { MermaidMode };

/**
 * Explainer mode renders through plain `mermaid` rather than the animator, so
 * it is a separate chunk. Splitting it keeps a reader who never switches modes
 * from downloading the planner and player at all.
 */
const MermaidExplainer = lazy(() =>
  import("./MermaidExplainer").then((m) => ({ default: m.MermaidExplainer })),
);

/** The GPU engine's raw stage, for large flowcharts only; see lib/diagram-engine. */
const LargeDiagramStage = lazy(() =>
  import("./LargeDiagramStage").then((m) => ({ default: m.LargeDiagramStage })),
);

export function Mermaid({
  code,
  name = "diagram",
  mode: initialMode = "raw",
}: {
  code: string;
  name?: string;
  /** Starting presentation. Readers can switch from the tray. */
  mode?: MermaidMode;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [mode, setMode] = useState<MermaidMode>(initialMode);
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  // Semantic colouring is a reader preference, published on <html> the same way
  // theme and font are. A diagram lives deep inside rendered markdown with no
  // props reaching it, so the attribute is the channel.
  const [colored, setColored] = useState(
    () =>
      typeof document === "undefined" ||
      document.documentElement.getAttribute("data-diagram-colors") !== "off",
  );
  const camera = useCameraPreference();
  const { followNumbers, showNumbers } = useStepPreferences();
  const [renderError, setRenderError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // Trimming a multi-megabyte source on every state update is measurable. The
  // prop changes only when the document changes, so retain the normalized view.
  const source = useMemo(() => code.trim(), [code]);
  /**
   * The source whose Mermaid render measured too large for live SVG, as
   * reported by whichever stage rendered it. Keyed by source, so a verdict for
   * the previous version of an edited diagram never applies to the next.
   */
  const [oversizedSource, setOversizedSource] = useState<string | null>(null);
  const handleOversized = useCallback((rendered: string) => {
    rememberOversized(rendered);
    setOversizedSource(rendered);
  }, []);
  /**
   * The reader pressed "Draw anyway" on this block. It carries over to later
   * versions of the source, so editing a large mindmap doesn't ask again at
   * every change.
   */
  const [drawHeld, setDrawHeld] = useState(false);
  /**
   * One renderer for every mode; see render-decision.ts.
   *
   * A large flowchart, ER, class or state diagram goes to the GPU engine
   * (Rust/WASM layout, WebGL drawing) instead of being flattened to an image.
   * It stays live in Raw and Stepped; only Flow, the packet animator, remains
   * off at this size. Other kinds become a still image in Raw, and one that
   * would take Mermaid seconds to lay out is held as source until the reader
   * asks for it (preflight.ts).
   */
  const decision = useMemo(() => {
    // Registering the choice is idempotent, and the render cache reads it too.
    if (drawHeld && heldBack(source)) allowHeavyRender(source);
    return decideDiagramRender(source, oversizedSource === source);
  }, [source, oversizedSource, drawHeld]);
  const held = decision.renderer === "held" ? decision.preflight : undefined;
  const gpu = decision.renderer === "gpu";
  const performanceMode = decision.renderer === "image";
  const [performanceImageUrl, setPerformanceImageUrl] = useState<string | null>(null);
  const handlePerformanceImage = useCallback((url: string | null) => {
    setPerformanceImageUrl(url);
  }, []);

  /**
   * A diagram with no sequence to walk — a sequence diagram, a timeline, an
   * xychart — has nothing for stepped mode to do.
   *
   * The tab is disabled rather than the mode being switched out from under the
   * reader. Silently flipping to Raw made the Stepped tab look broken (you
   * pressed it and it bounced back, unexplained), and because the report
   * arrives from the stage's own async render, calling `setMode` there updated
   * the parent while the child was still mounting.
   */
  const [steppedUnavailable, setSteppedUnavailable] = useState(false);
  const handleUnsupported = useCallback(() => setSteppedUnavailable(true), []);
  // A new diagram deserves a fresh verdict; the old one's may not apply.
  useEffect(() => setSteppedUnavailable(false), [source]);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setDark(root.classList.contains("dark"));
      setColored(root.getAttribute("data-diagram-colors") !== "off");
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "data-diagram-colors"],
    });
    return () => observer.disconnect();
  }, []);

  // A syntax error removes the stage. Clear it when the source, theme or mode
  // changes so editing the diagram — or switching renderer — immediately gets a
  // fresh render attempt rather than staying stuck on the previous failure.
  useEffect(() => setRenderError(null), [source, dark, mode]);

  // Full screen is the frame's own, through the Fullscreen API, rather than an
  // overlay painted over the page. An overlay is only ever as large as the
  // viewport the browser chrome leaves behind, and a diagram is exactly the
  // thing worth handing the whole display.
  //
  // The state follows the document rather than the button: Escape and the
  // browser's own exit both leave full screen without going through the
  // control, and the flag has to agree either way.
  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sync = () => {
      setFullscreen(document.fullscreenElement === frameRef.current);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = frameRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => setFullscreen(false));
  }, []);

  // One download, one format. The animation *is* the artifact, and WebM is the
  // only export that carries it; GIF and a still SVG were each a lossy answer to
  // a question nobody asked at the download button.
  const exportDiagram = useCallback(async () => {
    if (!source || exporting) return;
    setExporting(true);
    try {
      const exporter = await import("mermaid-animator/export");
      // The exporter initializes the shared Mermaid too, so it waits its turn
      // (mermaid-runtime.ts). It holds the queue while it records, a few
      // seconds, because there is no way to learn when its render is done.
      const blob = await withMermaid(
        () =>
          exporter.exportVideo(source, {
            theme: dark ? "dark" : "light",
            width: 1200,
            height: 800,
            mermaid: largeDiagramMermaidConfig(),
          }),
        { label: "export" },
      );
      download(blob, `${baseName(name)}.webm`);
      toast.success("Downloaded animated Mermaid as WebM");
    } catch (error) {
      toast.error("Could not export WebM", {
        description: error instanceof Error ? error.message : "The browser could not encode it.",
      });
    } finally {
      setExporting(false);
    }
  }, [dark, exporting, name, source]);

  if (!source) {
    return (
      <div className="my-6 flex min-h-40 items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
        Add Mermaid source to preview the animation.
      </div>
    );
  }

  const downloadControl = (
    <TrayButton onClick={() => void exportDiagram()} label="Download WebM video" busy={exporting}>
      {exporting ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
    </TrayButton>
  );

  const unavailable: Partial<Record<MermaidMode, string>> | undefined = held
    ? {
        stepped: "Draw the diagram first to step through it",
        flow: "Draw the diagram first to animate it",
      }
    : performanceMode
      ? {
          stepped: "Disabled for very large diagrams to keep rendering responsive",
          flow: "Disabled for very large diagrams to protect device performance",
        }
      : gpu
        ? { flow: "Disabled for very large diagrams to protect device performance" }
        : steppedUnavailable
          ? { stepped: "This diagram has no sequence to step through" }
          : undefined;

  const visibleMode = held || performanceMode || (gpu && mode === "flow") ? "raw" : mode;
  const modeControl = <ModeTabs mode={visibleMode} onChange={setMode} unavailable={unavailable} />;

  // An unsupported diagram still has to show something: render it raw while
  // leaving the reader's chosen tab alone.
  const effectiveMode: MermaidMode =
    held ||
    performanceMode ||
    (mode === "stepped" && steppedUnavailable) ||
    (gpu && mode === "flow")
      ? "raw"
      : mode;

  /**
   * The bar above the diagram: what mode you are in, and what you can do to the
   * diagram as an object.
   *
   * Deliberately fixed rather than hover-revealed. Switching presentation is
   * navigation, and navigation you cannot see is navigation nobody finds — the
   * previous floating tray hid the tabs until the pointer happened to land on
   * the picture. Playback stays down on the artwork, next to the thing it
   * drives; this row is chrome.
   *
   * The WebM export appears in `flow` alone: it encodes the travelling-packet
   * animation, so offering it beside a still picture or a step-through would
   * hand back a file of something the reader is not looking at.
   */
  const header = (
    // Wraps to a second line rather than squeezing its two groups. A diagram
    // inside the reading column is only ~270px wide on a small phone, which is
    // less than the mode tabs and the action tray need side by side; when they
    // were forced to share it the tabs were silently cut off. Wrapping keeps
    // every control full-size and reachable, and on any screen wide enough for
    // both it still renders as the single row it always was.
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border/70 bg-background/40 px-2 py-1.5">
      {modeControl}
      {/* Plain icons rather than an overflow menu. There are only ever two or
          three of these, and a menu made the reader open something to find out
          it held almost nothing. Each one appears only where it applies, so
          nothing needs hiding. */}
      <Tray>
        {effectiveMode === "flow" ? downloadControl : null}
        <TrayButton
          onClick={toggleFullscreen}
          label={fullscreen ? "Exit full screen" : "Fullscreen"}
        >
          {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
        </TrayButton>
      </Tray>
    </div>
  );

  const stageFor = (stageFill: boolean) => {
    // Nothing is passed down any more: the surrounding controls live in the
    // header, and each stage renders only its own playback.
    const controls = undefined;
    if (held) {
      return (
        <HeldStage
          source={source}
          preflight={held}
          fill={stageFill}
          onDraw={() => setDrawHeld(true)}
        />
      );
    }
    if (effectiveMode === "stepped") {
      return (
        <Suspense fallback={<StageSpinner label="Loading explainer…" />}>
          <MermaidExplainer
            code={source}
            engine={gpu ? "gpu" : "svg"}
            dark={dark}
            colored={colored}
            camera={camera}
            followNumbers={followNumbers}
            showNumbers={showNumbers}
            fill={stageFill}
            controls={controls}
            onError={setRenderError}
            onOversized={handleOversized}
            onUnsupported={handleUnsupported}
          />
        </Suspense>
      );
    }
    if (effectiveMode === "raw" && gpu) {
      return (
        <Suspense fallback={<StageSpinner label="Loading large diagram…" />}>
          <LargeDiagramStage code={source} dark={dark} fill={stageFill} onError={setRenderError} />
        </Suspense>
      );
    }
    if (effectiveMode === "raw") {
      return (
        <StaticStage
          code={source}
          dark={dark}
          colored={colored && !performanceMode}
          fill={stageFill}
          controls={controls}
          onError={setRenderError}
          performanceMode={performanceMode}
          onPerformanceImage={handlePerformanceImage}
          onOversized={handleOversized}
        />
      );
    }
    return (
      <AnimatorStage
        code={source}
        dark={dark}
        fill={stageFill}
        controls={controls}
        onError={setRenderError}
      />
    );
  };

  return (
    <>
      {/* The frame always spans the text column, like every other block in
          the document. A tall diagram's stage is still capped to a screenful
          and centred inside it; the frame used to shrink to that cap, which
          left diagrams in one document at a scatter of different widths. */}
      <div
        ref={frameRef}
        className={`mermaid-frame overflow-hidden border-border bg-muted/30 ${
          fullscreen
            ? "flex h-screen w-screen flex-col rounded-none border-0"
            : "my-6 rounded-xl border"
        }`}
        data-performance-mode={performanceMode ? "" : undefined}
      >
        {header}
        {/* One stage, which simply grows into the screen when the frame does.
            There used to be a second copy inside an overlay, and the inline one
            was torn down while it was open to avoid paying for two live SVGs at
            once; with the frame itself going full screen there is only ever one
            diagram mounted, so nothing has to be swapped out or measured to
            stop the surrounding text from jumping. */}
        {/* The stage keeps one place in the tree in and out of full screen:
            the wrapper only changes class (and is `display: contents` inline),
            so React keeps the same stage instance — its render, its layout and
            the explainer's position — instead of mounting a fresh one. */}
        {renderError ? (
          <MermaidError error={renderError} />
        ) : (
          <div className={fullscreen ? "min-h-0 flex-1" : "contents"}>
            {fullscreen && performanceMode ? (
              performanceImageUrl ? (
                <PerformanceDiagramImage src={performanceImageUrl} name={baseName(name)} fill />
              ) : (
                <StageSpinner label="Preparing large diagram…" />
              )
            ) : (
              stageFor(fullscreen)
            )}
          </div>
        )}
      </div>
    </>
  );
}
