import { z } from "zod";

export const fieldLabel = (key: string) =>
  ({
    questionTimeLimitSeconds: "Time per question (seconds)",
    showElapsedTime: "Show solve time",
    allowSkip: "Allow skipping",
    name: "Name",
    mcq: "MCQ",
    msq: "MSQ",
    nat: "NAT",
    instructionsMd: "Instructions (Markdown)",
    durationMinutes: "Duration (minutes)",
    passPercentage: "Pass mark (%)",
    maxAttempts: "Maximum attempts",
    mcqPenalty: "MCQ penalty",
    questionCount: "Question count",
    rules: "Full exam rules",
    xrule: "File format version",
    summary: "Study summary",
  })[key] ??
  key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());

/** Use the runtime schema so optional and deeply nested attributes cannot drift from JSON. */
export function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodEffects) return unwrap(schema.innerType());
  if (
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable
  )
    return unwrap(schema._def.innerType);
  if (schema instanceof z.ZodLazy) return unwrap(schema.schema);
  return schema;
}
export function seed(schema: z.ZodTypeAny): unknown {
  const parsed = schema.safeParse(undefined);
  if (parsed.success) return parsed.data;
  const type = unwrap(schema);
  if (type instanceof z.ZodObject)
    return Object.fromEntries(
      Object.entries(type.shape as Record<string, z.ZodTypeAny>).map(([k, s]) => [k, seed(s)]),
    );
  if (type instanceof z.ZodUnion)
    return seed(type.options.filter((s: z.ZodTypeAny) => !(unwrap(s) instanceof z.ZodNull)).at(-1));
  if (type instanceof z.ZodNull) return null;
  if (type instanceof z.ZodArray) return [];
  if (type instanceof z.ZodTuple) return type.items.map(seed);
  if (type instanceof z.ZodLiteral) return type.value;
  if (type instanceof z.ZodEnum) return type.options[0];
  if (type instanceof z.ZodBoolean) return false;
  if (type instanceof z.ZodNumber) return type.minValue ?? 1;
  return "";
}
