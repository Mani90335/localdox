import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { calculate } from "./calculator";
import { Button } from "./ui/kit";

/**
 * Non-modal, draggable calculator. It floats above the exam (never inline) so
 * the question stays readable; drag it by its title bar, Esc or × closes it.
 * Keyboard shortcuts of the exam runner are ignored inside it (data-no-shortcuts).
 */
export function Calculator({ scientific, onClose }: { scientific: boolean; onClose: () => void }) {
  const [expression, setExpression] = useState(""),
    [result, setResult] = useState(""),
    [pos, setPos] = useState(() => ({
      x: Math.max(16, window.innerWidth - 360 - 340),
      y: 96,
    })),
    drag = useRef<{ dx: number; dy: number } | null>(null),
    panel = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const clamp = (x: number, y: number) => {
    const w = panel.current?.offsetWidth ?? 300,
      h = panel.current?.offsetHeight ?? 400;
    return {
      x: Math.min(Math.max(8, x), window.innerWidth - w - 8),
      y: Math.min(Math.max(8, y), window.innerHeight - h - 8),
    };
  };
  const keys = [
    ...(scientific
      ? ["sin(", "cos(", "tan(", "sqrt(", "log(", "ln(", "pi", "^", "!", "(", ")", "/", "*"]
      : ["(", ")", "/", "*"]),
    ...["7", "8", "9", "-", "4", "5", "6", "+", "1", "2", "3", ".", "0"],
  ];
  // "=" fills whatever is left of the last row (keys + backspace + clear).
  const equalsSpan = 4 - ((keys.length + 2) % 4);
  return (
    <div
      ref={panel}
      className="xr-calc"
      role="dialog"
      aria-modal="false"
      aria-label={`${scientific ? "Scientific" : "Basic"} calculator`}
      data-no-shortcuts
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        className="xr-calc-head"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current) setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <span>
          {scientific ? "Scientific" : "Basic"} calculator
          {scientific && <span className="ex-small"> · radians</span>}
        </span>
        <Button
          variant="ghost"
          className="ex-btn--icon"
          aria-label="Close calculator"
          onClick={onClose}
        >
          <X size={18} />
        </Button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            if (!scientific && /[a-z^!]/i.test(expression)) throw new Error("Use basic arithmetic");
            setResult(String(calculate(expression)));
          } catch (error) {
            setResult(error instanceof Error ? error.message : String(error));
          }
        }}
      >
        <input
          ref={input}
          className="ex-input tabular"
          aria-label="Calculator expression"
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          placeholder="(2 + 3) / 4"
          autoComplete="off"
        />
        <output aria-live="polite">{result}</output>
        <div className="xr-keypad">
          {keys.map((key) => (
            <Button key={key} onClick={() => setExpression((v) => v + key)}>
              {key}
            </Button>
          ))}
          <Button onClick={() => setExpression((v) => v.slice(0, -1))} aria-label="Backspace">
            ⌫
          </Button>
          <Button
            onClick={() => {
              setExpression("");
              setResult("");
            }}
          >
            C
          </Button>
          <Button type="submit" variant="primary" style={{ gridColumn: `span ${equalsSpan}` }}>
            =
          </Button>
        </div>
      </form>
    </div>
  );
}
