import { useSyncExternalStore } from "react";

/**
 * Where overlays must mount while something is in element fullscreen.
 *
 * The Fullscreen API promotes one element to the top layer, and only that
 * element's subtree is painted. Menus, tooltips, dialogs, popovers and toasts
 * portal to <body> by default, which is outside it: they open, take focus and
 * trap the keyboard, but the reader never sees them. A viewer's Export menu in
 * fullscreen, or a diagram node's colour picker, looked like a dead button.
 *
 * Portalling into the fullscreen element instead keeps them in the painted
 * subtree. Outside fullscreen this returns `undefined`, which every portal API
 * here reads as "use the default" (<body>), so nothing changes there.
 */
export function usePortalContainer(): HTMLElement | undefined {
  return useSyncExternalStore(subscribe, getContainer, getServerContainer);
}

function subscribe(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

// A fullscreen <video> or <iframe> (a markdown video, a YouTube embed) cannot
// host DOM children, so overlays stay on <body> then, as they did before.
const CANNOT_HOST = new Set(["VIDEO", "AUDIO", "IFRAME", "IMG", "CANVAS", "OBJECT", "EMBED"]);

function getContainer(): HTMLElement | undefined {
  const element = document.fullscreenElement;
  if (!(element instanceof HTMLElement) || CANNOT_HOST.has(element.tagName)) return undefined;
  return element;
}

function getServerContainer(): HTMLElement | undefined {
  return undefined;
}
