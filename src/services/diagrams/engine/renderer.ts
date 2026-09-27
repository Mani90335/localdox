/**
 * Draws a laid-out flowchart with WebGL2.
 *
 * Why not SVG: an SVG diagram is a DOM tree, and past a few thousand elements
 * every camera frame (a viewBox write) repaints all of them and every class
 * toggle restyles the tree. Measured on the SVG path: 5,000 nodes is 76,000
 * elements, the camera alone manages 19fps and the explainer 2fps. Here the
 * whole diagram is three instanced draw calls whatever its size:
 *
 *  - Edges are instanced line segments. How much of each edge is drawn is one
 *    float per edge in a state texture, so the explainer "draws" a stroke by
 *    writing a number, never by touching geometry.
 *  - Arrowheads are instanced triangles that appear once their stroke lands.
 *  - Nodes are instanced quads; the fragment shader draws each outline as a
 *    signed-distance shape with analytic anti-aliasing, plus the reveal fade,
 *    the spotlight dim, the focus halo and the revisit pulse.
 *
 * The camera is two uniforms. A frame at 10,000 nodes costs the same as one at
 * ten; the GPU does the per-element work in parallel.
 *
 * Text is the one thing drawn on a 2D canvas overlay, and only when it would be
 * legible: below ~4px a label is noise, so a zoomed-out diagram draws none, and
 * a zoomed-in one draws only what a spatial grid says is on screen — a few
 * hundred labels at most, never ten thousand.
 */
import type { ViewTarget } from "@/lib/viewport";
import type { Frame } from "../explainer/camera-path.ts";
import { FONT_SIZE, LINE_HEIGHT, ROW_HEIGHT, type Scene, type TableLayout } from "./scene.ts";

const FONT_STACK = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;

export interface DiagramTheme {
  nodeFill: string;
  nodeStroke: string;
  nodeText: string;
  line: string;
  labelText: string;
  labelBackground: string;
  /** The spotlight halo, and the step-number badges. */
  accent: string;
  /** Text on the accent colour. */
  accentText: string;
}

/** What the renderer just showed, for a minimap to mirror. */
export interface RenderedView {
  frame: Frame;
  /** The diagram-space rectangle the whole canvas covers, letterbox included. */
  visible: Frame;
}

export interface RendererOptions {
  /** Stepped mode draws nodes as outlines, as the SVG explainer does. */
  lineArt: boolean;
}

type Rgba = [number, number, number, number];

/** Texels per row of the state textures. */
const STATE_WIDTH = 1024;
/** Labels smaller than this many CSS pixels are not drawn at all. */
const MIN_TEXT_PX = 4;
/** More candidate labels than this on screen means none are readable anyway. */
const MAX_TEXT_ITEMS = 2500;
const EDGE_WIDTH = 2;
const THICK_WIDTH = 3.5;
const ARROW_SIZE = 8;
/** Pinned names at most, per frame: a beat has a handful of nodes. */
const MAX_PINNED = 24;
/** Step-number badge type size, in diagram units, and when it appears. */
const BADGE_FONT = 10;
const BADGE_SHOWN = 0.7;
/** Spotlight dims, matching explainer.css. */
const DIM_NODE = 0.32;
const DIM_EDGE = 0.24;

const HEADER = `#version 300 es
precision highp float;
precision highp int;
uniform vec4 u_view;      // frame x, frame y, device px per unit, device pixel ratio
uniform vec4 u_viewport;  // letterbox offset x, y; canvas width, height (device px)
uniform highp sampler2D u_state;
vec4 toClip(vec2 p) {
  vec2 px = (p - u_view.xy) * u_view.z + u_viewport.xy;
  vec2 ndc = px / u_viewport.zw * 2.0 - 1.0;
  return vec4(ndc.x, -ndc.y, 0.0, 1.0);
}
vec4 stateAt(float index) {
  int i = int(index + 0.5);
  return texelFetch(u_state, ivec2(i % ${STATE_WIDTH}, i / ${STATE_WIDTH}), 0);
}
const vec4 CULLED = vec4(2.0, 2.0, 2.0, 1.0);
`;

const EDGE_VS = `${HEADER}
in vec2 a_corner;
in vec4 a_seg;
in vec4 a_meta;   // distance at p0, distance at p1, edge index, style | 4·first | 8·last
out float v_along;
out float v_across;
flat out float v_limit;
flat out float v_half;
flat out float v_fade;
flat out float v_dotted;
flat out float v_focus;
void main() {
  vec4 st = stateAt(a_meta.z);
  float code = a_meta.w;
  float style = mod(code, 4.0);
  if (st.x <= 0.0 || style > 2.5) { gl_Position = CULLED; return; }
  float first = mod(floor(code / 4.0), 2.0);
  float last = floor(code / 8.0);
  vec2 p0 = a_seg.xy;
  vec2 p1 = a_seg.zw;
  vec2 d = p1 - p0;
  float len = length(d);
  vec2 dir = len > 0.0 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float halfPx = (style == 1.0 ? ${THICK_WIDTH} : ${EDGE_WIDTH}.0) * 0.5 * u_view.z;
  float minHalf = 0.55 * u_view.w;
  // A stroke thinner than a pixel is drawn a pixel wide but faded by how much
  // thinner it really is, down to a whisper: zoomed out on thousands of edges,
  // full-strength hairlines would pile up into a solid mass over the nodes.
  v_fade = clamp(pow(halfPx / minHalf, 0.8), 0.06, 1.0);
  // Except the edges being explained: they stay clearly drawn at any zoom.
  v_fade = max(v_fade, 0.95 * st.z);
  halfPx = max(halfPx, minHalf);
  float reach = (halfPx + u_view.w) / u_view.z;
  // Caps only at the ends of the whole edge: extending interior segments would
  // overlap them at every joint, and a dimmed edge would show beads.
  float s = a_corner.x * 2.0 - 1.0;
  float cap = a_corner.x < 0.5 ? first : last;
  vec2 pos = mix(p0, p1, a_corner.x) + dir * reach * s * cap + nrm * reach * a_corner.y;
  v_along = mix(a_meta.x, a_meta.y, a_corner.x) + reach * s * cap;
  v_across = a_corner.y * (halfPx + u_view.w);
  v_limit = st.x * st.w;
  v_half = halfPx;
  v_dotted = style == 2.0 ? 1.0 : 0.0;
  v_focus = st.z;
  gl_Position = toClip(pos);
}`;

const EDGE_FS = `${HEADER}
uniform vec4 u_color;
uniform float u_spot;
in float v_along;
in float v_across;
flat in float v_limit;
flat in float v_half;
flat in float v_fade;
flat in float v_dotted;
flat in float v_focus;
out vec4 outColor;
void main() {
  if (v_along > v_limit) discard;
  if (v_dotted > 0.5 && mod(v_along, 6.0) > 3.0) discard;
  float aa = 0.5 * u_view.w;
  float cover = 1.0 - smoothstep(v_half - aa, v_half + aa, abs(v_across));
  float dim = mix(1.0, mix(${DIM_EDGE}, 1.0, v_focus), u_spot);
  float a = u_color.a * cover * v_fade * dim;
  outColor = vec4(u_color.rgb * a, a);
}`;

/**
 * Filled marker triangles (arrowheads, composition diamonds, dots), three
 * corners per instance. They appear once their edge has fully landed and fade
 * out below a few pixels, like the strokes they sit on: zoomed out, full-size
 * heads on hairline edges would turn the picture into a field of triangles.
 */
const GLYPH_VS = `${HEADER}
in vec4 a_ab;   // corners 0 and 1
in vec3 a_c;    // corner 2, edge index
flat out float v_focus;
flat out float v_fade;
void main() {
  vec4 st = stateAt(a_c.z);
  if (st.x < 0.999) { gl_Position = CULLED; return; }
  float sizePx = ${ARROW_SIZE}.0 * u_view.z;
  v_fade = clamp((sizePx - 1.5 * u_view.w) / (3.0 * u_view.w), 0.0, 1.0);
  if (v_fade <= 0.0) { gl_Position = CULLED; return; }
  vec2 p = gl_VertexID == 0 ? a_ab.xy : (gl_VertexID == 1 ? a_ab.zw : a_c.xy);
  v_focus = st.z;
  gl_Position = toClip(p);
}`;

const GLYPH_FS = `${HEADER}
uniform vec4 u_color;
uniform float u_spot;
flat in float v_focus;
flat in float v_fade;
out vec4 outColor;
void main() {
  float a = u_color.a * v_fade * mix(1.0, mix(${DIM_EDGE}, 1.0, v_focus), u_spot);
  outColor = vec4(u_color.rgb * a, a);
}`;

const NODE_VS = `${HEADER}
in vec2 a_corner;
in vec4 a_rect;   // centre x, y, width, height
in vec2 a_nmeta;  // shape, node index
in vec4 a_fill;
in vec4 a_stroke;
out vec2 v_p;
flat out vec2 v_half;
flat out float v_shape;
flat out vec4 v_fill;
flat out vec4 v_stroke;
flat out vec4 v_state;
flat out float v_tiny;
void main() {
  vec4 st = stateAt(a_nmeta.y);
  if (st.x <= 0.0) { gl_Position = CULLED; return; }
  // Never smaller than a few pixels, and solid when that small: zoomed out on
  // thousands of nodes, each should still read as a mark, not vanish.
  vec2 halfPx = a_rect.zw * 0.5 * u_view.z;
  v_tiny = 1.0 - smoothstep(2.5 * u_view.w, 7.0 * u_view.w, min(halfPx.x, halfPx.y));
  vec2 halfSize = max(halfPx, vec2(1.25 * u_view.w)) / u_view.z;
  // Room outside the outline for anti-aliasing and the focus halo, in pixels.
  float pad = (10.0 * u_view.w + 2.0) / u_view.z;
  v_p = a_corner * (halfSize + pad);
  v_half = halfSize;
  v_shape = a_nmeta.x;
  v_fill = a_fill;
  v_stroke = a_stroke;
  v_state = st;
  gl_Position = toClip(a_rect.xy + v_p);
}`;

const NODE_FS = `${HEADER}
uniform float u_spot;
uniform vec4 u_accent;
in vec2 v_p;
flat in vec2 v_half;
flat in float v_shape;
flat in vec4 v_fill;
flat in vec4 v_stroke;
flat in vec4 v_state;
flat in float v_tiny;
out vec4 outColor;
float sdBox(vec2 p, vec2 h, float r) {
  vec2 q = abs(p) - h + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float ndot(vec2 a, vec2 b) { return a.x * b.x - a.y * b.y; }
float sdRhombus(vec2 p, vec2 b) {
  vec2 q = abs(p);
  float h = clamp((-2.0 * ndot(q, b) + ndot(b, b)) / dot(b, b), -1.0, 1.0);
  float d = length(q - 0.5 * b * vec2(1.0 - h, 1.0 + h));
  return d * sign(q.x * b.y + q.y * b.x - b.x * b.y);
}
float sdHexagon(vec2 p, vec2 h) {
  vec2 q = abs(p);
  float inset = h.y * 0.5;
  vec2 n = normalize(vec2(h.y, inset));
  return max(q.y - h.y, dot(q - vec2(h.x, 0.0), n));
}
float shape(vec2 p, vec2 h) {
  if (v_shape < 0.5) return sdBox(p, h, 0.0);
  if (v_shape < 1.5) return sdBox(p, h, min(5.0, min(h.x, h.y)));
  if (v_shape < 2.5) return sdBox(p, h, min(h.x, h.y));
  if (v_shape < 3.5) return (length(p / h) - 1.0) * min(h.x, h.y);
  if (v_shape < 4.5) return sdRhombus(p, h);
  if (v_shape < 5.5) return sdHexagon(p, h);
  if (v_shape < 7.5) return (length(p / h) - 1.0) * min(h.x, h.y);
  return sdBox(p, h, 1.0);
}
void main() {
  float d = shape(v_p, v_half) * u_view.z;
  float aa = 0.6 * u_view.w;
  float strokePx = max(1.0 * u_view.z, 0.75 * u_view.w);
  float inside = 1.0 - smoothstep(-aa, aa, d);
  float ring = 1.0 - smoothstep(strokePx * 0.5 - aa, strokePx * 0.5 + aa, abs(d + strokePx * 0.5));
  float fillA = v_fill.a * inside * (1.0 - ring);
  float strokeA = v_stroke.a * ring;
  vec3 rgb = v_fill.rgb * fillA + v_stroke.rgb * strokeA;
  float a = fillA + strokeA;
  float solidA = v_stroke.a * inside;
  // The state start dot and fork/join bars are solid; anything tiny is too.
  bool solid = (v_shape > 5.5 && v_shape < 6.5) || v_shape > 7.5;
  float solidMix = solid ? 1.0 : v_tiny;
  rgb = mix(rgb, v_stroke.rgb * solidA, solidMix);
  a = mix(a, solidA, solidMix);
  if (v_shape > 6.5 && v_shape < 7.5) {
    // The end state: a ring around a dot.
    float inner = (length(v_p / v_half) - 0.55) * min(v_half.x, v_half.y) * u_view.z;
    float innerA = (1.0 - smoothstep(-aa, aa, inner)) * v_stroke.a;
    rgb = rgb * (1.0 - innerA) + v_stroke.rgb * innerA;
    a = a * (1.0 - innerA) + innerA;
  }
  float focus = v_state.y * u_spot;
  if (focus > 0.0 && d > 0.0) {
    float halo = exp(-d / (4.0 * u_view.w)) * 0.55 * focus * u_accent.a;
    rgb += u_accent.rgb * halo * (1.0 - a);
    a += halo * (1.0 - a);
  }
  float pulse = v_state.z > 0.0 ? 1.0 - 0.45 * sin(3.14159265 * v_state.z) : 1.0;
  float dim = mix(1.0, mix(${DIM_NODE}, 1.0, v_state.y), u_spot);
  float alpha = v_state.x * pulse * dim;
  outColor = vec4(rgb, a) * alpha;
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Diagram shader failed to compile: ${gl.getShaderInfoLog(shader)}`);
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Diagram shaders failed to link: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

/**
 * Resolve any CSS colour — hex, rgb(), hsl(), oklch(), a name — to RGBA.
 *
 * Painting one pixel and reading it back is the only way that covers every
 * format the browser understands, including the theme's oklch() variables.
 * An unparseable value leaves the sentinel in place and gets the fallback.
 */
function colorParser(): (css: string | undefined, fallback: Rgba) => Rgba {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const cache = new Map<string, Rgba>();
  const SENTINEL = "#010203";
  return (css, fallback) => {
    if (!css || !css.trim()) return fallback;
    const hit = cache.get(css);
    if (hit) return hit;
    ctx.fillStyle = SENTINEL;
    ctx.fillStyle = css.trim();
    let rgba: Rgba = fallback;
    if (String(ctx.fillStyle) !== SENTINEL || css.trim().toLowerCase() === SENTINEL) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      // getImageData is un-premultiplied already.
      rgba = [r, g, b, a];
    }
    cache.set(css, rgba);
    return rgba;
  };
}

/** Uniform grid over item centres, for "what is on screen" in O(visible). */
class Grid {
  readonly cell: number;
  readonly columns: number;
  readonly rows: number;
  readonly starts: Uint32Array;
  readonly items: Uint32Array;

  constructor(
    xs: Float32Array,
    ys: Float32Array,
    count: number,
    width: number,
    height: number,
    cell: number,
  ) {
    this.cell = Math.max(1, cell);
    this.columns = Math.max(1, Math.ceil(width / this.cell));
    this.rows = Math.max(1, Math.ceil(height / this.cell));
    const cells = this.columns * this.rows;
    const counts = new Uint32Array(cells + 1);
    const cellOf = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) {
        cellOf[i] = cells;
        continue;
      }
      const cx = Math.min(this.columns - 1, Math.max(0, Math.floor(xs[i] / this.cell)));
      const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(ys[i] / this.cell)));
      cellOf[i] = cy * this.columns + cx;
      counts[cellOf[i] + 1]++;
    }
    for (let c = 0; c < cells; c++) counts[c + 1] += counts[c];
    this.starts = counts;
    this.items = new Uint32Array(counts[cells]);
    const cursor = counts.slice(0, cells);
    for (let i = 0; i < count; i++) {
      if (cellOf[i] < cells) this.items[cursor[cellOf[i]]++] = i;
    }
  }

  /** Items whose centre lies within the rectangle (plus the cell margin). */
  query(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    visit: (item: number) => boolean | void,
  ): void {
    const cx0 = Math.max(0, Math.floor(x0 / this.cell));
    const cy0 = Math.max(0, Math.floor(y0 / this.cell));
    const cx1 = Math.min(this.columns - 1, Math.floor(x1 / this.cell));
    const cy1 = Math.min(this.rows - 1, Math.floor(y1 / this.cell));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cy * this.columns + cx;
        for (let k = this.starts[c]; k < this.starts[c + 1]; k++) {
          if (visit(this.items[k]) === false) return;
        }
      }
    }
  }

  count(x0: number, y0: number, x1: number, y1: number): number {
    let total = 0;
    const cx0 = Math.max(0, Math.floor(x0 / this.cell));
    const cy0 = Math.max(0, Math.floor(y0 / this.cell));
    const cx1 = Math.min(this.columns - 1, Math.floor(x1 / this.cell));
    const cy1 = Math.min(this.rows - 1, Math.floor(y1 / this.cell));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cy * this.columns + cx;
        total += this.starts[c + 1] - this.starts[c];
      }
    }
    return total;
  }
}

interface Programs {
  edge: WebGLProgram;
  glyph: WebGLProgram;
  node: WebGLProgram;
}

export class DiagramRenderer {
  /** [alpha, focus, pulse, –] per node; written by the timeline. */
  readonly nodeState: Float32Array;
  /** [progress, –, focus, length] per edge; written by the timeline. */
  readonly edgeState: Float32Array;
  /** Spotlight strength, 0–1. */
  spotlight = 0;
  readonly element: HTMLDivElement;
  readonly target: ViewTarget;
  /** Called after every draw; the minimap follows the view through this. */
  onRendered: ((view: RenderedView) => void) | null = null;
  /** Step number per edge, when numbering is on. */
  private badges: (string | undefined)[] | null = null;
  private badgeGrid: Grid | null = null;

  private readonly scene: Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: HTMLCanvasElement;
  private readonly text: CanvasRenderingContext2D;
  private gl: WebGL2RenderingContext;
  private programs!: Programs;
  private vaos: {
    edge: WebGLVertexArrayObject;
    glyph: WebGLVertexArrayObject;
    node: WebGLVertexArrayObject;
  } | null = null;
  private nodeTexture: WebGLTexture | null = null;
  private edgeTexture: WebGLTexture | null = null;
  private segmentCount = 0;
  private glyphCount = 0;
  private frame: Frame;
  private raf = 0;
  private stateDirty = true;
  private lost = false;
  private destroyed = false;
  private readonly resize: ResizeObserver;
  private readonly nodeGrid: Grid;
  private readonly labelGrid: Grid;
  private readonly maxNodeHalf: number;
  private readonly colors: {
    nodeText: string;
    labelText: string;
    labelBackground: string;
    line: Rgba;
    accent: Rgba;
    nodeFill: Rgba;
    nodeStroke: Rgba;
  };
  private readonly theme: DiagramTheme;
  private readonly options: RendererOptions;
  private readonly parse: ReturnType<typeof colorParser>;

  constructor(host: HTMLElement, scene: Scene, theme: DiagramTheme, options: RendererOptions) {
    this.scene = scene;
    this.theme = theme;
    this.options = options;
    this.frame = { x: 0, y: 0, width: scene.width, height: scene.height };

    this.element = document.createElement("div");
    this.element.style.cssText = "position:relative;width:100%;height:100%;";
    this.element.dataset.gpuDiagram = "";
    this.canvas = document.createElement("canvas");
    this.overlay = document.createElement("canvas");
    for (const canvas of [this.canvas, this.overlay]) {
      canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
      this.element.appendChild(canvas);
    }
    this.overlay.style.pointerEvents = "none";
    host.appendChild(this.element);

    const gl = this.canvas.getContext("webgl2", {
      antialias: true,
      premultipliedAlpha: true,
      alpha: true,
    });
    const text = this.overlay.getContext("2d");
    if (!gl || !text) {
      this.element.remove();
      throw new Error("This browser cannot draw large diagrams (WebGL2 is unavailable).");
    }
    this.gl = gl;
    this.text = text;

    const rows = (count: number) => Math.max(1, Math.ceil(count / STATE_WIDTH));
    this.nodeState = new Float32Array(STATE_WIDTH * rows(scene.nodeCount) * 4);
    this.edgeState = new Float32Array(STATE_WIDTH * rows(scene.edgeCount) * 4);
    for (let e = 0; e < scene.edgeCount; e++) this.edgeState[e * 4 + 3] = scene.edgeLength[e];

    this.parse = colorParser();
    this.colors = {
      nodeText: theme.nodeText,
      labelText: theme.labelText,
      labelBackground: theme.labelBackground,
      line: this.parse(theme.line, [51, 51, 51, 255]),
      accent: this.parse(theme.accent, [99, 102, 241, 255]),
      nodeFill: this.parse(theme.nodeFill, [236, 236, 255, 255]),
      nodeStroke: this.parse(theme.nodeStroke, [147, 112, 219, 255]),
    };

    let widest = 0;
    let sumSize = 0;
    for (let i = 0; i < scene.nodeCount; i++) {
      widest = Math.max(widest, scene.nodeW[i], scene.nodeH[i]);
      sumSize += scene.nodeW[i];
    }
    this.maxNodeHalf = widest / 2;
    const cell = Math.max(200, (sumSize / Math.max(1, scene.nodeCount)) * 3);
    this.nodeGrid = new Grid(
      scene.nodeX,
      scene.nodeY,
      scene.nodeCount,
      scene.width,
      scene.height,
      cell,
    );
    this.labelGrid = new Grid(
      scene.labelX,
      scene.labelY,
      scene.edgeCount,
      scene.width,
      scene.height,
      cell,
    );

    this.init();

    this.canvas.addEventListener("webglcontextlost", this.onLost);
    this.canvas.addEventListener("webglcontextrestored", this.onRestored);
    this.resize = new ResizeObserver(() => this.render());
    this.resize.observe(this.element);

    const currentFrame = () => this.frame;
    this.target = {
      viewBox: {
        get baseVal() {
          return currentFrame();
        },
      },
      setAttribute: (_name, value) => {
        const [x, y, width, height] = value.split(/[\s,]+/).map(Number);
        this.setFrame({ x, y, width, height });
      },
      getBoundingClientRect: () => this.element.getBoundingClientRect(),
    };
  }

  /** Every node and edge fully drawn: the static picture. */
  showAll(): void {
    for (let i = 0; i < this.scene.nodeCount; i++) {
      this.nodeState[i * 4] = 1;
      this.nodeState[i * 4 + 1] = 0;
      this.nodeState[i * 4 + 2] = 0;
    }
    for (let e = 0; e < this.scene.edgeCount; e++) {
      this.edgeState[e * 4] = 1;
      this.edgeState[e * 4 + 2] = 0;
    }
    this.spotlight = 0;
    this.markState();
  }

  /**
   * Which node (by index, not a string id — the caller maps that through
   * `Scene.nodeIndex`) sits under a client-space point, or `null`.
   *
   * Mirrors the client → diagram-space conversion `render()` already does
   * for letterboxing (`renderer.ts:648-661`), then an axis-aligned box test
   * against the node's own width/height. Not exact for a diamond or
   * ellipse's corners — close enough for a click target, the same way the
   * SVG path's own click handling is "whichever element the browser hit,"
   * not an analytically precise shape test.
   */
  hitTest(clientX: number, clientY: number): number | null {
    const rect = this.element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    const { frame } = this;
    const scale = Math.min(width / frame.width, height / frame.height);
    const offsetX = (width - frame.width * scale) / 2;
    const offsetY = (height - frame.height * scale) / 2;
    const x = frame.x + ((clientX - rect.left) * dpr - offsetX) / scale;
    const y = frame.y + ((clientY - rect.top) * dpr - offsetY) / scale;

    let best: number | null = null;
    let bestArea = Infinity;
    const pad = this.maxNodeHalf;
    this.nodeGrid.query(x - pad, y - pad, x + pad, y + pad, (i) => {
      if (this.nodeState[i * 4] <= 0) return; // a hidden node isn't a click target
      const hw = this.scene.nodeW[i] / 2;
      const hh = this.scene.nodeH[i] / 2;
      if (Math.abs(x - this.scene.nodeX[i]) > hw || Math.abs(y - this.scene.nodeY[i]) > hh) return;
      // Smallest containing box wins, so a small node nested near a large
      // one's corner is still reachable.
      const area = this.scene.nodeW[i] * this.scene.nodeH[i];
      if (area < bestArea) {
        bestArea = area;
        best = i;
      }
    });
    return best;
  }

  /** Show these step numbers on the arrows (index = edge), or none. */
  setBadges(numbers: (string | undefined)[] | null): void {
    this.badges = numbers;
    const { scene } = this;
    this.badgeGrid =
      numbers && !this.badgeGrid
        ? new Grid(
            scene.badgeX,
            scene.badgeY,
            scene.edgeCount,
            scene.width,
            scene.height,
            this.nodeGrid.cell,
          )
        : this.badgeGrid;
    this.invalidate();
  }

  /** The timeline wrote new state; upload it with the next frame. */
  markState(): void {
    this.stateDirty = true;
    this.invalidate();
  }

  setFrame(frame: Frame): void {
    if (![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)) return;
    if (frame.width <= 0 || frame.height <= 0) return;
    this.frame = frame;
    this.invalidate();
  }

  /** Draw on the next animation frame, once, however often this is called. */
  invalidate(): void {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  /** Draw now, and cancel any frame already scheduled. */
  render(): void {
    if (this.destroyed || this.lost) return;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    const dpr = window.devicePixelRatio || 1;
    const rect = this.element.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = this.overlay.width = width;
      this.canvas.height = this.overlay.height = height;
    }

    // `meet` letterboxing, exactly as the viewport assumes for an <svg>.
    const { frame } = this;
    const scale = Math.min(width / frame.width, height / frame.height);
    const offsetX = (width - frame.width * scale) / 2;
    const offsetY = (height - frame.height * scale) / 2;

    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    if (this.stateDirty) {
      this.upload(this.nodeTexture!, this.nodeState);
      this.upload(this.edgeTexture!, this.edgeState);
      this.stateDirty = false;
    }

    const line = this.colors.line;
    const setCommon = (program: WebGLProgram, texture: WebGLTexture) => {
      gl.useProgram(program);
      gl.uniform4f(gl.getUniformLocation(program, "u_view"), frame.x, frame.y, scale, dpr);
      gl.uniform4f(gl.getUniformLocation(program, "u_viewport"), offsetX, offsetY, width, height);
      gl.uniform1f(gl.getUniformLocation(program, "u_spot"), this.spotlight);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(gl.getUniformLocation(program, "u_state"), 0);
    };

    const vaos = this.vaos!;
    setCommon(this.programs.edge, this.edgeTexture!);
    gl.uniform4f(
      gl.getUniformLocation(this.programs.edge, "u_color"),
      line[0] / 255,
      line[1] / 255,
      line[2] / 255,
      line[3] / 255,
    );
    gl.bindVertexArray(vaos.edge);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.segmentCount);

    setCommon(this.programs.glyph, this.edgeTexture!);
    gl.uniform4f(
      gl.getUniformLocation(this.programs.glyph, "u_color"),
      line[0] / 255,
      line[1] / 255,
      line[2] / 255,
      line[3] / 255,
    );
    gl.bindVertexArray(vaos.glyph);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, this.glyphCount);

    setCommon(this.programs.node, this.nodeTexture!);
    const accent = this.colors.accent;
    gl.uniform4f(
      gl.getUniformLocation(this.programs.node, "u_accent"),
      accent[0] / 255,
      accent[1] / 255,
      accent[2] / 255,
      accent[3] / 255,
    );
    gl.bindVertexArray(vaos.node);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.scene.nodeCount);
    gl.bindVertexArray(null);

    this.drawText(scale, offsetX, offsetY, width, height, dpr);
    this.drawPinnedLabels(scale, offsetX, offsetY, dpr);
    this.onRendered?.({
      frame,
      visible: {
        x: frame.x - offsetX / scale,
        y: frame.y - offsetY / scale,
        width: width / scale,
        height: height / scale,
      },
    });
  }

  destroy(): void {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    // Hand the GPU memory back now rather than whenever the context is GC'd.
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.element.remove();
  }

  // -- setup -------------------------------------------------------------------

  private onLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
  };

  private onRestored = () => {
    this.lost = false;
    this.init();
    this.stateDirty = true;
    this.render();
  };

  private init(): void {
    const gl = this.gl;
    this.programs = {
      edge: compile(gl, EDGE_VS, EDGE_FS),
      glyph: compile(gl, GLYPH_VS, GLYPH_FS),
      node: compile(gl, NODE_VS, NODE_FS),
    };
    this.nodeTexture = this.createStateTexture(this.nodeState);
    this.edgeTexture = this.createStateTexture(this.edgeState);
    this.vaos = {
      edge: this.buildEdges(),
      glyph: this.buildGlyphs(),
      node: this.buildNodes(),
    };
  }

  private createStateTexture(data: Float32Array): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      STATE_WIDTH,
      data.length / 4 / STATE_WIDTH,
      0,
      gl.RGBA,
      gl.FLOAT,
      data,
    );
    return texture;
  }

  private upload(texture: WebGLTexture, data: Float32Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      STATE_WIDTH,
      data.length / 4 / STATE_WIDTH,
      gl.RGBA,
      gl.FLOAT,
      data,
    );
  }

  private attribute(
    program: WebGLProgram,
    name: string,
    data: ArrayBufferView,
    size: number,
    divisor: number,
    type: number = this.gl.FLOAT,
    normalized = false,
  ): void {
    const gl = this.gl;
    const location = gl.getAttribLocation(program, name);
    if (location < 0) return;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, type, normalized, 0, 0);
    gl.vertexAttribDivisor(location, divisor);
  }

  private buildEdges(): WebGLVertexArrayObject {
    const gl = this.gl;
    const { scene } = this;
    const program = this.programs.edge;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    let segments = 0;
    for (let e = 0; e < scene.edgeCount; e++) {
      segments += Math.max(0, scene.pointOffsets[e + 1] - scene.pointOffsets[e] - 1);
    }
    const markerCount = scene.markerSegments.length / 5;
    segments += markerCount;
    const seg = new Float32Array(segments * 4);
    const meta = new Float32Array(segments * 4);
    let k = 0;
    for (let e = 0; e < scene.edgeCount; e++) {
      const from = scene.pointOffsets[e];
      const to = scene.pointOffsets[e + 1];
      for (let p = from; p < to - 1; p++) {
        seg.set(
          [
            scene.points[p * 2],
            scene.points[p * 2 + 1],
            scene.points[p * 2 + 2],
            scene.points[p * 2 + 3],
          ],
          k * 4,
        );
        const flags = (p === from ? 4 : 0) + (p === to - 2 ? 8 : 0);
        meta.set(
          [scene.pointDistance[p], scene.pointDistance[p + 1], e, scene.edgeStroke[e] + flags],
          k * 4,
        );
        k++;
      }
    }
    // Marker strokes (crow's feet, open arrows, hollow triangles) ride the same
    // pipeline, placed at the very end of their edge so they appear only once
    // it has landed, and always solid, never dashed.
    const markers = scene.markerSegments;
    for (let m = 0; m < markerCount; m++) {
      const e = markers[m * 5 + 4];
      const at = scene.edgeLength[e] * 0.999;
      seg.set(markers.subarray(m * 5, m * 5 + 4), k * 4);
      meta.set([at, at, e, 0], k * 4);
      k++;
    }
    this.segmentCount = segments;
    this.attribute(program, "a_corner", new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), 2, 0);
    this.attribute(program, "a_seg", seg, 4, 1);
    this.attribute(program, "a_meta", meta, 4, 1);
    gl.bindVertexArray(null);
    return vao;
  }

  private buildGlyphs(): WebGLVertexArrayObject {
    const gl = this.gl;
    const program = this.programs.glyph;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const source = this.scene.markerTriangles;
    const count = source.length / 7;
    const ab = new Float32Array(count * 4);
    const c = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      ab.set(source.subarray(i * 7, i * 7 + 4), i * 4);
      c.set(source.subarray(i * 7 + 4, i * 7 + 7), i * 3);
    }
    this.glyphCount = count;
    this.attribute(program, "a_ab", ab, 4, 1);
    this.attribute(program, "a_c", c, 3, 1);
    gl.bindVertexArray(null);
    return vao;
  }

  private buildNodes(): WebGLVertexArrayObject {
    const gl = this.gl;
    const { scene, colors, parse } = this;
    const program = this.programs.node;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const n = scene.nodeCount;
    const rect = new Float32Array(n * 4);
    const meta = new Float32Array(n * 2);
    const fill = new Uint8Array(n * 4);
    const stroke = new Uint8Array(n * 4);
    const clear: Rgba = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      rect.set([scene.nodeX[i], scene.nodeY[i], scene.nodeW[i], scene.nodeH[i]], i * 4);
      meta.set([scene.nodeShape[i], i], i * 2);
      fill.set(this.options.lineArt ? clear : parse(scene.nodeFill[i], colors.nodeFill), i * 4);
      stroke.set(parse(scene.nodeStroke[i], colors.nodeStroke), i * 4);
    }
    this.attribute(program, "a_corner", new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2, 0);
    this.attribute(program, "a_rect", rect, 4, 1);
    this.attribute(program, "a_nmeta", meta, 2, 1);
    this.attribute(program, "a_fill", fill, 4, 1, gl.UNSIGNED_BYTE, true);
    this.attribute(program, "a_stroke", stroke, 4, 1, gl.UNSIGNED_BYTE, true);
    gl.bindVertexArray(null);
    return vao;
  }

  // -- text --------------------------------------------------------------------

  /**
   * Names for the spotlit nodes when their own labels are too small to read.
   *
   * To show a whole long connection the camera may pull far back, where every
   * box is a few pixels wide. The nodes being explained still carry their
   * names, in a small tag beside the box, so a zoomed-out beat reads as
   * "this connects to that" rather than as two highlighted dots.
   */
  private drawPinnedLabels(scale: number, offsetX: number, offsetY: number, dpr: number): void {
    if (this.spotlight <= 0) return;
    if (FONT_SIZE * scale >= MIN_TEXT_PX * 2.2 * dpr) return;
    const { scene, frame } = this;
    const ctx = this.text;
    const px = 11 * dpr;
    ctx.font = `600 ${px}px ${FONT_STACK}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    let drawn = 0;
    for (let i = 0; i < scene.nodeCount && drawn < MAX_PINNED; i++) {
      const focus = this.nodeState[i * 4 + 1];
      const alpha = this.nodeState[i * 4];
      if (focus < 0.5 || alpha <= 0.05) continue;
      const name = scene.nodeTable[i]?.header.at(-1) ?? scene.nodeLines[i].join(" ");
      if (!name) continue;
      const x = (scene.nodeX[i] + scene.nodeW[i] / 2 - frame.x) * scale + offsetX + 6 * dpr;
      const y = (scene.nodeY[i] - frame.y) * scale + offsetY;
      const w = ctx.measureText(name).width + 12 * dpr;
      const h = px + 8 * dpr;
      ctx.globalAlpha = Math.min(alpha, focus) * this.spotlight;
      ctx.fillStyle = this.theme.accent;
      ctx.beginPath();
      ctx.roundRect(x, y - h / 2, w, h, 4 * dpr);
      ctx.fill();
      ctx.fillStyle = this.theme.accentText;
      ctx.fillText(name, x + 6 * dpr, y + 0.5 * dpr);
      drawn++;
    }
    ctx.globalAlpha = 1;
  }

  /**
   * An ER entity or a class as a table: the title centred and bold, a rule
   * under it and between compartments, and each row's cells in columns.
   * Returns how many text runs it drew, against the frame's text budget.
   */
  private drawTable(
    node: number,
    table: TableLayout,
    scale: number,
    toX: (x: number) => number,
    toY: (y: number) => number,
    fontPx: number,
    fillWith: (color: string) => void,
  ): number {
    const ctx = this.text;
    const { scene } = this;
    const left = toX(scene.nodeX[node] - scene.nodeW[node] / 2);
    const top = toY(scene.nodeY[node] - scene.nodeH[node] / 2);
    const width = scene.nodeW[node] * scale;
    const lineHeight = LINE_HEIGHT * scale;
    let runs = 0;

    ctx.font = `600 ${fontPx}px ${FONT_STACK}`;
    ctx.textAlign = "center";
    const headerTop = top + (table.headerHeight * scale - table.header.length * lineHeight) / 2;
    table.header.forEach((line, l) => {
      ctx.fillText(line, left + width / 2, headerTop + (l + 0.5) * lineHeight);
      runs++;
    });

    const rule = scene.nodeStroke[node] ?? this.theme.nodeStroke;
    ctx.strokeStyle = rule;
    ctx.lineWidth = Math.max(1, scale);
    ctx.beginPath();
    for (const sectionTop of table.sectionTops) {
      const y = top + sectionTop * scale;
      ctx.moveTo(left, y);
      ctx.lineTo(left + width, y);
    }
    ctx.stroke();

    ctx.font = `${fontPx}px ${FONT_STACK}`;
    ctx.textAlign = "left";
    const rowHeight = ROW_HEIGHT * scale;
    table.sections.forEach((rows, s) => {
      const sectionTop = top + (table.sectionTops[s] + 3) * scale;
      rows.forEach((cells, r) => {
        const y = sectionTop + (r + 0.5) * rowHeight;
        cells.forEach((cell, c) => {
          if (!cell) return;
          ctx.fillText(cell, left + table.columns[c] * scale, y);
          runs++;
        });
      });
    });
    return runs;
  }

  private drawText(
    scale: number,
    offsetX: number,
    offsetY: number,
    width: number,
    height: number,
    dpr: number,
  ): void {
    const ctx = this.text;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const fontPx = FONT_SIZE * scale;
    if (fontPx < MIN_TEXT_PX * dpr) return;

    const { scene, frame } = this;
    // The diagram-space rectangle the whole canvas shows, letterbox included.
    const left = frame.x - offsetX / scale;
    const top = frame.y - offsetY / scale;
    const right = left + width / scale;
    const bottom = top + height / scale;
    const margin = this.maxNodeHalf;
    const x0 = left - margin;
    const y0 = top - margin;
    const x1 = right + margin;
    const y1 = bottom + margin;
    if (
      this.nodeGrid.count(x0, y0, x1, y1) + this.labelGrid.count(x0, y0, x1, y1) >
      MAX_TEXT_ITEMS * 4
    )
      return;

    const toX = (x: number) => (x - frame.x) * scale + offsetX;
    const toY = (y: number) => (y - frame.y) * scale + offsetY;
    const lineHeight = LINE_HEIGHT * scale;
    const spot = this.spotlight;
    const font = `${fontPx}px ${FONT_STACK}`;
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    let drawn = 0;
    let lastFill = "";
    const fillWith = (color: string) => {
      if (color !== lastFill) {
        ctx.fillStyle = color;
        lastFill = color;
      }
    };

    // Edge labels first, so a node's own text is never under one.
    this.labelGrid.query(x0, y0, x1, y1, (e) => {
      const lines = scene.edgeLines[e];
      if (!lines.length) return;
      const progress = this.edgeState[e * 4];
      const amount = Math.min(1, Math.max(0, (progress - 0.5) * 2));
      if (amount <= 0.01) return;
      const dim = 1 + (DIM_NODE + (1 - DIM_NODE) * this.edgeState[e * 4 + 2] - 1) * spot;
      const cx = toX(scene.labelX[e]);
      const cy = toY(scene.labelY[e]);
      ctx.globalAlpha = amount * dim;
      if (!this.options.lineArt) {
        fillWith(this.colors.labelBackground);
        const w = scene.labelW[e] * scale;
        const h = scene.labelH[e] * scale;
        ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
      }
      fillWith(this.colors.labelText);
      const first = cy - ((lines.length - 1) * lineHeight) / 2;
      for (let l = 0; l < lines.length; l++) ctx.fillText(lines[l], cx, first + l * lineHeight);
      return ++drawn < MAX_TEXT_ITEMS;
    });

    this.nodeGrid.query(x0, y0, x1, y1, (i) => {
      const alpha = this.nodeState[i * 4];
      if (alpha <= 0.01) return;
      const pulse = this.nodeState[i * 4 + 2];
      const dim = 1 + (DIM_NODE + (1 - DIM_NODE) * this.nodeState[i * 4 + 1] - 1) * spot;
      ctx.globalAlpha = alpha * dim * (pulse > 0 ? 1 - 0.45 * Math.sin(Math.PI * pulse) : 1);
      fillWith(scene.nodeColor[i] ?? this.colors.nodeText);
      const table = scene.nodeTable[i];
      if (table) {
        drawn += this.drawTable(i, table, scale, toX, toY, fontPx, fillWith);
        ctx.font = font;
        ctx.textAlign = "center";
        return drawn < MAX_TEXT_ITEMS * 2;
      }
      const lines = scene.nodeLines[i];
      const cx = toX(scene.nodeX[i]);
      const cy = toY(scene.nodeY[i]);
      const first = cy - ((lines.length - 1) * lineHeight) / 2;
      for (let l = 0; l < lines.length; l++) ctx.fillText(lines[l], cx, first + l * lineHeight);
      return ++drawn < MAX_TEXT_ITEMS * 2;
    });

    const { badges, badgeGrid } = this;
    const badgePx = BADGE_FONT * scale;
    if (badges && badgeGrid && badgePx >= MIN_TEXT_PX * dpr) {
      ctx.font = `600 ${badgePx}px ui-sans-serif, system-ui, sans-serif`;
      const h = badgePx * 1.8;
      badgeGrid.query(left, top, right, bottom, (e) => {
        const number = badges[e];
        if (!number || this.edgeState[e * 4] < BADGE_SHOWN) return;
        const dim = 1 + (0.4 + 0.6 * this.edgeState[e * 4 + 2] - 1) * spot;
        const w = Math.max(h, badgePx * (0.65 * number.length + 0.9));
        const cx = toX(scene.badgeX[e]);
        const cy = toY(scene.badgeY[e]);
        ctx.globalAlpha = dim;
        fillWith(this.theme.accent);
        ctx.beginPath();
        ctx.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2);
        ctx.fill();
        fillWith(this.theme.accentText);
        ctx.fillText(number, cx, cy + badgePx * 0.05);
        return ++drawn < MAX_TEXT_ITEMS * 3;
      });
    }
    ctx.globalAlpha = 1;
  }
}
