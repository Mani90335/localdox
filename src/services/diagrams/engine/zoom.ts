/**
 * Enough zoom to read a label however large the diagram is.
 *
 * The SVG stages cap zoom at 8×, which is plenty when the whole diagram fits a
 * screen at a readable size. A 10,000-node flowchart fitted to the stage is a
 * few hundred thousand units wide, so reading one box needs far more.
 */
export function zoomCeiling(width: number, height: number): number {
  const readableSpan = 900;
  return Math.max(8, Math.max(width, height) / readableSpan);
}
