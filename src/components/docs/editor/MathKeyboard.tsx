import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { loadMathlive, type MathfieldElement } from "@/lib/math-keyboard/load-mathlive";

/**
 * The math keyboard: a `<math-field>` for typing LaTeX directly, with
 * MathLive's own on-screen keyboard available underneath it for readers who
 * would rather tap symbols than remember commands.
 *
 * MathLive is loaded lazily, on the first open — see `loadMathlive`. Until it
 * resolves the field is an empty box; on a warm cache that is imperceptible,
 * and on a cold one it is still faster than waiting for the reader to notice.
 */
export function MathKeyboard({
  open,
  onOpenChange,
  initialLatex = "",
  initialDisplay = false,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Seeds the field — e.g. the reader's own selection, if it looked like LaTeX. */
  initialLatex?: string;
  initialDisplay?: boolean;
  onInsert: (latex: string, display: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<MathfieldElement | null>(null);
  const [display, setDisplay] = useState(initialDisplay);
  const [empty, setEmpty] = useState(!initialLatex.trim());

  useEffect(() => {
    if (!open) return;
    setDisplay(initialDisplay);
    setEmpty(!initialLatex.trim());
    let disposed = false;
    void loadMathlive().then(({ MathfieldElement: Ctor }) => {
      if (disposed || !containerRef.current) return;
      const mf = new Ctor();
      mf.value = initialLatex;
      // The dialog's own Insert/Cancel are the exit; the keyboard's job is
      // only ever composing the expression, shown for as long as this dialog
      // is open rather than chasing focus in and out of the field.
      mf.mathVirtualKeyboardPolicy = "manual";
      mf.smartFence = true;
      mf.addEventListener("input", () => setEmpty(!mf.value.trim()));
      containerRef.current.appendChild(mf);
      fieldRef.current = mf;
      requestAnimationFrame(() => {
        mf.focus();
        window.mathVirtualKeyboard?.show({ animate: true });
      });
    });
    return () => {
      disposed = true;
      window.mathVirtualKeyboard?.hide({ animate: false });
      fieldRef.current?.remove();
      fieldRef.current = null;
    };
    // Re-seeded only by a fresh open, not by every keystroke landing in `initialLatex`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commit = () => {
    const latex = fieldRef.current?.value ?? "";
    if (!latex.trim()) return;
    onInsert(latex, display);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        onCloseAutoFocus={(event) => event.preventDefault()}
        // MathLive appends its on-screen keyboard straight to <body>, as a
        // sibling of this dialog rather than a child of it. Radix's own
        // outside-interaction dismissal has no way to know the keyboard
        // belongs to this dialog, so without this a tap on any key registers
        // as "outside" and closes the dialog mid-keystroke.
        onInteractOutside={(event) => {
          const target = event.target as Element | null;
          if (target?.closest(".ML__keyboard")) event.preventDefault();
        }}
      >
        <DialogTitle>Insert equation</DialogTitle>
        <DialogDescription>Type LaTeX, or use the math keyboard below the field.</DialogDescription>
        <div
          ref={containerRef}
          className="min-h-13 rounded-md border border-border bg-background px-3 py-2 [&_math-field]:block [&_math-field]:w-full [&_math-field]:text-lg [&_math-field]:outline-none"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={display}
            onChange={(e) => setDisplay(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          Display equation, on its own centred line
        </label>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-sm font-medium text-foreground transition-opacity hover:bg-muted/80 active:scale-95"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={empty}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 active:scale-95 disabled:opacity-40"
          >
            Insert
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
