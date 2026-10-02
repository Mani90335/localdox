// Images on a board: preparing what gets stored, and decoding what gets drawn.
//
// A board stores its images inline as data URLs, inside the board's own file,
// so a board is one self-contained document. That makes size the thing to
// manage: a phone photo is 4–12 MB, and the workspace has a storage budget. So
// an image is downscaled to what a board can usefully show and re-encoded
// before it is stored, never kept at camera resolution.

import type { BoardFile, BoardFiles } from "./model";
import { randomId } from "./model";

const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_EDGE = 2048;
/** Below this, an image within MAX_EDGE is kept byte-for-byte. */
const KEEP_AS_IS_BYTES = 400 * 1024;

export class ImageTooLargeError extends Error {}

function readAsDataURL(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("This image couldn't be read."));
    img.src = src;
  });
}

export interface PreparedImage {
  file: BoardFile;
  width: number;
  height: number;
}

export async function prepareImage(blob: Blob): Promise<PreparedImage> {
  if (blob.size > MAX_INPUT_BYTES) {
    throw new ImageTooLargeError("Images larger than 25 MB can't be added to a board.");
  }
  const original = await readAsDataURL(blob);
  const img = await loadImage(original);
  // SVGs without intrinsic size report 0; give them a sensible box.
  const width = img.naturalWidth || 300;
  const height = img.naturalHeight || 150;
  const isVector = blob.type === "image/svg+xml";
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  let dataURL = original;
  let mimeType = blob.type || "image/png";
  if (!isVector && blob.type !== "image/gif" && (scale < 1 || blob.size > KEEP_AS_IS_BYTES)) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // WebP keeps transparency and is a fraction of PNG's size for photos.
      const encoded = canvas.toDataURL("image/webp", 0.86);
      if (encoded.startsWith("data:image/webp") && encoded.length < dataURL.length) {
        dataURL = encoded;
        mimeType = "image/webp";
      }
    }
  }
  return {
    file: { id: randomId(), mimeType, dataURL, created: Date.now() },
    width: width * scale,
    height: height * scale,
  };
}

/**
 * Decodes stored images once and hands the renderer a drawable source. The
 * board re-renders when a decode finishes, so a board with photos opens at
 * once with placeholders instead of waiting on every image.
 */
export class ImageStore {
  private images = new Map<string, HTMLImageElement | "loading" | "failed">();

  constructor(private onLoad: () => void) {}

  sync(files: BoardFiles) {
    for (const [id, file] of Object.entries(files)) {
      if (this.images.has(id) || typeof file?.dataURL !== "string") continue;
      // Only data URLs: a board file must never make the app fetch a URL.
      if (!file.dataURL.startsWith("data:image/")) {
        this.images.set(id, "failed");
        continue;
      }
      this.images.set(id, "loading");
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        this.images.set(id, img);
        this.onLoad();
      };
      img.onerror = () => this.images.set(id, "failed");
      img.src = file.dataURL;
    }
  }

  get = (fileId: string): CanvasImageSource | null => {
    const img = this.images.get(fileId);
    return img && typeof img !== "string" ? img : null;
  };
}
