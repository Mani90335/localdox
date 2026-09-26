/**
 * Mermaid source → a bitmap a Word document can embed.
 *
 * Word is the reason this file exists. Print keeps diagrams as SVG — vector,
 * selectable, sharp at any zoom — but `.docx` cannot: Word's SVG support
 * depends on the version, falls back to a blank frame on older ones and on
 * every non-Word reader (Pages, LibreOffice, Google Docs), and Mermaid's output
 * leans on `<foreignObject>` for labels, which even Word's SVG path does not
 * render. A diagram that arrives as an empty rectangle is worse than no export.
 *
 * So the diagram is rasterised here, in the browser that already knows how to
 * draw it: serialise the rendered SVG, load it as an image, paint it to a
 * canvas at print resolution, and hand back PNG bytes. The result is a picture
 * in the document rather than a code listing — which is the whole point of the
 * feature — and it opens identically everywhere.
 */

import { renderMermaid, readSvgViewBox } from "@/services/diagrams";

export interface RasterDiagram {
  png: Uint8Array;
  /** Pixel dimensions of the bitmap, for the writer to scale from. */
  width: number;
  height: number;
}

/**
 * Pixels per CSS pixel when painting.
 *
 * Word scales the image to its declared point size, so the bitmap has to carry
 * enough detail for print rather than for the screen it was drawn on. 2x keeps
 * diagram text legible at 100% zoom and when printed, without producing
 * multi-megabyte parts for a large flowchart.
 */
const SCALE = 2;

/**
 * Cap on the painted bitmap, in pixels per side.
 *
 * Canvas has a hard maximum in every browser (and a much lower effective one on
 * mobile Safari) past which `toBlob` silently yields null. A tall ER diagram
 * scaled 2x reaches it easily, so the scale is reduced to fit rather than
 * letting the export fail on exactly the documents that need diagrams most.
 */
const MAX_SIDE = 4096;

/**
 * Inline the SVG's computed font so the raster matches the screen.
 *
 * The image is decoded in an isolated context that has none of the page's
 * stylesheets: any font the SVG names but does not embed falls back to the
 * platform default, so labels reflow and a diagram that fitted its boxes on
 * screen overflows them in the export. Declaring the family in the markup
 * keeps the metrics the layout was computed against.
 */
function inlineFontFamily(svg: string): string {
  if (/font-family/i.test(svg.slice(0, 2000))) return svg;
  return svg.replace(
    /<svg\b/i,
    '<svg style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"',
  );
}

/**
 * Give the root an explicit pixel width and height.
 *
 * Mermaid emits `width="100%"` with the real size only in the viewBox. An
 * `<img>` given that has no intrinsic size, and Firefox in particular paints it
 * at zero. Writing the viewBox dimensions onto the root makes the image
 * self-describing.
 */
function withExplicitSize(svg: string, width: number, height: number): string {
  return svg
    .replace(/\swidth="[^"]*"/i, "")
    .replace(/\sheight="[^"]*"/i, "")
    .replace(/<svg\b/i, `<svg width="${width}" height="${height}"`);
}

function decodeSvg(svg: string): Promise<HTMLImageElement> {
  // A data URL rather than a blob URL: Safari taints a canvas drawn from a blob
  // URL in some versions, and a tainted canvas cannot be read back at all.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("diagram image failed to decode"));
    image.src = url;
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("diagram bitmap could not be encoded"));
        return;
      }
      blob
        .arrayBuffer()
        .then((buffer) => resolve(new Uint8Array(buffer)))
        .catch(reject);
    }, "image/png");
  });
}

/**
 * Render one Mermaid diagram to PNG bytes.
 *
 * Always renders in the light theme regardless of the reader's current theme:
 * a document is printed or opened on white, and a dark-theme diagram exported
 * into it arrives as a black rectangle in the middle of a white page.
 */
export async function rasterizeMermaid(code: string): Promise<RasterDiagram> {
  const { svg } = await renderMermaid(code, false, false);

  const box = readSvgViewBox(svg) ?? { width: 800, height: 600 };
  const prepared = withExplicitSize(inlineFontFamily(svg), box.width, box.height);
  const image = await decodeSvg(prepared);

  const natural = {
    width: image.naturalWidth || box.width,
    height: image.naturalHeight || box.height,
  };
  const scale = Math.min(SCALE, MAX_SIDE / natural.width, MAX_SIDE / natural.height);
  const width = Math.max(1, Math.round(natural.width * scale));
  const height = Math.max(1, Math.round(natural.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");

  // Mermaid's light theme draws on transparency. Left transparent, the PNG
  // shows through to whatever Word puts behind it, and dark-mode Word readers
  // get black text on black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  return { png: await canvasToPng(canvas), width, height };
}

/**
 * Rasterise every distinct diagram in a document, once each.
 *
 * Keyed by source so a diagram repeated across sections is rendered and
 * encoded a single time — Mermaid layout is the slowest part of the export by
 * a wide margin, and documents that repeat a legend or an architecture sketch
 * are common.
 *
 * A diagram that fails to render does not fail the export: the entry is left
 * out and the writer falls back to showing the source, which is strictly more
 * useful to the reader than an aborted download.
 */
export async function rasterizeAll(sources: string[]): Promise<Map<string, RasterDiagram>> {
  const unique = [...new Set(sources)];
  const out = new Map<string, RasterDiagram>();
  // Sequential rather than parallel: Mermaid's renderer measures text by
  // attaching to the live document, and concurrent renders contend on that
  // single hidden container. Serialising is both more reliable and, for
  // layout-bound work on one main thread, no slower.
  for (const code of unique) {
    try {
      out.set(code, await rasterizeMermaid(code));
    } catch {
      // Left absent on purpose; the caller renders the source instead.
    }
  }
  return out;
}
