import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { CornerDownLeft, Keyboard, X } from "lucide-react";
import { hasModKey, modKeyLabel } from "@/lib/platform/keyboard";
import { OPERATION_LABELS, type ComputeOperation } from "@/services/compute/protocol";
import { keypadPreferred, rememberKeypad, type InputMode } from "./compute-input";
import { MathField, type MathFieldHandle } from "./MathField";
import { MathKeypad } from "./MathKeypad";

export interface ComposerHandle {
  focus: () => void;
  /** Selects the first empty box in the math field. */
  nextBox: () => void;
}

const coarsePointer = () =>
  typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/**
 * Where the reader writes what to compute: a math field with an embedded
 * keypad (Math), or a plain textarea for text and LaTeX (Text), and the
 * button for the operation the input implies (Evaluate, or Solve for an
 * equation). Enter computes in Math, where there is one line; Text keeps
 * Enter for new lines and computes on {mod}+Enter.
 */
export const ComputeComposer = forwardRef<
  ComposerHandle,
  {
    mode: InputMode;
    onModeChange: (mode: InputMode) => void;
    /** MathLive couldn't load: the composer can only be text. */
    onMathUnavailable: () => void;
    input: string;
    onInput: (value: string) => void;
    primary: ComputeOperation;
    /** `latest`: the math field's value at Enter, which may be ahead of `input`. */
    onRun: (latest?: string) => void;
    /** Escape, outside LaTeX entry; returns whether it was used. */
    onEscape: () => boolean;
  }
>(function ComputeComposer(
  { mode, onModeChange, onMathUnavailable, input, onInput, primary, onRun, onEscape },
  ref,
) {
  const mathRef = useRef<MathFieldHandle>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [keypad, setKeypad] = useState(keypadPreferred);
  const [mathReady, setMathReady] = useState(false);
  const empty = !input.trim();

  const focus = () => {
    if (mode === "math") mathRef.current?.focus();
    else textRef.current?.focus({ preventScroll: true });
  };
  useImperativeHandle(ref, () => ({
    focus,
    nextBox: () => mathRef.current?.nextBox(),
  }));

  const toggleKeypad = () => {
    rememberKeypad(!keypad);
    setKeypad(!keypad);
  };

  const label = OPERATION_LABELS[primary];
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs transition-colors focus-within:border-primary/50">
      <div className="relative">
        {mode === "math" ? (
          <MathField
            ref={mathRef}
            value={input}
            onChange={onInput}
            onSubmit={(latex) => latex.trim() && onRun(latex)}
            onEscape={onEscape}
            // No system keyboard comes up for a math field on a touch screen:
            // the keypad is the keyboard there, so focusing the field opens it.
            onFocus={() => coarsePointer() && setKeypad(true)}
            onReady={() => setMathReady(true)}
            onUnavailable={onMathUnavailable}
            label="Math input"
          />
        ) : (
          <textarea
            id="compute-input"
            ref={textRef}
            value={input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && hasModKey(event.nativeEvent)) {
                event.preventDefault();
                if (!empty) onRun();
              } else if (event.key === "Escape" && onEscape()) {
                // Stops the computation, or clears the result; the panel stays open.
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            rows={2}
            aria-label="Expression or equation (LaTeX or plain text)"
            aria-describedby="compute-reading"
            placeholder={
              "1/2 + 1/3,  x^2 - 5x + 6 = 0,  \\int_0^1 x^2 dx\nX ~ N(0, 1) on one line, P(X < 1) on the next"
            }
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="block min-h-16 w-full resize-y bg-transparent p-3 pr-9 font-mono text-xs leading-relaxed outline-none placeholder:text-muted-foreground/70 coarse:text-sm"
          />
        )}
        {!empty && (
          <button
            type="button"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              onInput("");
              focus();
            }}
            aria-label="Clear input"
            title="Clear input"
            className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-9 coarse:w-9"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 px-2 pb-2 pt-1">
        <div
          role="radiogroup"
          aria-label="Input"
          className="flex h-7 items-center rounded-md bg-muted p-0.5 coarse:h-9"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            onModeChange(mode === "math" ? "text" : "math");
          }}
        >
          {(["math", "text"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              tabIndex={mode === m ? 0 : -1}
              onClick={() => onModeChange(m)}
              title={
                m === "math" ? "Write math as it looks" : "Plain text or LaTeX, on several lines"
              }
              className={`h-full rounded-[5px] px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:px-3 ${
                mode === m
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "math" ? "Math" : "Text"}
            </button>
          ))}
        </div>
        {mode === "math" && (
          <button
            type="button"
            onPointerDown={(event) => event.preventDefault()}
            onClick={toggleKeypad}
            aria-pressed={keypad}
            aria-label="Math keyboard"
            title={keypad ? "Hide the math keyboard" : "Show the math keyboard"}
            className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-9 coarse:w-9 ${
              keypad
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <Keyboard className="h-4 w-4" />
          </button>
        )}
        {mode === "text" && (
          <span className="ml-auto text-2xs text-muted-foreground coarse:hidden">
            <kbd className="font-sans">{modKeyLabel}↵</kbd>
          </span>
        )}
        <button
          type="button"
          onPointerDown={(event) => mode === "math" && event.preventDefault()}
          onClick={() => onRun()}
          disabled={empty}
          aria-keyshortcuts={mode === "math" ? "Enter" : "Control+Enter Meta+Enter"}
          title={`${label} (${mode === "math" ? "Enter" : `${modKeyLabel}Enter`})`}
          className={`inline-flex h-7 items-center gap-1.5 rounded-md bg-foreground pl-2.5 pr-2 text-xs font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-35 coarse:h-9 coarse:px-3 ${
            mode === "text" ? "" : "ml-auto"
          }`}
        >
          {label}
          <CornerDownLeft className="h-3.5 w-3.5 opacity-70" aria-hidden />
        </button>
      </div>

      {mode === "math" && keypad && mathReady && (
        <MathKeypad
          onKey={(key, fromKeyboard) =>
            mathRef.current?.apply(key.action, { focus: !fromKeyboard })
          }
        />
      )}
    </div>
  );
});
