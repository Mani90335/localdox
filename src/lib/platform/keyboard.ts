// Shared keyboard-shortcut helpers.

/**
 * True when a key event should be left to the focused editable element.
 * Undo/redo and select-all all mean something different inside a text field,
 * and the markdown editor is a plain <textarea> relying on native undo.
 */
/**
 * `requestIdleCallback` with a timer fallback.
 *
 * Safari still does not implement it, and the warm-up paths that schedule
 * non-critical work (webfonts, markdown plugins, the palette chunk) must not
 * simply never run there. Returns a handle that `cancelIdleCallbackSafe`
 * accepts, so callers can clean up on unmount either way.
 */
export function requestIdleCallbackSafe(fn: () => void, timeout = 2000): number {
  if (typeof requestIdleCallback === "function") {
    return requestIdleCallback(fn, { timeout }) as unknown as number;
  }
  return setTimeout(fn, 200) as unknown as number;
}

export function cancelIdleCallbackSafe(handle: number): void {
  if (!handle) return;
  if (typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
  else clearTimeout(handle);
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

/** True on macOS, where the shortcut modifier is Cmd rather than Ctrl. */
export const isMac =
  typeof navigator !== "undefined" &&
  /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);

/** "⌘" on macOS, "Ctrl" elsewhere — for rendering shortcut hints. */
export const modKeyLabel = isMac ? "⌘" : "Ctrl+";

/** True when the platform's shortcut modifier is held (Cmd on macOS, Ctrl elsewhere). */
export const hasModKey = (e: KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey);
