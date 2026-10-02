import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { loadMathlive, type MathfieldElement } from "@/lib/math-keyboard/load-mathlive";
import type { KeyAction } from "./math-keys";

export interface MathFieldHandle {
  /** Runs a key on the field; `focus` moves focus to the field as well. */
  apply: (action: KeyAction, options: { focus: boolean }) => void;
  focus: () => void;
  /** Selects the first empty box, if there is one. */
  nextBox: () => void;
}

interface Props {
  /** LaTeX. The field reports every edit, and follows changes made elsewhere. */
  value: string;
  onChange: (latex: string) => void;
  /** Enter, with the field's value as it is at that moment. */
  onSubmit: (latex: string) => void;
  /** Escape outside of LaTeX entry; returns whether it was used. */
  onEscape: () => boolean;
  onFocus?: () => void;
  /** The field is in place (and with it MathLive, which the keypad draws its keys with). */
  onReady: () => void;
  /** MathLive couldn't load (offline on first use, say). */
  onUnavailable: () => void;
  label: string;
}

/**
 * The Compute tab's math input: a MathLive `<math-field>`, so fractions,
 * powers and roots are written as they look. MathLive's own keyboard and
 * menu stay off; the tab's keypad drives the field instead (MathKeypad).
 *
 * MathLive loads lazily, shared with the editor's equation dialog (see
 * `loadMathlive`). Until it has, this is an empty box of the field's height.
 */
export const MathField = forwardRef<MathFieldHandle, Props>(function MathField(
  { value, onChange, onSubmit, onEscape, onFocus, onReady, onUnavailable, label },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<MathfieldElement | null>(null);
  const [ready, setReady] = useState(false);
  /** The last value the field reported, so its own edits aren't written back over the caret. */
  const reported = useRef(value);
  const props = useRef({ value, onChange, onSubmit, onEscape, onFocus, onUnavailable });
  useLayoutEffect(() => {
    props.current = { value, onChange, onSubmit, onEscape, onFocus, onUnavailable };
  });

  const report = (mf: MathfieldElement) => {
    const latex = mf.getValue("latex-unstyled");
    if (latex === reported.current) return;
    reported.current = latex;
    props.current.onChange(latex);
  };

  useEffect(() => {
    let disposed = false;
    loadMathlive().then(
      ({ MathfieldElement: Field }) => {
        const host = hostRef.current;
        if (disposed || !host) return;
        const mf = new Field();
        // The keypad below is the on-screen keyboard; MathLive's never shows.
        mf.mathVirtualKeyboardPolicy = "manual";
        mf.smartFence = true;
        // MathLive leaves a power after one digit, so 2^10 became 2¹·0;
        // leaveSimpleBranch leaves it at the next operator instead.
        mf.smartSuperscript = false;
        mf.placeholder = "\\text{Type or tap math}";
        mf.setAttribute("aria-label", label);
        mf.value = props.current.value;
        mf.addEventListener("input", () => report(mf));
        mf.addEventListener("focus", () => props.current.onFocus?.());
        // Capture: before MathLive's own handling (Escape would start LaTeX entry).
        mf.addEventListener(
          "keydown",
          (event) => {
            if (event.isComposing) return;
            if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
              event.preventDefault();
              event.stopPropagation();
              report(mf);
              props.current.onSubmit(mf.getValue("latex-unstyled"));
            } else if (event.key === "Escape" && mf.mode !== "latex" && props.current.onEscape()) {
              event.preventDefault();
              event.stopPropagation();
            } else if (LEAVING_KEYS.has(event.key) && !event.ctrlKey && !event.metaKey) {
              leaveSimpleBranch(mf);
            }
          },
          { capture: true },
        );
        host.appendChild(mf);
        // These need the field in the document ("Mathfield not mounted" otherwise).
        // Its menu offers colours and styles the engines can't read.
        mf.menuItems = [];
        // MathLive writes `:=` as \coloneq, which the advanced engine reads
        // as an assignment it can't run; \coloneqq is a definition.
        mf.inlineShortcuts = { ...mf.inlineShortcuts, ":=": "\\coloneqq" };
        reported.current = mf.getValue("latex-unstyled");
        fieldRef.current = mf;
        setReady(true);
        onReady();
      },
      () => {
        if (!disposed) props.current.onUnavailable();
      },
    );
    return () => {
      disposed = true;
      fieldRef.current?.remove();
      fieldRef.current = null;
    };
    // The field is made once; `label` and `onReady` are fixed for its life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A change made elsewhere (cleared, a result's input reused…): into the field.
  useEffect(() => {
    const mf = fieldRef.current;
    if (!mf || value === reported.current) return;
    reported.current = value;
    mf.setValue(value, { silenceNotifications: true });
  }, [value, ready]);

  useImperativeHandle(ref, () => ({
    apply(action, { focus }) {
      const mf = fieldRef.current;
      if (!mf) return;
      if (action.kind === "insert") {
        mf.insert(action.latex, {
          focus,
          selectionMode: "placeholder",
          scrollIntoView: true,
          feedback: false,
        });
      } else if (action.kind === "type") {
        if (focus) mf.focus();
        if (LEAVING_KEYS.has(action.text)) leaveSimpleBranch(mf);
        mf.executeCommand(["typedText", action.text, { focus, feedback: false }]);
      } else {
        if (focus) mf.focus();
        mf.executeCommand(action.command);
      }
      // Not every command reports itself as input; reading back is cheap.
      report(mf);
    },
    focus() {
      fieldRef.current?.focus();
    },
    nextBox() {
      const mf = fieldRef.current;
      if (!mf) return;
      mf.focus();
      // From the start, so the first empty box, even the one already selected.
      mf.executeCommand("moveToMathfieldStart");
      mf.executeCommand("moveToNextPlaceholder");
    },
  }));

  return <div ref={hostRef} className="compute-math-field min-h-14 px-3 pt-3 pb-1" />;
});

/** Typed at the end of a simple denominator, power, subscript or root, these leave it first. */
const LEAVING_KEYS = new Set(["+", "-", "=", "<", ">", ",", ";"]);

/** The parts of a structure that a keystroke can leave, by the structure's type. */
const LEAVABLE: Record<string, (type: string) => boolean> = {
  below: (type) => type === "genfrac",
  body: (type) => type === "surd",
  superscript: () => true,
  subscript: () => true,
};

/** Minimal view of MathLive's internal atoms; read defensively. */
interface Atom {
  type: string;
  value?: string;
  parent?: Atom;
  parentBranch?: string;
  isLastSibling?: boolean;
  branch?: (name: string) => Atom[] | undefined;
}

/**
 * Typed linearly, `1/2+1/3` means ½ + ⅓; but MathLive keeps the caret in a
 * denominator (or power, or root) until an arrow key moves it out, and makes
 * it 1/(2 + ⅓), quietly computing something else. So an operator typed at
 * the end of such a part leaves it first, when the part is simple: digits,
 * letters, a decimal point, a leading minus (2^10, e^{-x}, √2). Anything
 * richer stays as MathLive has it, and parentheses keep 1/(2+x) possible.
 *
 * MathLive has no public API for where the caret is in the structure, so
 * this reads its model; if that ever changes, typing is MathLive's own.
 */
function leaveSimpleBranch(mf: MathfieldElement) {
  try {
    const model = (
      mf as unknown as {
        _mathfield?: { model?: { position: number; anchor: number; at: (i: number) => Atom } };
      }
    )._mathfield?.model;
    if (!model || model.position !== model.anchor) return;
    const atom = model.at(model.position);
    const parent = atom?.parent;
    const branch = atom?.parentBranch;
    if (!parent || !branch || !LEAVABLE[branch]?.(parent.type) || !atom.isLastSibling) return;
    const content = (parent.branch?.(branch) ?? []).filter((a) => a.type !== "first");
    const simple =
      content.length > 0 &&
      content.every(
        (a, i) =>
          /^[\p{L}\p{N}.]$/u.test(a.value ?? "") ||
          (i === 0 && (a.value === "-" || a.value === "\u2212")),
      );
    if (simple) mf.executeCommand("moveAfterParent");
  } catch {
    // MathLive's internals moved: leave typing as MathLive has it.
  }
}
