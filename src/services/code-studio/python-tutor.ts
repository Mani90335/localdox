import { traceSchema, type Language, type Snapshot, type Trace, type Value } from "./protocol.ts";
import { z } from "zod";

const tutorSchema = z.object({
  code: z.string().max(50000),
  trace: z
    .array(
      z.object({
        line: z.number().int().nonnegative().optional(),
        event: z.string().optional(),
        stdout: z.string().optional(),
        exception_msg: z.string().optional(),
        globals: z.record(z.unknown()).optional(),
        heap: z.record(z.array(z.unknown())).optional(),
        stack_to_render: z
          .array(
            z.object({
              frame_id: z.union([z.number(), z.string()]),
              func_name: z.string().optional(),
              encoded_locals: z.record(z.unknown()).optional(),
            }),
          )
          .max(99)
          .optional(),
      }),
    )
    .min(1)
    .max(2002),
});

/** Adapter for the pinned Pathrise/Python Tutor trace contract. See notices. */
export function importPythonTutor(input: unknown, language: Language): Trace {
  const raw = tutorSchema.parse(input);
  const value = (v: unknown): Value => {
    if (v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "number")
      return v;
    if (Array.isArray(v) && v[0] === "REF") return { ref: String(v[1]) };
    return {
      special: Array.isArray(v) ? v.slice(1).map(String).join(" ").slice(0, 2000) : "Unavailable",
    };
  };
  const vars = (v: unknown) =>
    v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).map(([k, item]) => [k, value(item)]))
      : {};
  const steps: Snapshot[] = raw.trace.map((item) => {
    const heap: Snapshot["heap"] = Object.create(null);
    for (const [id, object] of Object.entries(item.heap ?? {})) {
      if (!Array.isArray(object)) continue;
      const type = String(object[0]);
      let entries: [string, Value][] = [];
      if (["LIST", "TUPLE", "SET"].includes(type))
        entries = object.slice(1).map((v, i) => [String(i), value(v)]);
      else if (type === "DICT")
        entries = object
          .slice(1)
          .filter(Array.isArray)
          .flatMap(
            (pair, i) =>
              [
                [`key ${i}`, value(pair[0])],
                [`value ${i}`, value(pair[1])],
              ] as [string, Value][],
          );
      else if (type === "INSTANCE")
        entries = object
          .slice(2)
          .filter(Array.isArray)
          .map((pair) => [String(pair[0]), value(pair[1])]);
      else entries = object.slice(1).map((v, i) => [String(i), value(v)]);
      heap[id] = {
        type: type === "LIST" ? "List" : type,
        entries: entries.slice(0, 200),
        truncated: entries.length > 200,
      };
    }
    const event: Snapshot["event"] =
      item.event === "call"
        ? "call"
        : item.event === "return"
          ? "return"
          : item.event === "instruction_limit_reached"
            ? "limit"
            : ["exception", "uncaught_exception"].includes(item.event ?? "")
              ? "error"
              : "before";
    return {
      line: Number(item.line) || 0,
      event,
      stdout: String(item.stdout ?? "").slice(0, 20000),
      heap,
      frames: [
        { id: "global", name: "Global", locals: vars(item.globals) },
        ...(item.stack_to_render ?? []).map((frame) => ({
          id: String(frame.frame_id),
          name: String(frame.func_name ?? "anonymous"),
          locals: vars(frame.encoded_locals),
        })),
      ],
      ...(item.exception_msg ? { message: String(item.exception_msg).slice(0, 4000) } : {}),
    };
  });
  return traceSchema.parse({
    version: 1,
    language,
    source: raw.code,
    steps,
    origin: "execution",
    notes: [
      "Imported Python Tutor trace. Line events show state before the highlighted line. Object IDs are logical identities.",
      "Imported traces describe what their producer recorded; their provenance and language are supplied by the importer.",
    ],
  });
}
