import { useEffect, useState } from "react";

function cameraAllowed(): boolean {
  if (typeof document === "undefined") return true;
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return !reduced && document.documentElement.getAttribute("data-diagram-camera") !== "off";
}

interface StepPreferences {
  /** Play the author's numbered arrows in their order. */
  followNumbers: boolean;
  /** Show each arrow's step number on it. */
  showNumbers: boolean;
}

function stepPreferences(): StepPreferences {
  if (typeof document === "undefined") return { followNumbers: true, showNumbers: true };
  const root = document.documentElement;
  return {
    followNumbers: root.getAttribute("data-diagram-order") !== "auto",
    showNumbers: root.getAttribute("data-diagram-numbers") !== "off",
  };
}

/** Step order and numbering, published on <html> like the camera setting. */
export function useStepPreferences(): StepPreferences {
  const [prefs, setPrefs] = useState(stepPreferences);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const next = stepPreferences();
      setPrefs((current) =>
        current.followNumbers === next.followNumbers && current.showNumbers === next.showNumbers
          ? current
          : next,
      );
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-diagram-order", "data-diagram-numbers"],
    });
    return () => observer.disconnect();
  }, []);
  return prefs;
}

/**
 * Whether Stepped may move its camera: the reader's setting (published on
 * <html> as `data-diagram-camera`, like the colour preference) and the
 * system's reduced-motion request, which always wins.
 */
export function useCameraPreference(): boolean {
  const [allowed, setAllowed] = useState(cameraAllowed);
  useEffect(() => {
    const sync = () => setAllowed(cameraAllowed());
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-diagram-camera"],
    });
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    motion?.addEventListener("change", sync);
    return () => {
      observer.disconnect();
      motion?.removeEventListener("change", sync);
    };
  }, []);
  return allowed;
}
