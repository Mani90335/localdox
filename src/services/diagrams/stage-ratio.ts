/**
 * The proportions a diagram stage is allowed to take.
 *
 * Every stage — animator, explainer, static — sizes its box from the rendered
 * diagram's own aspect ratio, and every one of them must agree on the bounds.
 * They live here rather than in `Mermaid.tsx` so sharing them doesn't force a
 * component module to export non-components (which breaks Fast Refresh).
 *
 * The floor is low deliberately: a left-to-right flow of four or five nodes is
 * genuinely around 0.3, and squaring it up reintroduces the dead band the
 * measurement exists to remove. The ceiling matters more — a tall `flowchart
 * TD` measures far past it, and a stage that trusts the raw number builds a box
 * many screens tall that `maxHeight` then crushes, leaving the diagram an
 * unreadable sliver.
 */
import type { CSSProperties } from "react";

export const MIN_STAGE_RATIO = 0.26;
/**
 * Past this, a diagram stops being something you fit on screen.
 *
 * Below it a diagram is capped to a screenful and framed whole. Above it —
 * a long `flowchart TD`, say, which can run 20:1 — fitting the whole thing
 * into one screenful means scaling every node down until the labels are
 * unreadable (a twenty-node chain came out at 19px per node). Such a diagram
 * is treated like a long code block instead: it takes the full column width,
 * grows to whatever height its own proportions require, and the reader scrolls
 * the page past it.
 */
export const TALL_STAGE_RATIO = 1.9;

/** True when a diagram is too tall to be worth fitting on one screen. */
export function isTallStage(ratio: number): boolean {
  return ratio > TALL_STAGE_RATIO;
}

/**
 * Clamp a measured aspect ratio into the band a *fitted* stage sizes itself by.
 *
 * Only meaningful below `TALL_STAGE_RATIO`; a tall stage uses its true ratio,
 * because the whole point is to let it be as tall as it really is.
 */
export function clampStageRatio(ratio: number): number {
  if (isTallStage(ratio)) return ratio;
  return Math.min(TALL_STAGE_RATIO, Math.max(MIN_STAGE_RATIO, ratio));
}

/** Kept for the animator stage, which still frames every diagram to a screenful. */
export const MAX_STAGE_RATIO = TALL_STAGE_RATIO;

/**
 * The narrowest a diagram frame may be squeezed, whatever its proportions.
 *
 * The frame is not just the picture: it carries the mode tabs and the action
 * tray along its top, which on a touch device need about 230px between them.
 * The cap below is derived from viewport *height*, so a short window — a phone
 * held sideways, where `70vh` is only ~270px — drove it well under that and
 * clipped the toolbar inside a frame too narrow to hold it. Widths above this
 * are unaffected; `max()` only ever raises the floor.
 */
const MIN_STAGE_WIDTH = "17rem";

/**
 * The width a stage (and the frame around it) should take for a given ratio.
 *
 * A fitted stage is capped to a screenful of height, so the width preserving
 * the diagram's proportions is `height / ratio`. A tall stage is not capped at
 * all: it takes the full column, and its height follows from that width.
 *
 * This is a *max*-width, so the floor cannot overflow a narrow column: the
 * frame still only takes the width its container actually offers.
 */
export function stageWidthCap(ratio: number): string | undefined {
  if (isTallStage(ratio)) return undefined;
  return `max(${MIN_STAGE_WIDTH}, min(32rem, 70vh) / ${ratio})`;
}

/** The diagram's own size, in viewBox units, as Mermaid laid it out. */
export interface DiagramSize {
  width: number;
  height: number;
}

/**
 * Inline sizing for a stage box.
 *
 * One helper so the three stages cannot drift apart on this again.
 *
 * A **fitted** stage holds the diagram's proportions inside a screenful; the
 * diagram scales down to suit, which is fine because it was never far off.
 *
 * A **tall** stage is sized to the diagram's own height instead. Giving it an
 * aspect ratio looked equivalent and was not: the box is as wide as the column,
 * so `1 / 19.87` asked for sixteen thousand pixels of height and
 * `preserveAspectRatio` obligingly blew every node up to 349px. What a long
 * diagram actually wants is its natural size — the units Mermaid laid it out in,
 * rendered about 1:1 and centred, with the page doing the scrolling.
 */
export function stageBoxStyle(
  ratio: number,
  trayGutter: number,
  size?: DiagramSize,
): CSSProperties {
  if (isTallStage(ratio) && size) {
    return {
      height: size.height,
      paddingBottom: trayGutter,
      minHeight: "9rem",
    };
  }
  return {
    aspectRatio: `1 / ${ratio}`,
    paddingBottom: trayGutter,
    maxHeight: "min(32rem, 70vh)",
    minHeight: "9rem",
  };
}
