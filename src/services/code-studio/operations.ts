import { displayValue, type Snapshot, type Value } from "./protocol.ts";

// A vocabulary, not a claim that every source-level trace exposes each operation.
export const OPERATIONS = {
  read: ["Read", "Look up a value without changing it."],
  write: ["Write", "Store a new value in a named place."],
  allocate: ["Create an object", "Reserve a place to keep a group of values."],
  reference: ["Follow a reference", "Use an address-like label to find an existing object."],
  compare: ["Compare", "Ask how two values relate before choosing what to do."],
  branch: ["Choose a path", "Follow one path because a condition is true or false."],
  "move-left": ["Move left", "Move a position one place toward the beginning."],
  "move-right": ["Move right", "Move a position one place toward the end."],
  swap: ["Swap", "Exchange the values in two places."],
  insert: ["Insert", "Add a value to a collection."],
  remove: ["Remove", "Take a value out of a collection."],
  push: ["Push", "Add a value to the top of a stack."],
  pop: ["Pop", "Remove the most recently added stack value."],
  enqueue: ["Enqueue", "Join the back of a waiting line."],
  dequeue: ["Dequeue", "Take the value at the front of a waiting line."],
  link: ["Connect", "Make one object refer to another."],
  unlink: ["Disconnect", "Remove a connection between objects."],
  visit: ["Visit", "Inspect a node in a linked structure."],
  hash: ["Hash", "Turn a key into a number used to choose a storage bucket."],
  probe: ["Probe", "Check another location when a hash bucket is occupied."],
  rotate: ["Rotate", "Rearrange tree links while preserving the ordering of values."],
  sift: ["Sift", "Move a heap value until parent and child priorities agree."],
  relax: ["Relax an edge", "Replace a known path cost when a shorter path is found."],
  union: ["Union", "Join two groups into one connected component."],
  split: ["Split", "Divide a problem into smaller parts."],
  merge: ["Merge", "Combine smaller results into a larger result."],
  call: ["Call a function", "Keep a bookmark for the current work and start another task."],
  return: ["Return", "Finish a task and go back to its caller."],
  output: ["Output", "Send a result to the program's output stream."],
  input: ["Input", "Receive information from outside the program."],
  parse: [
    "Read the program",
    "Turn source text into a structure the language runtime understands.",
  ],
  fetch: ["Fetch", "Bring the next machine instruction to the processor."],
  decode: ["Decode", "Work out which operation a machine instruction requests."],
  execute: ["Execute", "Carry out an operation and update state."],
  bit: ["Bit operation", "Manipulate the zeros and ones that encode a value."],
  end: ["Finished", "The program has reached its final recorded state."],
  step: ["Next instruction", "Continue through the program in execution order."],
} as const;
export type Operation = keyof typeof OPERATIONS;
export type Change = { target: string; before?: Value; after?: Value };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function changesBetween(previous: Snapshot | undefined, current: Snapshot): Change[] {
  if (!previous) return [];
  const changes: Change[] = [];
  for (const f of current.frames) {
    const old = previous.frames.find((p) => p.id === f.id)?.locals ?? {};
    for (const key of new Set([...Object.keys(old), ...Object.keys(f.locals)]))
      if (!equal(old[key], f.locals[key]))
        changes.push({ target: `${f.name}.${key}`, before: old[key], after: f.locals[key] });
  }
  for (const [id, obj] of Object.entries(current.heap)) {
    const old = Object.fromEntries(previous.heap[id]?.entries ?? []);
    for (const [key, value] of obj.entries)
      if (!equal(old[key], value))
        changes.push({ target: `#${id}[${key}]`, before: old[key], after: value });
    for (const key of Object.keys(old))
      if (!obj.entries.some(([k]) => k === key))
        changes.push({ target: `#${id}[${key}]`, before: old[key] });
  }
  return changes;
}

export function explain(previous: Snapshot | undefined, current: Snapshot) {
  const changes = changesBetween(previous, current);
  let operation: Operation = "step";
  if (current.event === "call") operation = "call";
  else if (current.event === "return") operation = "return";
  else if (current.event === "end") operation = "end";
  else if (previous && current.stdout !== previous.stdout) operation = "output";
  else if (previous && Object.keys(current.heap).some((id) => !previous.heap[id]))
    operation = "allocate";
  else if (changes.length) operation = "write";
  const heapChanges = changes.filter(
    (c) => c.target.startsWith("#") && c.before !== undefined && c.after !== undefined,
  );
  if (
    heapChanges.length === 2 &&
    equal(heapChanges[0].before, heapChanges[1].after) &&
    equal(heapChanges[1].before, heapChanges[0].after)
  )
    operation = "swap";
  const movement = changes.find(
    (c) =>
      /\.(left|right|i|j|index|cursor|head|tail)$/.test(c.target) &&
      typeof c.before === "number" &&
      typeof c.after === "number" &&
      Math.abs(c.after - c.before) === 1,
  );
  if (operation === "write" && movement)
    operation =
      (movement.after as number) > (movement.before as number) ? "move-right" : "move-left";
  const [title, description] = OPERATIONS[operation];
  return {
    operation: current.lesson?.operation ?? operation,
    title:
      current.lesson?.title ??
      (current.event === "error"
        ? "The program stopped here"
        : current.event === "limit"
          ? "Execution limit reached"
          : title),
    explanation:
      current.lesson?.explanation ??
      current.message ??
      (changes.length
        ? changes
            .slice(0, 3)
            .map(
              (c) =>
                `${c.target} ${c.after === undefined ? "was removed" : c.before === undefined ? `now holds ${displayValue(c.after)}` : `changed from ${displayValue(c.before)} to ${displayValue(c.after)}`}.`,
            )
            .join(" ")
        : current.event === "before"
          ? `Line ${current.line} is about to run. The memory below shows the state before this instruction.`
          : description),
    changes,
  };
}
