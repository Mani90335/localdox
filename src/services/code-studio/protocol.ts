import { z } from "zod";

export type Language = "javascript" | "python" | "cpp";
const valueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.object({ ref: z.string().max(100) }),
  z.object({ special: z.string().max(2000) }),
]);
export const snapshotSchema = z.object({
  line: z.number().int().nonnegative(),
  event: z.enum(["before", "after", "call", "return", "end", "error", "limit"]),
  frames: z
    .array(z.object({ id: z.string(), name: z.string().max(500), locals: z.record(valueSchema) }))
    .max(100),
  heap: z.record(
    z.object({
      type: z.string().max(200),
      entries: z.array(z.tuple([z.string().max(2000), valueSchema])).max(201),
      truncated: z.boolean().optional(),
    }),
  ),
  stdout: z.string().max(20000),
  message: z.string().max(4000).optional(),
  lesson: z
    .object({
      title: z.string(),
      explanation: z.string(),
      operation: z.string(),
      focus: z.array(z.string()),
    })
    .optional(),
});
export const traceSchema = z.object({
  version: z.literal(1),
  language: z.enum(["javascript", "python", "cpp"]),
  source: z.string().max(50000),
  steps: z.array(snapshotSchema).min(1).max(2002),
  origin: z.enum(["execution", "lesson"]),
  notes: z.array(z.string()).max(20),
});
export type Value = z.infer<typeof valueSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Trace = z.infer<typeof traceSchema>;
export const LANGUAGES: Record<Language, { label: string; file: string }> = {
  javascript: { label: "JavaScript", file: "main.js" },
  python: { label: "Python", file: "main.py" },
  cpp: { label: "C++", file: "main.cpp" },
};
export const isRef = (value: Value): value is { ref: string } =>
  typeof value === "object" && value !== null && "ref" in value;
export function displayValue(value: Value): string {
  if (isRef(value)) return `→ ${value.ref.startsWith("0x") ? value.ref : `#${value.ref}`}`;
  if (value && typeof value === "object") return value.special;
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}
