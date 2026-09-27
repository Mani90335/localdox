/**
 * A readable reason for a failed Mermaid render.
 *
 * Some failures throw a `TypeError` whose message is a multi-line dump of a
 * circular JavaScript structure — `block-beta` does this, naming React fibers
 * on the host page. Shown verbatim that reads as a crash in the reader's
 * document rather than an unsupported diagram, so the noisy ones are summarised
 * and the useful ones (syntax errors, which name the offending line) are passed
 * through intact.
 *
 * Its own module rather than a second export from a component file: both the
 * eagerly-loaded stage and the lazily-loaded explainer need it, and importing
 * it from the explainer would drag that whole chunk — planner, player, camera —
 * into the initial bundle the lazy boundary exists to avoid.
 */
export function describeRenderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/circular structure|__reactFiber/i.test(message)) {
    return "Mermaid could not render this diagram type in the browser.";
  }
  return message.split("\n").slice(0, 6).join("\n");
}

/**
 * Drop the error SVG Mermaid bolts onto `<body>` when a render throws.
 *
 * It names the element `d<id>` after the id the render was given, and leaves it
 * behind on failure — one orphan per attempt, which accumulates as a reader
 * scrolls past a broken fence.
 */
export function clearRenderArtifacts(id: string): void {
  if (typeof document === "undefined") return;
  document.getElementById(`d${id}`)?.remove();
}
