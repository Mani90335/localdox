import { memo, useEffect, useRef } from "react";

/**
 * The "42%" pill that fades in while the reader scrolls.
 *
 * This used to be two pieces of state on `MarkdownViewer` itself, updated from
 * a scroll-driven `requestAnimationFrame`. Because the percentage changes on
 * almost every frame, that re-rendered the entire viewer — header, section
 * picker and the whole rendered markdown tree — for every frame of every
 * scroll. On a slow device that alone was enough to drop the scroll below 60fps
 * on a long document.
 *
 * Nothing outside this pill ever read those values, so they live here now, and
 * they are written straight to the DOM rather than through state: scrolling
 * triggers no React render at all, at any depth.
 */
interface Props {
  /** The element that scrolls. Falls back to the document scroller. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Also re-measure when this element resizes (images and math settle late). */
  contentRef?: React.RefObject<HTMLDivElement | null>;
  /** Re-measure when the rendered document changes. */
  revision?: string;
  hidden?: boolean;
}

/** How long after the last scroll event the pill fades back out. */
const IDLE_MS = 1500;

function ReadingProgressImpl({ containerRef, contentRef, revision, hidden }: Props) {
  const pillRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (hidden) return;
    const el = containerRef.current;
    const pill = pillRef.current;
    const label = labelRef.current;
    if (!el || !pill || !label) return;

    let frame = 0;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPct = -1;
    let visible = false;

    const measure = () => {
      frame = 0;
      // The article usually scrolls inside `containerRef`, but fall back to the
      // document scroller in case an ancestor layout owns the overflow.
      const inner = el.scrollHeight - el.clientHeight > 1;
      const doc = document.documentElement;
      const top = inner ? el.scrollTop : window.scrollY;
      const span = inner
        ? el.scrollHeight - el.clientHeight
        : doc.scrollHeight - window.innerHeight;
      // Nothing to scroll: the whole page is already on screen, so it's read.
      const pct = span <= 1 ? 100 : Math.min(100, Math.max(0, Math.round((top / span) * 100)));
      if (pct !== lastPct) {
        lastPct = pct;
        label.textContent = `${pct}%`;
      }
    };

    const show = () => {
      if (!visible) {
        visible = true;
        pill.style.opacity = "0.6";
      }
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        visible = false;
        pill.style.opacity = "0";
      }, IDLE_MS);
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
      show();
    };

    measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    // Images, embeds and KaTeX settle after the first paint and change the
    // scrollable span; re-measure instead of leaving a stale percentage.
    const ro = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(measure);
    });
    ro.observe(el);
    if (contentRef?.current) ro.observe(contentRef.current);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (idleTimer) clearTimeout(idleTimer);
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [containerRef, contentRef, revision, hidden]);

  if (hidden) return null;

  return (
    <div
      ref={pillRef}
      // `opacity` is driven imperatively above. `transform: translateZ(0)`
      // promotes the pill to its own layer so fading it in and out never
      // repaints the document scrolling behind it.
      style={{ opacity: 0, transform: "translateZ(0)" }}
      className="pointer-events-none fixed bottom-6 right-6 z-50 flex h-8 min-w-[3rem] items-center justify-center rounded-full bg-muted/40 px-2.5 text-xs font-medium tabular-nums text-muted-foreground shadow-sm transition-opacity duration-300"
      aria-hidden
    >
      <span ref={labelRef}>0%</span>
    </div>
  );
}

export const ReadingProgress = memo(ReadingProgressImpl);
