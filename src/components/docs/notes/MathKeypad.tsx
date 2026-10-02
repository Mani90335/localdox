import { useEffect, useId, useRef, useState } from "react";
import { ArrowBigUp } from "lucide-react";
import { EDIT_KEYS, LAYOUTS, type KeyLayout, type MathKey } from "./math-keys";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      /** MathLive's static renderer, defined once MathLive has loaded. */
      "math-span": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

/** The key set last shown, kept across tab switches like the input. */
const state: { layout: KeyLayout["id"] | null } = { layout: null };

/** Held, the edit keys repeat: after this long, then every REPEAT_MS. */
const REPEAT_DELAY_MS = 400;
const REPEAT_MS = 70;

/** Faces that need a smaller size to fit a key. */
const FACE_SIZE: Partial<Record<KeyLayout["id"], string>> = {
  calculus: "text-[0.8125rem]",
  matrices: "text-[0.6875rem]",
};

/**
 * The Compute tab's math keyboard, embedded under the field: tabs of keys
 * (basic, functions, calculus, matrices, Greek, letters) over a row for
 * left, right and delete, which stays put. Every key is complete on its own, because on
 * a touch screen the math field never raises the system keyboard.
 *
 * A tapped key leaves focus in the field (its pointerdown is cancelled), so
 * typing and tapping mix freely. A key pressed from the keyboard keeps focus
 * on the keypad, and the arrow keys move between keys.
 */
export function MathKeypad({
  onKey,
}: {
  /** `fromKeyboard`: pressed with Enter or Space rather than tapped or clicked. */
  onKey: (key: MathKey, fromKeyboard: boolean) => void;
}) {
  const id = useId();
  const [layoutId, setLayoutId] = useState<KeyLayout["id"]>(() => state.layout ?? "basic");
  const [shift, setShift] = useState(false);
  const layout = LAYOUTS.find((l) => l.id === layoutId) ?? LAYOUTS[0];
  const choose = (next: KeyLayout["id"]) => {
    state.layout = next;
    setLayoutId(next);
  };

  const press = (key: MathKey, fromKeyboard: boolean) => {
    if (layout.id === "letters" && shift && key.action.kind === "type") {
      onKey(
        { ...key, action: { kind: "type", text: key.action.text.toUpperCase() } },
        fromKeyboard,
      );
      setShift(false);
      return;
    }
    onKey(key, fromKeyboard);
  };

  /** Arrow keys between keys: by column across a row, by row (nearest column) down. */
  const gridRef = useRef<HTMLDivElement>(null);
  const navigate = (event: React.KeyboardEvent) => {
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[
      event.key
    ];
    const from = (event.target as HTMLElement).closest<HTMLElement>("[data-key]");
    if (!step || !from || !gridRef.current) return;
    const rows = [...gridRef.current.querySelectorAll<HTMLElement>("[data-row]")].map((row) => [
      ...row.querySelectorAll<HTMLElement>("[data-key]"),
    ]);
    const r = rows.findIndex((row) => row.includes(from));
    const c = rows[r].indexOf(from);
    const nextRow = rows[r + step[0]];
    if (!nextRow) return;
    const target = step[0] === 0 ? nextRow[c + step[1]] : nextRow[Math.min(c, nextRow.length - 1)];
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  const faceSize = FACE_SIZE[layout.id] ?? "text-[0.9375rem]";
  const keyRows =
    layout.id === "letters" ? lettersRows(layout, shift, () => setShift((s) => !s)) : null;

  return (
    <div role="group" aria-label="Math keyboard" className="border-t border-border/70 bg-muted/30">
      <div
        role="tablist"
        aria-label="Keys"
        className="flex border-b border-border/60 px-1.5"
        onKeyDown={(event) => {
          const index = LAYOUTS.indexOf(layout);
          const next =
            event.key === "ArrowRight"
              ? LAYOUTS[(index + 1) % LAYOUTS.length]
              : event.key === "ArrowLeft"
                ? LAYOUTS[(index - 1 + LAYOUTS.length) % LAYOUTS.length]
                : null;
          if (!next) return;
          event.preventDefault();
          choose(next.id);
          document.getElementById(`${id}-tab-${next.id}`)?.focus();
        }}
      >
        {LAYOUTS.map((l) => (
          <button
            key={l.id}
            id={`${id}-tab-${l.id}`}
            type="button"
            role="tab"
            aria-selected={l.id === layout.id}
            aria-controls={`${id}-panel`}
            aria-label={l.name}
            title={l.name}
            tabIndex={l.id === layout.id ? 0 : -1}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => choose(l.id)}
            className={`relative h-8 min-w-0 flex-1 rounded-md px-1 text-[0.8125rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-10 ${
              l.id === layout.id
                ? "font-semibold text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {l.tab}
          </button>
        ))}
      </div>
      <div
        ref={gridRef}
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${layout.id}`}
        onKeyDown={navigate}
        // As tall as the tallest set, so switching sets doesn't move what's below.
        className={`space-y-1 p-1.5 ${faceSize} min-h-[10.5rem] coarse:min-h-[12.5rem]`}
      >
        {(keyRows ?? layout.rows.map((row) => ({ inset: 0, keys: row }))).map((row, r) => (
          <div
            key={`${layout.id}-${r}`}
            data-row
            className="grid gap-1"
            style={{
              gridTemplateColumns: `repeat(${layout.columns - row.inset * 2}, minmax(0, 1fr))`,
              paddingInline: row.inset
                ? `calc(${row.inset} * (100% + 0.25rem) / ${layout.columns})`
                : undefined,
            }}
          >
            {row.keys.map((key, c) => (
              <Key
                key={`${key.name}-${c}`}
                keyDef={key}
                onPress={press}
                tabbable={r === 0 && c === 0}
                pressed={key.name === "Shift" ? shift : undefined}
              />
            ))}
          </div>
        ))}
      </div>
      {/* Editing, the same under every set. */}
      <div className="grid grid-cols-3 gap-1 px-1.5 pb-1.5">
        {EDIT_KEYS.map((key) => (
          <Key key={key.name} keyDef={key} onPress={press} repeat />
        ))}
      </div>
    </div>
  );
}

/** The letters, with Shift: the middle row inset by half a key, as on a keyboard. */
function lettersRows(layout: KeyLayout, shift: boolean, toggleShift: () => void) {
  const [top, middle, bottom] = layout.rows.map((row) =>
    row.map((key) =>
      shift ? { ...key, name: key.name.toUpperCase(), face: key.face.toUpperCase() } : key,
    ),
  );
  const shiftKey: MathKey & { onToggle: () => void } = {
    name: "Shift",
    face: "",
    text: true,
    action: { kind: "type", text: "" },
    span: 3,
    onToggle: toggleShift,
  };
  return [
    { inset: 0, keys: top },
    { inset: 0.5, keys: middle },
    { inset: 0, keys: [shiftKey, ...bottom] },
  ];
}

function Key({
  keyDef: key,
  onPress,
  tabbable,
  repeat,
  pressed,
}: {
  keyDef: MathKey & { onToggle?: () => void };
  onPress: (key: MathKey, fromKeyboard: boolean) => void;
  tabbable?: boolean;
  /** Held down, it repeats (delete, left, right). */
  repeat?: boolean;
  pressed?: boolean;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeated = useRef(false);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  const activate = (fromKeyboard: boolean) =>
    key.onToggle ? key.onToggle() : onPress(key, fromKeyboard);

  return (
    <button
      type="button"
      data-key
      aria-label={key.name.trim()}
      aria-pressed={pressed}
      title={key.name.trim()}
      tabIndex={tabbable ? 0 : -1}
      onPointerDown={(event) => {
        // Keeps focus (and the caret) in the field.
        event.preventDefault();
        if (!repeat || event.button !== 0) return;
        repeated.current = false;
        const tick = (delay: number) => {
          timer.current = setTimeout(() => {
            repeated.current = true;
            activate(false);
            tick(REPEAT_MS);
          }, delay);
        };
        tick(REPEAT_DELAY_MS);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={(event) => {
        // A held key already acted while held.
        if (repeated.current) {
          repeated.current = false;
          return;
        }
        activate(event.detail === 0);
      }}
      style={key.span ? { gridColumn: `span ${key.span}` } : undefined}
      className={`flex h-9 min-w-0 select-none items-center justify-center overflow-hidden rounded-md border text-foreground transition-[background-color,transform] duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] active:bg-accent motion-reduce:transition-none motion-reduce:active:scale-100 coarse:h-11 [@media(hover:hover)]:hover:bg-accent ${
        pressed ? "border-primary/50 bg-primary/10 text-primary" : "border-border/80 bg-card"
      } ${key.digit ? "font-medium" : ""} ${key.small ? "text-[0.5625rem]" : ""}`}
    >
      {key.name === "Shift" ? (
        <ArrowBigUp className="h-4 w-4" aria-hidden />
      ) : key.text ? (
        <span aria-hidden className="text-[0.8125rem] leading-none">
          {key.face}
        </span>
      ) : (
        <math-span aria-hidden className="pointer-events-none leading-none">
          {key.face}
        </math-span>
      )}
    </button>
  );
}
