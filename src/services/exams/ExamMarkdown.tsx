import ReactMarkdown from "react-markdown";
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
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { MermaidBlock } from "../diagrams/MermaidLazy";
import "katex/dist/katex.min.css";
const chartSchema = z
  .object({
    type: z.enum(["bar", "line", "scatter", "pie"]),
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
const colors = ["#3b82f6", "#a855f7", "#059669", "#ea580c"];
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
      <p role="alert" className="exam-error">
        Invalid chart: {error instanceof Error ? error.message : "Invalid JSON"}
      </p>
    );
  }
  const series = spec.series.map((s, i) =>
    typeof s === "string"
      ? { key: s, name: s, color: colors[i % colors.length] }
      : { ...s, color: s.color ?? colors[i % colors.length] },
  );
  return (
    <div className="exam-chart" role="img" aria-label={`${spec.type} chart`}>
      <ResponsiveContainer width="100%" height={260}>
        {spec.type === "pie" ? (
          <PieChart>
            <Pie
              isAnimationActive={false}
              data={spec.data}
              dataKey={series[0].key}
              nameKey={spec.xKey}
              fill={series[0].color}
              label
            />
            <Tooltip />
          </PieChart>
        ) : spec.type === "scatter" ? (
          <ScatterChart>
            <CartesianGrid />
            <XAxis dataKey="x" type="number" name={spec.xKey} />
            <YAxis dataKey="y" type="number" />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} />
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
          <LineChart data={spec.data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={spec.xKey} />
            <YAxis />
            <Tooltip />
            {series.map((s) => (
              <Line
                isAnimationActive={false}
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
              />
            ))}
          </LineChart>
        ) : (
          <BarChart data={spec.data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={spec.xKey} />
            <YAxis />
            <Tooltip />
            {series.map((s) => (
              <Bar
                isAnimationActive={false}
                key={s.key}
                dataKey={s.key}
                name={s.name}
                fill={s.color}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
/** Restricted renderer: executable/interactive fences remain inert text. */
export function ExamMarkdown({ source }: { source: string }) {
  return (
    <div className="docs-prose exam-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { trust: false, strict: false }]]}
        components={{
          pre: ({ children }) => <div className="exam-code">{children}</div>,
          code: ({ className, children, ...props }) => {
            const raw = String(children).replace(/\n$/, "");
            if (className === "language-mermaid") return <MermaidBlock code={raw} />;
            if (className === "language-chart") return <MarkdownChart source={raw} />;
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          a: ({ children }) => <span>{children}</span>,
          img: ({ alt }) => <span>[Image: {alt}]</span>,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
