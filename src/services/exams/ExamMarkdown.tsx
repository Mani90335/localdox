import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { z } from "zod";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { withMermaid } from "../diagrams/mermaid-runtime";
import { Zoomable } from "./ui/kit";
import "katex/dist/katex.min.css";

/* ── Assets: images that travel with an exam or practice set ─────────────── */

export interface AssetSource {
  /** Imported files, stored as Blobs. */
  assets?: Record<string, Blob>;
  /** Bundled files, already served as URLs. */
  assetUrls?: Record<string, string>;
}
/** A file's URL; undefined when there is none, null while URLs are still being made. */
const AssetContext = createContext<(name: string) => string | undefined | null>(() => undefined);
const basename = (path: string) => decodeURIComponent(path.split(/[\\/]/).at(-1) ?? path);
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};
/** Browsers only draw an SVG blob with its MIME type; infer it from the name if missing. */
function typed(name: string, blob: Blob): Blob {
  const type = IMAGE_TYPES[name.split(".").pop()?.toLowerCase() ?? ""];
  return blob.type || !type ? blob : new Blob([blob], { type });
}

/** Makes a record's images resolvable by file name for everything inside. */
export function ExamAssets({ source, children }: { source?: AssetSource; children: ReactNode }) {
  // Null until the first URLs exist: object URLs are made in an effect, and a
  // first paint saying "not available" for an image that is about to appear
  // reads as an error.
  const [urls, setUrls] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    const created = Object.fromEntries(
      Object.entries(source?.assets ?? {}).map(([name, blob]) => [
        name,
        URL.createObjectURL(typed(name, blob)),
      ]),
    );
    setUrls({ ...(source?.assetUrls ?? {}), ...created });
    return () => Object.values(created).forEach((url) => URL.revokeObjectURL(url));
  }, [source]);
  const resolve = useMemo(() => (name: string) => (urls ? urls[basename(name)] : null), [urls]);
  return <AssetContext.Provider value={resolve}>{children}</AssetContext.Provider>;
}

/**
 * Only three kinds of image source are shown: a file shipped with the exam,
 * an inline raster/SVG data URI, or HTTPS. Anything else is not loaded.
 * Images render through <img>, so an SVG can never run script.
 */
function ExamImage({ src, alt }: { src?: string; alt?: string }) {
  const resolve = useContext(AssetContext),
    label = alt?.trim() || "image";
  const shipped = src ? resolve(src) : undefined;
  const url =
    shipped ??
    (src && (/^https:\/\//i.test(src) || /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(src))
      ? src
      : undefined);
  if (!url && shipped === null)
    return <span className="ex-media-pending" role="img" aria-label={label} aria-busy="true" />;
  if (!url)
    return (
      <span className="ex-media-missing" role="img" aria-label={label}>
        Image not available: {label}
      </span>
    );
  return (
    <Zoomable label={label}>
      <img src={url} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" />
    </Zoomable>
  );
}

/* ── Diagrams: static, chrome-free, strict Mermaid ───────────────────────── */

function useDark() {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const root = document.documentElement,
      observer = new MutationObserver(() => setDark(root.classList.contains("dark")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}
let diagramCount = 0;
/**
 * Exam content comes from files someone else wrote, so diagrams render with
 * Mermaid's strict security level (sanitised labels, no click handlers) and
 * none of the reader's animation controls. Click to enlarge.
 */
/** Rendered SVG by theme + source, so a diagram seen before draws instantly. */
const svgCache = new Map<string, string>();
function ExamDiagram({ code }: { code: string }) {
  const dark = useDark(),
    key = `${dark ? "d" : "l"}:${code}`,
    [state, setState] = useState<{ key?: string; svg?: string; error?: string }>(() => ({
      key,
      svg: svgCache.get(key),
    }));
  useEffect(() => {
    if (svgCache.has(key)) {
      setState((s) => (s.key === key && s.svg ? s : { key, svg: svgCache.get(key) }));
      return;
    }
    let alive = true;
    const id = `exam-diagram-${++diagramCount}`;
    withMermaid(
      async (mermaid) => {
        try {
          return (await mermaid.render(id, code)).svg;
        } finally {
          document.getElementById(id)?.remove();
          document.getElementById(`d${id}`)?.remove();
        }
      },
      {
        label: "exam-render",
        config: {
          securityLevel: "strict",
          theme: dark ? "dark" : "neutral",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          flowchart: { useMaxWidth: true },
        },
      },
    ).then(
      (svg) => {
        if (svgCache.size > 200) svgCache.clear();
        svgCache.set(key, svg);
        if (alive) setState({ key, svg });
      },
      (error: unknown) =>
        alive && setState({ key, error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      alive = false;
    };
  }, [code, dark, key]);
  if (state.error)
    return (
      <div className="ex-media-missing" role="note">
        This diagram couldn't be drawn.
        <pre className="exam-code">{code}</pre>
      </div>
    );
  if (!state.svg) return <div className="ex-diagram is-loading" aria-label="Loading diagram" />;
  const figure = <div className="ex-diagram" dangerouslySetInnerHTML={{ __html: state.svg }} />;
  return <Zoomable label="diagram">{figure}</Zoomable>;
}

/* ── Charts ──────────────────────────────────────────────────────────────── */

const chartSchema = z
  .object({
    type: z.enum(["bar", "line", "scatter", "pie"]),
    title: z.string().max(200).optional(),
    data: z
      .array(z.record(z.union([z.string(), z.number().finite(), z.null()])))
      .min(1)
      .max(2000),
    series: z
      .array(
        z.union([
          z.string(),
          z
            .object({
              key: z.string(),
              name: z.string().optional(),
              color: z
                .string()
                .regex(/^#[0-9a-fA-F]{3,8}$/)
                .optional(),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(12),
    xKey: z.string(),
  })
  .strict();
// Validated categorical order (blue, orange, aqua, …); resolved per theme in CSS.
const SERIES = Array.from({ length: 8 }, (_, i) => `var(--ex-series-${i + 1})`);
const axis = { fontSize: 12, fill: "var(--ex-text-2)" };
function MarkdownChart({ source }: { source: string }) {
  let spec: z.infer<typeof chartSchema>;
  try {
    spec = chartSchema.parse(JSON.parse(source));
    for (const item of spec.series) {
      const key = typeof item === "string" ? item : item.key;
      if (spec.data.some((row) => typeof row[key] !== "number"))
        throw new Error(`Series ${key} requires numeric values`);
    }
    if (spec.data.some((row) => !(spec.xKey in row))) throw new Error("xKey is missing from data");
    if (spec.type === "scatter" && spec.data.some((row) => typeof row[spec.xKey] !== "number"))
      throw new Error("Scatter xKey requires numeric values");
  } catch (error) {
    return (
      <div className="ex-media-missing" role="note">
        This chart couldn't be drawn ({error instanceof Error ? error.message : "invalid JSON"}).
      </div>
    );
  }
  const series = spec.series.map((s, i) =>
    typeof s === "string"
      ? { key: s, name: s, color: SERIES[i % SERIES.length] }
      : { ...s, name: s.name ?? s.key, color: s.color ?? SERIES[i % SERIES.length] },
  );
  const many = series.length > 1;
  const grid = <CartesianGrid stroke="var(--ex-hairline)" vertical={false} />;
  const x = (
    <XAxis
      dataKey={spec.xKey}
      tick={axis}
      tickLine={false}
      axisLine={{ stroke: "var(--ex-hairline)" }}
    />
  );
  const y = <YAxis tick={axis} tickLine={false} axisLine={false} width={40} />;
  const tip = (
    <Tooltip
      contentStyle={{
        background: "var(--ex-surface)",
        border: "1px solid var(--ex-hairline)",
        borderRadius: 8,
        color: "var(--ex-text)",
      }}
      cursor={{ fill: "var(--ex-subtle)" }}
    />
  );
  const legend = many ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null;
  return (
    <figure className="exam-chart" role="img" aria-label={spec.title ?? `${spec.type} chart`}>
      {spec.title && <figcaption>{spec.title}</figcaption>}
      <ResponsiveContainer width="100%" height={240}>
        {spec.type === "pie" ? (
          <PieChart>
            <Pie
              isAnimationActive={false}
              data={spec.data}
              dataKey={series[0].key}
              nameKey={spec.xKey}
              stroke="var(--ex-surface)"
              strokeWidth={2}
              label={{ fontSize: 12, fill: "var(--ex-text-2)" }}
            >
              {spec.data.map((_, i) => (
                <Cell key={i} fill={SERIES[i % SERIES.length]} />
              ))}
            </Pie>
            {tip}
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        ) : spec.type === "scatter" ? (
          <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--ex-hairline)" />
            <XAxis dataKey="x" type="number" name={spec.xKey} tick={axis} tickLine={false} />
            <YAxis dataKey="y" type="number" tick={axis} tickLine={false} width={40} />
            {tip}
            {legend}
            {series.map((s) => (
              <Scatter
                isAnimationActive={false}
                key={s.key}
                name={s.name}
                data={spec.data.map((row) => ({ x: row[spec.xKey], y: row[s.key] }))}
                fill={s.color}
              />
            ))}
          </ScatterChart>
        ) : spec.type === "line" ? (
          <LineChart data={spec.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            {grid}
            {x}
            {y}
            {tip}
            {legend}
            {series.map((s) => (
              <Line
                isAnimationActive={false}
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                dot={{ r: 3, fill: s.color }}
              />
            ))}
          </LineChart>
        ) : (
          <BarChart data={spec.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            {grid}
            {x}
            {y}
            {tip}
            {legend}
            {series.map((s) => (
              <Bar
                isAnimationActive={false}
                key={s.key}
                dataKey={s.key}
                name={s.name}
                fill={s.color}
                radius={[4, 4, 0, 0]}
                maxBarSize={56}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </figure>
  );
}

/* ── Markdown ────────────────────────────────────────────────────────────── */

type HastNode = { tagName?: string; properties?: { className?: unknown }; children?: HastNode[] };
/** The fence language of a <pre><code class="language-x">, if any. */
function fenceLanguage(node?: HastNode): string | undefined {
  const code = node?.children?.find((c) => c.tagName === "code");
  const classes = code?.properties?.className;
  const list = Array.isArray(classes) ? classes : [];
  return list
    .map(String)
    .find((c) => c.startsWith("language-"))
    ?.slice("language-".length);
}
const VISUAL = new Set(["mermaid", "chart"]);

// Module-level and stable. Inline renderers would be new component types on
// every render, so React would remount every diagram and chart each time the
// exam clock ticks (twice a second): that was the flicker.
const COMPONENTS: Components = {
  pre: ({ node, children }) =>
    VISUAL.has(fenceLanguage(node as HastNode) ?? "") ? (
      <>{children}</>
    ) : (
      <pre className="exam-code">{children}</pre>
    ),
  code: ({ className, children, node: _node, ...props }) => {
    const raw = String(children).replace(/\n$/, "");
    if (className === "language-mermaid") return <ExamDiagram code={raw} />;
    if (className === "language-chart") return <MarkdownChart source={raw} />;
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  a: ({ children }) => <span>{children}</span>,
  img: ({ src, alt }) => <ExamImage src={typeof src === "string" ? src : undefined} alt={alt} />,
};
const REMARK = [remarkGfm, remarkMath];
const REHYPE: NonNullable<Parameters<typeof ReactMarkdown>[0]["rehypePlugins"]> = [
  [rehypeKatex, { trust: false, strict: false }],
];
const urlTransform = (url: string, key: string) =>
  key === "src" && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(url)
    ? url
    : defaultUrlTransform(url);

/**
 * Restricted renderer for exam questions, options and solutions. Executable
 * or interactive fences stay inert text. Diagrams and charts render outside
 * the code container so they get the full column and no monospace styling.
 * Memoised by source: re-rendering the exam around it never touches it.
 */
export const ExamMarkdown = memo(function ExamMarkdown({ source }: { source: string }) {
  return (
    <div className="docs-prose exam-markdown">
      <ReactMarkdown
        remarkPlugins={REMARK}
        rehypePlugins={REHYPE}
        urlTransform={urlTransform}
        components={COMPONENTS}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
