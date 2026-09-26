// Device capability tier.
//
// The app leans on translucent surfaces — the app header, the viewer header and
// the mobile bottom bar all sit over scrolling content with a backdrop blur.
// `backdrop-filter` is one of the most expensive things a page can ask for:
// each blurred element forces the compositor to re-sample everything behind it,
// and because these surfaces are sticky, that happens on *every frame of every
// scroll*. On a phone with an underpowered GPU it is enough on its own to keep
// scrolling off 60fps.
//
// Rather than drop the effect for everyone, the page is tagged once at startup
// with the tier it can afford, and `styles.css` turns the blur (and other
// decorative compositing) off for `lite`. Nothing about the layout changes —
// the surfaces become opaque instead of translucent, so text stays legible.

export type DeviceTier = "full" | "lite";

interface CapabilityHints {
  /** GiB of RAM, where the browser will say. Chrome caps this at 8. */
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

/**
 * Decide the tier. Deliberately conservative: the effect is decorative, so
 * spending it only where it is clearly affordable is the right trade.
 */
export function detectDeviceTier(): DeviceTier {
  if (typeof window === "undefined") return "full";

  // An explicit user preference wins over any hardware guess.
  const media = (q: string) => {
    try {
      return window.matchMedia(q).matches;
    } catch {
      return false;
    }
  };
  if (media("(prefers-reduced-transparency: reduce)")) return "lite";
  if (media("(prefers-reduced-motion: reduce)")) return "lite";
  // No support for the filter at all — the class would be inert anyway, but
  // tagging it keeps the opaque fallback consistent rather than translucent.
  if (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    !CSS.supports("backdrop-filter", "blur(1px)") &&
    !CSS.supports("-webkit-backdrop-filter", "blur(1px)")
  ) {
    return "lite";
  }

  const nav = navigator as Navigator & CapabilityHints;
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4) return "lite";
  if (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency <= 4) return "lite";

  return "full";
}

/**
 * Tag `<html>` with the tier. Called once from the app root; re-running is
 * harmless. Also re-evaluates when the user changes the OS preference, so
 * turning "reduce transparency" on takes effect without a reload.
 */
export function applyDeviceTier(): () => void {
  if (typeof document === "undefined") return () => {};

  const apply = () => {
    document.documentElement.dataset.fx = detectDeviceTier();
  };
  apply();

  const queries = ["(prefers-reduced-transparency: reduce)", "(prefers-reduced-motion: reduce)"]
    .map((q) => {
      try {
        return window.matchMedia(q);
      } catch {
        return null;
      }
    })
    .filter((m): m is MediaQueryList => m !== null);

  queries.forEach((m) => m.addEventListener("change", apply));
  return () => queries.forEach((m) => m.removeEventListener("change", apply));
}
