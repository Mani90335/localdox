import type { Snapshot, Trace, Value } from "./protocol";

/** Self-contained so it can be serialized into an opaque-origin Web Worker. */
export function runJavaScript(job: { source: string; compiled: string; stdin: string }): Trace {
  const steps: Snapshot[] = [];
  let stdout = "",
    nextId = 1,
    nextFrame = 1,
    line = 0,
    stopped = false,
    traceSize = 0;
  const identities = new WeakMap<object, string>();
  const frames: { id: string; name: string; read: [string, () => unknown][] }[] = [
    { id: "0", name: "Global", read: [] },
  ];
  const limit = new Error("Stopped at 2,000 trace steps. Try a smaller input.");
  function capture(event: Snapshot["event"], message?: string) {
    const heap: Snapshot["heap"] = Object.create(null);
    const encode = (v: unknown, depth = 0): Value => {
      if (v === null || typeof v === "boolean") return v;
      if (typeof v === "string")
        return v.length > 2000 ? { special: v.slice(0, 1990) + "… (truncated)" } : v;
      if (typeof v === "number") return Number.isFinite(v) ? v : { special: String(v) };
      if (typeof v !== "object" && typeof v !== "function") return { special: String(v) };
      let id = identities.get(v);
      if (!id) {
        id = String(nextId++);
        identities.set(v, id);
      }
      if (heap[id]) return { ref: id };
      if (Object.keys(heap).length >= 100 || depth >= 8)
        return { special: "Object hidden (snapshot limit)" };
      const obj: Snapshot["heap"][string] = {
        type: Array.isArray(v)
          ? "Array"
          : v instanceof Map
            ? "Map"
            : v instanceof Set
              ? "Set"
              : typeof v === "function"
                ? "Function"
                : "Object",
        entries: [],
      };
      heap[id] = obj;
      try {
        const entries =
          v instanceof Map
            ? Array.from(Map.prototype.entries.call(v), ([key, value], i) => [
                [`key ${i}`, key],
                [`value ${i}`, value],
              ]).flat()
            : v instanceof Set
              ? Array.from(Set.prototype.values.call(v), (value, i) => [String(i), value])
              : Object.entries(Object.getOwnPropertyDescriptors(v))
                  .filter(
                    ([k, d]) =>
                      k !== "length" && k !== "caller" && k !== "arguments" && d.enumerable,
                  )
                  .map(([k, d]) => [k, "value" in d ? d.value : "[getter: not evaluated]"]);
        obj.entries = entries
          .slice(0, 200)
          .map(([k, value]) => [String(k).slice(0, 2000), encode(value, depth + 1)]);
        obj.truncated = entries.length > 200;
      } catch {
        obj.entries = [["inspection", { special: "Unavailable" }]];
      }
      return { ref: id };
    };
    const snapshot: Snapshot = {
      line,
      event,
      frames: frames.slice(-100).map((f) => ({
        id: f.id,
        name: f.name,
        locals: Object.fromEntries(
          f.read.map(([name, read]) => {
            try {
              return [name, encode(read())];
            } catch {
              return [name, { special: "not initialized" }];
            }
          }),
        ),
      })),
      heap,
      stdout,
      ...(message ? { message: message.slice(0, 4000) } : {}),
    };
    traceSize += JSON.stringify(snapshot).length;
    if (traceSize > 12000000 && event !== "limit" && event !== "error") {
      stopped = true;
      limit.message = "Stopped at the 12 MB browser trace limit. Try a smaller input.";
      throw limit;
    }
    steps.push(snapshot);
  }
  const runtime = {
    step(at: number, event: Snapshot["event"], read: [string, () => unknown][]) {
      if (stopped || steps.length >= 2000) {
        stopped = true;
        throw limit;
      }
      line = at;
      frames[frames.length - 1].read = read;
      capture(event);
    },
    enter(name: string, at: number, read: [string, () => unknown][]) {
      if (frames.length >= 100) throw new Error("Call stack limit: 100 frames.");
      if (stopped || steps.length >= 2000) {
        stopped = true;
        throw limit;
      }
      frames.push({ id: String(nextFrame++), name, read });
      line = at;
      capture("call");
    },
    leave() {
      if (!stopped && steps.length < 2000) capture("return");
      frames.pop();
    },
    returnValue(at: number, value: unknown) {
      line = at;
      frames[frames.length - 1].read.push(["Return value", () => value]);
      return value;
    },
  };
  // Format output without JSON.stringify invoking authored toJSON/getters.
  const printable = (value: unknown, seen = new Set<object>(), depth = 0): string => {
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value !== "object" || value === null) return String(value);
    if (seen.has(value)) return "[Circular]";
    if (depth >= 4) return "[…]";
    seen.add(value);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const contents = Object.entries(descriptors)
        .filter(([key, d]) => d.enumerable && key !== "length")
        .slice(0, 200)
        .map(
          ([key, d]) =>
            `${Array.isArray(value) ? "" : JSON.stringify(key) + ":"}${"value" in d ? printable(d.value, seen, depth + 1) : "[Getter]"}`,
        );
      return Array.isArray(value) ? `[${contents.join(",")}]` : `{${contents.join(",")}}`;
    } catch {
      return "[Unavailable]";
    } finally {
      seen.delete(value);
    }
  };
  const log = (...values: unknown[]) => {
    const next =
      stdout + values.map((v) => (typeof v === "string" ? v : printable(v))).join(" ") + "\n";
    stdout = next.slice(0, 20000);
    if (next.length > 20000) {
      stopped = true;
      limit.message = "Stopped at 20,000 output characters.";
      throw limit;
    }
  };
  const inputs = job.stdin.split("\n");
  try {
    const unsupported = () => {
      throw new Error("Async callbacks are not traced yet. Use synchronous code.");
    };
    new Function(
      "__studio_runtime__",
      "console",
      "prompt",
      "setTimeout",
      "setInterval",
      "queueMicrotask",
      "Promise",
      '"use strict";\n' + job.compiled,
    )(
      runtime,
      { log, info: log, warn: log, error: log },
      () => inputs.shift() ?? null,
      unsupported,
      unsupported,
      unsupported,
      undefined,
    );
  } catch (error) {
    capture(
      error === limit ? "limit" : "error",
      error instanceof Error ? error.message : String(error),
    );
  }
  return {
    version: 1,
    language: "javascript",
    source: job.source,
    steps,
    origin: "execution",
    notes: [
      "Source-level snapshots; CPU activity is an educational model, not hardware telemetry.",
      "Synchronous JavaScript only. Native operations appear as one source step. Objects: 100 per snapshot, 200 entries, depth 8; excess data is marked.",
    ],
  };
}
