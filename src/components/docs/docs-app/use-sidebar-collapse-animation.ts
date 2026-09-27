import { useEffect, useRef } from "react";

/**
 * One sidebar width for everyone. It used to be drag-resizable and persisted
 * per browser, which bought very little — the panel holds a file list, not a
 * document — at the cost of a drag handle, a stored preference, and layouts
 * that differed between machines. Long names are truncated with an ellipsis and
 * carry their full text as a tooltip instead.
 */
export const SIDEBAR_WIDTH = 288;

/**
 * Resize the reading column once. Animating sidebar width reflows every
 * paragraph, table and diagram on every frame; only the sidebar contents fade.
 *
 * Returns the two refs the caller attaches to the sidebar's outer wrapper
 * (the element whose width changes) and its inner content (the element that
 * fades/slides), matching how `DocsApp` wires them into JSX.
 */
export function useSidebarCollapseAnimation(sidebarCollapsed: boolean) {
  const sidebarWrapRef = useRef<HTMLDivElement>(null);
  const sidebarInnerRef = useRef<HTMLDivElement>(null);
  const firstCollapseRun = useRef(true);

  useEffect(() => {
    const wrap = sidebarWrapRef.current;
    if (!wrap) return;
    const inner = sidebarInnerRef.current;
    const width = sidebarCollapsed ? 56 : SIDEBAR_WIDTH;
    const opacity = sidebarCollapsed ? 0 : 1;
    const shift = sidebarCollapsed ? -16 : 0;

    // First run positions without animating: the restored state shouldn't play
    // an entrance every time the app boots.
    if (firstCollapseRun.current) {
      firstCollapseRun.current = false;
      wrap.style.width = `${width}px`;
      if (inner) {
        inner.style.opacity = String(opacity);
        inner.style.visibility = sidebarCollapsed ? "hidden" : "visible";
        inner.style.transform = `translateX(${shift}px)`;
      }
      return;
    }

    const animations: Animation[] = [];
    wrap.style.width = `${width}px`;

    if (inner) {
      // Expanding: become visible up front so the fade-in is actually seen.
      // Collapsing: stay visible until the fade finishes, then drop out of
      // hit-testing — a transparent-but-visible sidebar would swallow clicks
      // meant for the collapsed icon rail underneath it.
      if (!sidebarCollapsed) inner.style.visibility = "visible";

      const fade = inner.animate?.(
        [
          { opacity: inner.style.opacity || "1", transform: inner.style.transform || "none" },
          { opacity: String(opacity), transform: `translateX(${shift}px)` },
        ],
        {
          duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 160,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          fill: "forwards",
        },
      );
      inner.style.opacity = String(opacity);
      inner.style.transform = `translateX(${shift}px)`;

      if (sidebarCollapsed) {
        if (fade) {
          animations.push(fade);
          void fade.finished
            .then(() => {
              // Guard against a re-expand landing while the fade was running.
              if (inner.style.opacity === "0") inner.style.visibility = "hidden";
            })
            .catch(() => {
              /* cancelled by a state change — the next run sets visibility */
            });
        } else {
          inner.style.visibility = "hidden";
        }
      } else if (fade) {
        animations.push(fade);
      }
    }

    return () => animations.forEach((a) => a.cancel());
  }, [sidebarCollapsed]);

  return { sidebarWrapRef, sidebarInnerRef };
}
