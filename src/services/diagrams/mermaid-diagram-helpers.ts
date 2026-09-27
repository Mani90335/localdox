import { stageWidthCap } from "./stage-ratio";

/** A tall stage takes the full column, so it gets no width cap at all. */
export function widthCap(ratio: number): string | undefined {
  const cap = stageWidthCap(ratio);
  return cap ? `calc(${cap})` : undefined;
}

// The control row floats over the diagram's bottom edge. Adding its height to
// the stage keeps it off the artwork instead of parked on the last node.
export const TRAY_GUTTER = 56;

export const ZOOM_LIMIT = { min: 0.2, max: 8 };

// mermaid's erDiagram lexer reserves words like CLASS. Keep the existing
// compatibility fallback, but only apply it after the unmodified source fails.
export function quoteErEntities(src: string): string {
  const q = (token: string) => (/^".*"$/.test(token) ? token : `"${token}"`);
  return src
    .split("\n")
    .map((line) => {
      const rel = line.match(/^(\s*)([\w".:-]+)(\s+)(\S*--\S*)(\s+)([\w".:-]+)(\s*:\s*.*)$/);
      if (!rel) return line;
      return rel[1] + q(rel[2]) + rel[3] + rel[4] + rel[5] + q(rel[6]) + rel[7];
    })
    .join("\n");
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function baseName(name: string) {
  return name.replace(/\.(mmd|mermaid|md|markdown)$/i, "") || "diagram";
}
