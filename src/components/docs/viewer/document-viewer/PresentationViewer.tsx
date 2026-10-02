import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize, Minimize } from "lucide-react";
import { dataUrlToArrayBuffer } from "@/lib/markdown/document-utils";
import { ESCAPE_DEPTH, useNavEscape } from "@/hooks/use-nav-history";
import { ViewerHeader } from "../../navigation/ViewerHeader";
import { ErrorState, Loading } from "./shared";
import type { Props } from "./shared";

type Slide = { number: number; title: string; text: string };

function decodeXml(value: string) {
  const el = new DOMParser().parseFromString(`<span>${value}</span>`, "text/html").body;
  return el.textContent ?? value;
}

function extractLegacyPptSlides(buffer: ArrayBuffer): Slide[] {
  const bytes = new Uint8Array(buffer);
  const strings: string[] = [];
  let current = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const code = bytes[index] | (bytes[index + 1] << 8);
    if (code >= 32 && code < 0xfffd) {
      current += String.fromCharCode(code);
    } else {
      if (current.trim().length > 3) strings.push(current.trim());
      current = "";
    }
  }
  if (current.trim().length > 3) strings.push(current.trim());
  return strings
    .filter((text, index, all) => all.indexOf(text) === index)
    .slice(0, 80)
    .map((text, index) => ({
      number: index + 1,
      title: text.split(/\r?\n/)[0].slice(0, 120) || `Slide ${index + 1}`,
      text: text.split(/\r?\n/).slice(1).join("\n").slice(0, 1800),
    }));
}

export function PresentationViewer({ file, embedded, onOpenPalette }: Props) {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [current, setCurrent] = useState(0);
  const [error, setError] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  // Back takes the deck out of fullscreen before it leaves the document, so a
  // presenting reader is not dropped straight out of what they were showing.
  useNavEscape(isFullscreen, () => void document.exitFullscreen?.(), ESCAPE_DEPTH.mode);

  useEffect(() => {
    setSlides([]);
    setCurrent(0);
    setError("");
    let alive = true;
    void (async () => {
      let buffer: ArrayBuffer | null = null;
      try {
        buffer = await dataUrlToArrayBuffer(file.data);
        if (!alive) return;
        if (!buffer) throw new Error("Missing presentation data");
        const { default: JSZip } = await import("jszip");
        const zip = await JSZip.loadAsync(buffer);
        const paths = Object.keys(zip.files)
          .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
          .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
        if (!paths.length) throw new Error("legacy");
        const next = await Promise.all(
          paths.map(async (path, index) => {
            const xml = await zip.file(path)!.async("string");
            const values = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
              .map((match) => decodeXml(match[1]).trim())
              .filter(Boolean);
            return {
              number: index + 1,
              title: values[0] || `Slide ${index + 1}`,
              text: values.slice(1).join("\n"),
            };
          }),
        );
        if (!alive) return;
        setSlides(next);
        setCurrent(0);
      } catch {
        // Binary .ppt files do not share the OOXML slide tree used by PPTX.
        // Preserve their readable text as a deck so the same slide controls
        // remain useful instead of dropping the reader into a download-only flow.
        if (!alive) return;
        const legacySlides = buffer ? extractLegacyPptSlides(buffer) : [];
        if (legacySlides.length) {
          setSlides(legacySlides);
          setCurrent(0);
        } else {
          setError("This PowerPoint file does not contain readable slide text.");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [file.id, file.data]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") setCurrent((value) => Math.min(value + 1, slides.length - 1));
      if (event.key === "ArrowLeft") setCurrent((value) => Math.max(value - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length]);
  const slide = slides[current];
  const goPrev = () => setCurrent((value) => Math.max(value - 1, 0));
  const goNext = () => setCurrent((value) => Math.min(value + 1, slides.length - 1));
  const slideEl = slide && (
    <article className="presentation-slide">
      <div className="absolute inset-0 opacity-90 [background:radial-gradient(circle_at_85%_12%,#45b7e8_0,transparent_32%),radial-gradient(circle_at_12%_90%,#6c5ce7_0,transparent_42%),linear-gradient(135deg,#ffffff_0%,#edf3fb_100%)]" />
      <div className="relative flex h-full flex-col justify-center p-[8%] text-slate-900">
        <div className="mb-5 h-1.5 w-14 rounded-full bg-sky-500" />
        <h1 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight md:text-6xl">
          {slide.title}
        </h1>
        {slide.text && (
          <p className="mt-7 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-slate-600 md:text-xl">
            {slide.text}
          </p>
        )}
      </div>
    </article>
  );

  // Embedded in markdown: reading-only. No header, no rail, no fullscreen —
  // just the slide and two swipe buttons.
  if (embedded) {
    return (
      <section
        ref={containerRef}
        className="presentation-shell relative bg-background text-foreground"
      >
        {error ? (
          <ErrorState message={error} />
        ) : !slide ? (
          <Loading label="Building presentation" />
        ) : (
          <div className="relative flex items-center justify-center overflow-hidden p-4 md:p-8">
            {slideEl}
            {slides.length > 1 && (
              <>
                <button
                  onClick={goPrev}
                  disabled={current === 0}
                  aria-label="Previous slide"
                  className="deck-nav left-3"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  onClick={goNext}
                  disabled={current === slides.length - 1}
                  aria-label="Next slide"
                  className="deck-nav right-3"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      ref={containerRef}
      className="presentation-shell min-h-[calc(100dvh-var(--app-chrome-h))] bg-background text-foreground"
    >
      <ViewerHeader
        actions={
          <>
            {slides.length > 0 && (
              <span className="min-w-12 text-center text-xs text-muted-foreground tabular-nums">
                {current + 1} / {slides.length}
              </span>
            )}
            <button
              onClick={toggleFullscreen}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
          </>
        }
      />
      {error ? (
        <ErrorState message={error} />
      ) : !slide ? (
        <Loading label="Building presentation" />
      ) : (
        <div className="flex min-h-[calc(100dvh-var(--app-chrome-h)-3.5rem)] flex-col">
          <div className="presentation-stage relative flex flex-1 items-center justify-center overflow-hidden p-4 md:p-8">
            {slideEl}
          </div>
          <div className="presentation-rail">
            {slides.map((item, index) => (
              <button
                key={item.number}
                onClick={() => setCurrent(index)}
                className={`presentation-thumb ${current === index ? "is-active" : ""}`}
                aria-label={`Show slide ${item.number}`}
              >
                <span className="text-xs text-muted-foreground">{item.number}</span>
                <span className="presentation-thumb-card">
                  <strong>{item.title}</strong>
                  <small>{item.text}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
