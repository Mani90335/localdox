import { isRef, type Trace, type Value } from "./protocol.ts";

// A display projection. Keep the original recording for export and diagnostics.
const runtimeFrame =
  /^(?:_GLOBAL__sub_I_|__static_initialization_and_destruction_|__cxx_global_var_init|std::|__gnu_cxx::)/;
const runtimeVariable = /^(?:std::|__gnu_cxx::|__initialize_p$|__priority$)/;
const waiting = /^(?:Not yet initialized at this source position|Uninitialized|Not initialized)$/i;

export function presentTrace(recording: Trace): Trace {
  const addresses = new Map<string, string>();
  const frames = new Map<string, string>();
  const address = (id: string) => {
    if (!addresses.has(id)) addresses.set(id, `0x${(addresses.size + 1).toString(16)}`);
    return addresses.get(id)!;
  };
  const value = (v: Value): Value => {
    if (isRef(v)) return { ref: address(v.ref) };
    if (v && typeof v === "object" && "special" in v) {
      if (/^(Unavailable|Optimized out)/.test(v.special))
        return { special: "Can't see this value" };
    }
    return v;
  };
  const steps = recording.steps.flatMap((step) => {
    const visibleFrames = step.frames.filter(
      (frame) => recording.language !== "cpp" || !runtimeFrame.test(frame.name),
    );
    if (
      recording.language === "cpp" &&
      step.frames.length &&
      !visibleFrames.length &&
      !["end", "error", "limit"].includes(step.event)
    )
      return [];
    const reachable = new Set<string>();
    const visit = (v: Value) => {
      if (!isRef(v) || reachable.has(v.ref)) return;
      reachable.add(v.ref);
      address(v.ref);
      step.heap[v.ref]?.entries.forEach(([, child]) => visit(child));
    };
    const shownFrames = visibleFrames.map((frame) => {
      if (!frames.has(frame.id)) frames.set(frame.id, `task-${frames.size + 1}`);
      const locals = Object.fromEntries(
        Object.entries(frame.locals).filter(
          ([name, v]) =>
            !(recording.language === "cpp" && runtimeVariable.test(name)) &&
            !(v && typeof v === "object" && "special" in v && waiting.test(v.special)),
        ),
      );
      Object.values(locals).forEach(visit);
      return {
        ...frame,
        id: frames.get(frame.id)!,
        locals: Object.fromEntries(Object.entries(locals).map(([name, v]) => [name, value(v)])),
      };
    });
    // Authored scenes may intentionally show objects before a name points to them.
    if (recording.origin === "lesson") Object.keys(step.heap).forEach((id) => visit({ ref: id }));
    const heap = Object.fromEntries(
      [...reachable]
        .filter((id) => step.heap[id])
        .map((id) => {
          const obj = step.heap[id];
          return [
            address(id),
            { ...obj, entries: obj.entries.map(([key, v]): [string, Value] => [key, value(v)]) },
          ];
        }),
    );
    return [
      {
        ...step,
        frames: shownFrames,
        heap,
        lesson: step.lesson && {
          ...step.lesson,
          focus: step.lesson.focus.map((key) => {
            const split = key.lastIndexOf(":");
            return split < 0 ? key : `${address(key.slice(0, split))}:${key.slice(split + 1)}`;
          }),
        },
      },
    ];
  });
  return {
    ...recording,
    steps: steps.length
      ? steps
      : [
          {
            line: 0,
            event: "end",
            frames: [],
            heap: {},
            stdout: recording.steps.at(-1)?.stdout ?? "",
          },
        ],
  };
}

export function friendlyType(type: string): string {
  if (/vector|^Array$|^List$|^list$|\[\d+\]/.test(type)) return "List";
  if (/map|dict/i.test(type)) return "Pairs";
  if (/set/i.test(type)) return "Set";
  return type.replace(/^std::/, "").replace(/<.*>/, "");
}
