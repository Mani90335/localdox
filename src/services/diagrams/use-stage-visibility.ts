import { useEffect, useRef, type RefObject } from "react";

/**
 * Whether a diagram stage can be seen: some of it is in the viewport and the
 * tab is in the foreground.
 *
 * A diagram mounts shortly before the reader reaches it and stays mounted
 * after they scroll past, so an animated one would otherwise keep drawing for
 * as long as the document is open. Stages use this to stop their frame loop
 * while nobody can see it.
 *
 * `onChange` fires on every change and may be a new function each render.
 * The returned ref holds the current answer, for a player created later that
 * needs to start in the right state.
 */
export function useStageVisibility(
  targetRef: RefObject<HTMLElement | null>,
  onChange: (visible: boolean) => void,
): RefObject<boolean> {
  const visibleRef = useRef(true);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    let intersecting = true;
    const sync = () => {
      const visible = intersecting && document.visibilityState !== "hidden";
      if (visible === visibleRef.current) return;
      visibleRef.current = visible;
      onChangeRef.current(visible);
    };
    // Without IntersectionObserver the stage counts as on screen, as before.
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            intersecting = entries[entries.length - 1]?.isIntersecting ?? intersecting;
            sync();
          });
    observer?.observe(target);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [targetRef]);

  return visibleRef;
}

/** The system's reduced-motion request, read when a player starts. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}
