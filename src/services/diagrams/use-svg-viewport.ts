import { useCallback, useEffect, useRef, useState } from "react";
import {
  SvgViewport,
  type ViewTarget,
  type ViewportOptions,
  type ViewportState,
} from "@/lib/viewport";

const IDLE: ViewportState = { zoom: 1, manual: false };

/**
 * Owns one `SvgViewport` for a stage whose SVG is rendered imperatively.
 *
 * The stage calls `attach` once its SVG is in the DOM and `detach` when it
 * tears the SVG down. Zoom state comes back through React only when the
 * reader changes the view, never per camera frame, so the tray's percentage
 * stays current without re-rendering the stage sixty times a second.
 */
export function useSvgViewport() {
  const viewportRef = useRef<SvgViewport | null>(null);
  const [state, setState] = useState<ViewportState>(IDLE);

  const detach = useCallback(() => {
    viewportRef.current?.destroy();
    viewportRef.current = null;
    setState(IDLE);
  }, []);

  const attach = useCallback(
    (host: HTMLElement, svg: ViewTarget, options: Omit<ViewportOptions, "onChange"> = {}) => {
      viewportRef.current?.destroy();
      const viewport = new SvgViewport(host, svg, { ...options, onChange: setState });
      viewportRef.current = viewport;
      setState(IDLE);
      return viewport;
    },
    [],
  );

  useEffect(() => detach, [detach]);

  const zoomIn = useCallback(() => viewportRef.current?.zoomBy(1.3), []);
  const zoomOut = useCallback(() => viewportRef.current?.zoomBy(1 / 1.3), []);
  const reset = useCallback(() => viewportRef.current?.reset(), []);

  return { viewportRef, state, attach, detach, zoomIn, zoomOut, reset };
}
