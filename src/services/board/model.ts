// The board's document model.
//
// Elements use the open `.excalidraw` element schema (type, x, y, width,
// height, angle, strokeColor, points, boundElements…). That is a plain,
// documented JSON shape, and keeping it means two things stay true: boards made
// before the native editor existed open unchanged, and a board can always be
// handed to another tool. Everything above the schema (rendering, editing, the
// UI) is localdox's own.
//
// Elements are immutable. An edit replaces the element object (see `mutate`),
// which is what lets the renderer cache geometry per object in a WeakMap and
// lets undo keep whole scene arrays by reference.

export type ElementType =
  "rectangle" | "ellipse" | "diamond" | "arrow" | "line" | "freedraw" | "text" | "image";

export type StrokeStyle = "solid" | "dashed" | "dotted";
export type Arrowhead = "arrow" | "triangle" | "dot" | "bar" | null;
export type TextAlign = "left" | "center" | "right";
export type Point = [number, number];

export interface Binding {
  elementId: string;
  focus: number;
  gap: number;
}

export interface BoardElement {
  id: string;
  /** Unknown types (frames, embeds from other tools) are kept and round-tripped. */
  type: ElementType | (string & {});
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: number;
  opacity: number;
  roundness: { type: number; value?: number } | null;
  seed: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  groupIds: string[];
  frameId: string | null;
  boundElements: { id: string; type: "text" | "arrow" }[] | null;
  updated: number;
  link: string | null;
  locked: boolean;
  // text
  text?: string;
  originalText?: string;
  fontSize?: number;
  fontFamily?: number;
  textAlign?: TextAlign;
  verticalAlign?: "top" | "middle" | "bottom";
  containerId?: string | null;
  lineHeight?: number;
  autoResize?: boolean;
  // linear + freedraw
  points?: Point[];
  pressures?: number[];
  simulatePressure?: boolean;
  startBinding?: Binding | null;
  endBinding?: Binding | null;
  startArrowhead?: Arrowhead;
  endArrowhead?: Arrowhead;
  // image
  fileId?: string | null;
  status?: string;
  scale?: [number, number];
  // Anything else another tool wrote is preserved verbatim.
  [extra: string]: unknown;
}

export interface BoardFile {
  id: string;
  mimeType: string;
  dataURL: string;
  created: number;
  [extra: string]: unknown;
}

export type BoardFiles = Record<string, BoardFile>;

/** Which envelope a scene is written back in. */
export type SceneFormat = "board" | "excalidraw";

export interface Scene {
  elements: BoardElement[];
  files: BoardFiles;
  format: SceneFormat;
  /** Top-level fields of the original file that we don't use, kept for round-trip. */
  extra: Record<string, unknown>;
  /** The original appState, kept only for `.excalidraw` files. */
  appState: Record<string, unknown>;
}

export const BOARD_MIME = "application/vnd.localdox.board+json";

// ---------------------------------------------------------------------------
// Palette
//
// Colours are stored as plain hex so a file means the same thing anywhere. The
// screen is what adapts: each palette entry carries a hand-tuned dark variant,
// and any colour that isn't ours (an imported board) gets its lightness
// mirrored, which keeps "dark ink on paper" legible as "light ink on slate".
// ---------------------------------------------------------------------------

export interface Swatch {
  name: string;
  light: string;
  dark: string;
}

export const STROKE_SWATCHES: Swatch[] = [
  { name: "Ink", light: "#1f2430", dark: "#e7e9f0" },
  { name: "Graphite", light: "#6b7280", dark: "#a1a7b3" },
  { name: "Red", light: "#e5484d", dark: "#ff6b6f" },
  { name: "Orange", light: "#ef6c1a", dark: "#ff8f45" },
  { name: "Amber", light: "#c98a00", dark: "#f1b730" },
  { name: "Green", light: "#2b9a66", dark: "#4cc38a" },
  { name: "Blue", light: "#1e7ae0", dark: "#5aa7ff" },
  { name: "Violet", light: "#6e56cf", dark: "#a08cff" },
];

export const FILL_SWATCHES: Swatch[] = [
  { name: "Mist", light: "#eceef2", dark: "#363c48" },
  { name: "Blush", light: "#ffe1e1", dark: "#5c2b2e" },
  { name: "Peach", light: "#ffe6d2", dark: "#5e3a1f" },
  { name: "Butter", light: "#fff0b3", dark: "#5c4b16" },
  { name: "Mint", light: "#d9f5e5", dark: "#1f4d37" },
  { name: "Sky", light: "#dcecff", dark: "#1f4069" },
  { name: "Lilac", light: "#ebe4ff", dark: "#3d316d" },
];

export const HIGHLIGHT_SWATCHES: Swatch[] = [
  { name: "Yellow", light: "#ffd400", dark: "#ffd400" },
  { name: "Green", light: "#3ddc84", dark: "#3ddc84" },
  { name: "Pink", light: "#ff5fa2", dark: "#ff5fa2" },
  { name: "Blue", light: "#4ab3ff", dark: "#4ab3ff" },
];

const darkVariant = new Map<string, string>();
for (const swatch of [...STROKE_SWATCHES, ...FILL_SWATCHES, ...HIGHLIGHT_SWATCHES]) {
  darkVariant.set(swatch.light.toLowerCase(), swatch.dark);
}

const mirrored = new Map<string, string>();

/** The colour to paint `stored` with on the current surface. */
export function displayColor(stored: string, dark: boolean): string {
  if (!dark || !stored || stored === "transparent") return stored;
  const key = stored.toLowerCase();
  const known = darkVariant.get(key);
  if (known) return known;
  let flipped = mirrored.get(key);
  if (!flipped) {
    flipped = mirrorLightness(key) ?? stored;
    mirrored.set(key, flipped);
  }
  return flipped;
}

function mirrorLightness(hex: string): string | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(hex);
  if (!match) return null;
  let digits = match[1];
  if (digits.length === 3) digits = [...digits].map((d) => d + d).join("");
  const r = parseInt(digits.slice(0, 2), 16) / 255;
  const g = parseInt(digits.slice(2, 4), 16) / 255;
  const b = parseInt(digits.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  // A saturated mid-tone reads on either surface, and it may be a colour
  // someone picked by hand: keep it exactly. Only inks that would vanish —
  // near-black, near-white, greys — are mirrored.
  if (s >= 0.35 && l >= 0.25 && l <= 0.75) return hex;
  // Mirror around the middle, then lift slightly: pure mirroring turns
  // saturated mid-tones muddy on a dark surface.
  const nl = Math.min(0.92, Math.max(0.16, 1 - l + (l > 0.35 && l < 0.65 ? 0.08 : 0)));
  return `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(nl * 100)}%)`;
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/**
 * Font families, by the schema's numeric id. 2 and 3 are the schema's own
 * "plain sans" and "code" ids, so other tools reading a board pick sensible
 * stand-ins. Atkinson Hyperlegible — the app's reading face, designed for
 * legibility at small sizes and for low-vision readers — has no schema id, so
 * it takes one well clear of the schema's range.
 */
export const FONT_HYPERLEGIBLE = 100;
export const FONT_SANS = 2;
export const FONT_MONO = 3;

export const HYPERLEGIBLE_FAMILY = "Atkinson Hyperlegible";
const SANS_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const HYPERLEGIBLE_STACK = `"${HYPERLEGIBLE_FAMILY}", ${SANS_STACK}`;
const MONO_STACK = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/**
 * The CSS font stack a family draws with. Hand-lettered faces from other tools
 * are deliberately not shipped (hundreds of kilobytes, and the look this board
 * is not), so every other id draws in the system sans.
 */
export function fontStack(family: number | undefined) {
  if (family === FONT_HYPERLEGIBLE) return HYPERLEGIBLE_STACK;
  return family === FONT_MONO ? MONO_STACK : SANS_STACK;
}

export const FONT_FAMILIES = [
  { value: FONT_HYPERLEGIBLE, label: "Hyperlegible" },
  { value: FONT_SANS, label: "System" },
  { value: FONT_MONO, label: "Mono" },
] as const;

export const FONT_SIZES = { S: 16, M: 20, L: 28, XL: 40 } as const;
export const LINE_HEIGHT = 1.25;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function randomId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

function randomInt() {
  return Math.floor(Math.random() * 2 ** 31);
}

export interface StyleDefaults {
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roundness: boolean;
  fontSize: number;
  fontFamily: number;
  textAlign: TextAlign;
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
  opacity: number;
}

export const DEFAULT_STYLE: StyleDefaults = {
  strokeColor: STROKE_SWATCHES[0].light,
  backgroundColor: "transparent",
  strokeWidth: 2,
  strokeStyle: "solid",
  roundness: true,
  fontSize: FONT_SIZES.M,
  fontFamily: FONT_HYPERLEGIBLE,
  textAlign: "left",
  startArrowhead: null,
  endArrowhead: "arrow",
  opacity: 100,
};

export function newElement(
  type: ElementType,
  init: Partial<BoardElement> & { x: number; y: number },
  style: StyleDefaults = DEFAULT_STYLE,
): BoardElement {
  const linear = type === "arrow" || type === "line";
  const base: BoardElement = {
    id: randomId(),
    type,
    x: init.x,
    y: init.y,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: style.strokeColor,
    backgroundColor:
      linear || type === "text" || type === "freedraw" ? "transparent" : style.backgroundColor,
    fillStyle: "solid",
    strokeWidth: style.strokeWidth,
    strokeStyle: type === "freedraw" ? "solid" : style.strokeStyle,
    // Zero is the schema's "architect" setting: straight, exact strokes.
    roughness: 0,
    opacity: style.opacity,
    roundness:
      type === "rectangle" || type === "diamond"
        ? style.roundness
          ? { type: 3 }
          : null
        : linear && style.roundness
          ? { type: 2 }
          : null,
    seed: randomInt(),
    version: 1,
    versionNonce: randomInt(),
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
  };
  if (type === "text") {
    Object.assign(base, {
      text: "",
      originalText: "",
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      textAlign: style.textAlign,
      verticalAlign: "top",
      containerId: null,
      lineHeight: LINE_HEIGHT,
      autoResize: true,
    });
  }
  if (linear) {
    Object.assign(base, {
      points: [[0, 0]],
      startBinding: null,
      endBinding: null,
      startArrowhead: type === "arrow" ? style.startArrowhead : null,
      endArrowhead: type === "arrow" ? style.endArrowhead : null,
    });
  }
  if (type === "freedraw") {
    Object.assign(base, { points: [[0, 0]], pressures: [], simulatePressure: true });
  }
  if (type === "image") {
    Object.assign(base, { fileId: null, status: "saved", scale: [1, 1] });
  }
  return { ...base, ...init };
}

/** The only way an element changes: a new object with its version bumped. */
export function mutate(element: BoardElement, changes: Partial<BoardElement>): BoardElement {
  return {
    ...element,
    ...changes,
    version: element.version + 1,
    versionNonce: randomInt(),
    updated: Date.now(),
  };
}

export const isLinear = (el: BoardElement) => el.type === "arrow" || el.type === "line";
export const isShape = (el: BoardElement) =>
  el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond";
/** Elements that can hold a text label and be the end of a connector. */
export const isContainer = (el: BoardElement) => isShape(el);
export const isBindable = (el: BoardElement) =>
  isShape(el) || el.type === "image" || (el.type === "text" && !el.containerId);
export const KNOWN_TYPES = new Set<string>([
  "rectangle",
  "ellipse",
  "diamond",
  "arrow",
  "line",
  "freedraw",
  "text",
  "image",
]);

// ---------------------------------------------------------------------------
// Parsing and serialising
// ---------------------------------------------------------------------------

const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Fills gaps in an element written by another tool, or by an older file. */
function normalize(raw: Record<string, unknown>): BoardElement | null {
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof raw.id !== "string" ||
    typeof raw.type !== "string"
  ) {
    return null;
  }
  if (raw.isDeleted === true) return null;
  const el = raw as BoardElement;
  const points = Array.isArray(el.points)
    ? (el.points.filter(
        (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]),
      ) as Point[])
    : undefined;
  return {
    ...el,
    x: finite(el.x, 0),
    y: finite(el.y, 0),
    width: finite(el.width, 0),
    height: finite(el.height, 0),
    angle: finite(el.angle, 0),
    strokeColor: typeof el.strokeColor === "string" ? el.strokeColor : DEFAULT_STYLE.strokeColor,
    backgroundColor: typeof el.backgroundColor === "string" ? el.backgroundColor : "transparent",
    fillStyle: typeof el.fillStyle === "string" ? el.fillStyle : "solid",
    strokeWidth: finite(el.strokeWidth, 2),
    strokeStyle:
      el.strokeStyle === "dashed" || el.strokeStyle === "dotted" ? el.strokeStyle : "solid",
    roughness: finite(el.roughness, 0),
    opacity: finite(el.opacity, 100),
    roundness: el.roundness && typeof el.roundness === "object" ? el.roundness : null,
    seed: finite(el.seed, randomInt()),
    version: finite(el.version, 1),
    versionNonce: finite(el.versionNonce, randomInt()),
    isDeleted: false,
    groupIds: Array.isArray(el.groupIds) ? el.groupIds.filter((g) => typeof g === "string") : [],
    frameId: typeof el.frameId === "string" ? el.frameId : null,
    boundElements: Array.isArray(el.boundElements) ? el.boundElements : null,
    updated: finite(el.updated, Date.now()),
    link: typeof el.link === "string" ? el.link : null,
    locked: el.locked === true,
    ...(points ? { points: points.length ? points : [[0, 0]] } : {}),
    ...(el.type === "text"
      ? {
          text: typeof el.text === "string" ? el.text : "",
          fontSize: finite(el.fontSize, FONT_SIZES.M),
          lineHeight: finite(el.lineHeight, LINE_HEIGHT),
        }
      : {}),
  };
}

export class SceneParseError extends Error {}

/**
 * Reads a board file. Empty content is a new, empty board; content that isn't a
 * scene throws, so the caller can say so instead of silently opening a blank
 * canvas over a file it would then overwrite.
 */
export function parseScene(content: string, fileName = ""): Scene {
  const fallbackFormat: SceneFormat = /\.excalidraw$/i.test(fileName) ? "excalidraw" : "board";
  if (!content.trim()) {
    return { elements: [], files: {}, format: fallbackFormat, extra: {}, appState: {} };
  }
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new SceneParseError("This board's file isn't valid JSON.");
  }
  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray((data as { elements?: unknown }).elements)
  ) {
    throw new SceneParseError("This file doesn't contain a board.");
  }
  const { elements, files, appState, type, ...extra } = data as Record<string, unknown>;
  const format: SceneFormat =
    type === "excalidraw" ? "excalidraw" : type === "localdox-board" ? "board" : fallbackFormat;
  const parsed = (elements as Record<string, unknown>[])
    .map(normalize)
    .filter((el): el is BoardElement => el !== null);
  return {
    elements: parsed,
    files: files && typeof files === "object" ? (files as BoardFiles) : {},
    format,
    extra,
    appState:
      format === "excalidraw" && appState && typeof appState === "object"
        ? (appState as Record<string, unknown>)
        : {},
  };
}

/** Files no live element points at are dropped on save, so undoing an image insert frees its bytes. */
function referencedFiles(elements: BoardElement[], files: BoardFiles): BoardFiles {
  const used: BoardFiles = {};
  for (const el of elements) {
    if (el.type === "image" && el.fileId && files[el.fileId]) used[el.fileId] = files[el.fileId];
  }
  return used;
}

export function serializeScene(scene: Scene): string {
  const files = referencedFiles(scene.elements, scene.files);
  if (scene.format === "excalidraw") {
    return JSON.stringify({
      ...scene.extra,
      type: "excalidraw",
      version: 2,
      source: typeof scene.extra.source === "string" ? scene.extra.source : "localdox",
      elements: scene.elements,
      appState: {
        gridSize: null,
        viewBackgroundColor: "#ffffff",
        ...pick(scene.appState, ["gridSize", "gridStep", "viewBackgroundColor"]),
      },
      files,
    });
  }
  return JSON.stringify({
    ...scene.extra,
    type: "localdox-board",
    version: 1,
    elements: scene.elements,
    files,
  });
}

function pick(source: Record<string, unknown>, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (key in source) out[key] = source[key];
  return out;
}
