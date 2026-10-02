import type { Operation } from "./operations";

// Shared motion primitives, expressed separately from data and renderers.
// Durations are perceptual teaching timings; they never represent CPU time.
export const MOTION = {
  focus: [
    { opacity: 0.3, transform: "scale(.94)" },
    { opacity: 1, transform: "scale(1)" },
  ],
  right: [{ transform: "translateX(-12px)" }, { transform: "translateX(0)" }],
  left: [{ transform: "translateX(12px)" }, { transform: "translateX(0)" }],
  insert: [
    { opacity: 0, transform: "translateY(-12px) scale(.85)" },
    { opacity: 1, transform: "translateY(0) scale(1)" },
  ],
  return: [
    { opacity: 0.3, transform: "translateY(8px)" },
    { opacity: 1, transform: "translateY(0)" },
  ],
  rotate: [{ transform: "rotate(-15deg)" }, { transform: "rotate(0deg)" }],
} satisfies Record<string, Keyframe[]>;

export const OPERATION_MOTION: Partial<Record<Operation, keyof typeof MOTION>> = {
  "move-left": "left",
  "move-right": "right",
  insert: "insert",
  allocate: "insert",
  push: "insert",
  enqueue: "right",
  dequeue: "left",
  pop: "return",
  call: "insert",
  return: "return",
  rotate: "rotate",
  sift: "return",
  link: "right",
  unlink: "left",
  merge: "right",
  split: "left",
  visit: "focus",
  compare: "focus",
  read: "focus",
  write: "focus",
  hash: "focus",
  probe: "right",
  relax: "focus",
  union: "right",
  bit: "focus",
  input: "right",
  output: "right",
  fetch: "right",
  decode: "focus",
  execute: "focus",
};

export function animateOperation(root: HTMLElement, operation: string) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  const animations: Animation[] = [];
  const cells = Array.from(root.querySelectorAll<HTMLElement>(".is-changed .cs-cell"));
  if (operation === "swap" && cells.length === 2) {
    const rects = cells.map((cell) => cell.getBoundingClientRect());
    cells.forEach((cell, i) => {
      const other = rects[1 - i],
        own = rects[i];
      animations.push(
        cell.animate(
          [
            { transform: `translate(${other.x - own.x}px, ${other.y - own.y}px)` },
            {
              transform: `translate(${(other.x - own.x) / 2}px, ${i === 0 ? -20 : 20}px)`,
              offset: 0.5,
            },
            { transform: "translate(0,-2px)" },
          ],
          { duration: 650, easing: "cubic-bezier(.2,.7,.2,1)" },
        ),
      );
    });
  } else {
    const key = OPERATION_MOTION[operation as Operation] ?? "focus";
    for (const cell of cells)
      animations.push(cell.animate(MOTION[key], { duration: 400, easing: "ease-out" }));
  }
  return () => animations.forEach((animation) => animation.cancel());
}
