import {
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { mathExpression, mathSeedFrom, type FormatAction } from "@/lib/markdown/markdown-format";
import { toolbarShortcut } from "@/lib/markdown/markdown-toolbar-items";
import { hashText } from "@/lib/workspace/draft-journal";
import { hasModKey } from "@/lib/platform/keyboard";
import {
  MAX_SCRATCHPAD_CHARS,
  scratchpadDraftId,
  type Scratchpad,
} from "@/lib/workspace/rough-work";
import { MarkdownToolbar } from "../editor/MarkdownToolbar";
import { MathKeyboard } from "../editor/MathKeyboard";
import { DraftJournalContext } from "../editor/draft-journal-context";

/** Pause after typing before the text is handed to the workspace. */
const AUTOSAVE_MS = 500;

export interface ScratchpadEditorHandle {
  /** Hand any pending text to the workspace now; returns the live text. */
  flush: () => string;
  /** The live text and selection, for actions on "what is selected". */
  read: () => { text: string; start: number; end: number };
  focus: () => void;
}

interface Props {
  pad: Scratchpad;
  /** Debounced: the pad's text, for the workspace to store. */
  onChange: (id: string, content: string) => void;
  /** Whether the field holds text the workspace hasn't received yet. */
  onDirtyChange?: (dirty: boolean) => void;
  /** The live text, for the preview — every change, not debounced. */
  onTextChange?: (text: string) => void;
  /** Whether the selection is empty, for labelling actions "selection" or "pad". */
  onSelectionChange?: (hasSelection: boolean) => void;
}

/**
 * The rough-work field: Markdown source with the document editor's toolbar,
 * shortcuts and math keyboard.
 *
 * Mounted once per pad (keyed by id), so a draft can never be saved into a
 * different pad than it was typed into. Like the document editor it keeps its
 * draft to itself while typing: a keystroke re-renders this component only,
 * and the workspace hears about it after a pause. Every change is journalled
 * (draft-journal.ts), so a tab closed inside that pause offers the text back.
 */
export const ScratchpadEditor = forwardRef<ScratchpadEditorHandle, Props>(function ScratchpadEditor(
  { pad, onChange, onDirtyChange, onTextChange, onSelectionChange },
  ref,
) {
  const [text, setText] = useState(pad.content);
  const textRef = useRef(text);
  textRef.current = text;
  // The last text this field handed up. The pad echoing it back is not a
  // change; anything else arriving is (a Clear, an Undo, another tab).
  const sentRef = useRef(pad.content);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const fieldId = `scratchpad-${pad.id}`;

  const drafts = useContext(DraftJournalContext);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  // What the workspace holds for this pad: the version a journalled draft is
  // typed against. Taken from the pad as it is now, not as it was when the
  // field opened, so work typed after an autosave restores in place.
  const base = useMemo(() => hashText(pad.content), [pad.content]);

  // Replaced from outside: the field takes the new text in this same render.
  // Done during render rather than in an effect so that no effect ever sees
  // the new pad with the old text; one did, and journalled the old text as a
  // fresh draft that a reload then offered back over the restored work.
  const [held, setHeld] = useState(pad.content);
  const [replaced, setReplaced] = useState(0);
  if (pad.content !== held) {
    setHeld(pad.content);
    if (pad.content !== sentRef.current) {
      sentRef.current = pad.content;
      setText(pad.content);
      setReplaced((n) => n + 1);
    }
  }
  // …and the replaced draft is forgotten, so it isn't offered back later.
  useLayoutEffect(() => {
    if (!replaced) return;
    const context = draftsRef.current;
    if (context?.workspaceId)
      context.journal.discard(context.workspaceId, scratchpadDraftId(pad.id));
  }, [replaced, pad.id]);

  const send = useCallback(() => {
    const pending = textRef.current;
    if (pending === sentRef.current) return;
    sentRef.current = pending;
    onChangeRef.current(pad.id, pending);
  }, [pad.id]);

  // What the workspace already holds needs neither journalling nor saving.
  const dirty = text !== pad.content;
  useEffect(() => {
    onTextChange?.(text);
    if (!dirty) return;
    const context = draftsRef.current;
    if (context?.workspaceId) {
      context.journal.stage({
        workspaceId: context.workspaceId,
        fileId: scratchpadDraftId(pad.id),
        fileName: `${pad.title} (rough work)`,
        text,
        base,
      });
      context.schedule();
    }
    const timer = setTimeout(send, AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // The title only labels the journal entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, dirty, send, base, pad.id]);

  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  // Leaving (another pad, another tab, the panel closing) keeps the tail of
  // whatever was typed.
  useEffect(
    () => () => {
      send();
      onDirtyChangeRef.current?.(false);
    },
    [send],
  );

  useImperativeHandle(
    ref,
    () => ({
      flush: () => {
        send();
        return textRef.current;
      },
      read: () => {
        const field = fieldRef.current;
        return {
          text: textRef.current,
          start: field?.selectionStart ?? 0,
          end: field?.selectionEnd ?? 0,
        };
      },
      focus: () => fieldRef.current?.focus(),
    }),
    [send],
  );

  const applyFormat = useCallback((action: FormatAction) => {
    const field = fieldRef.current;
    if (!field) return;
    const next = action({
      text: field.value,
      start: field.selectionStart,
      end: field.selectionEnd,
    });
    if (next.text.length > MAX_SCRATCHPAD_CHARS) return;
    setText(next.text);
    requestAnimationFrame(() => {
      const el = fieldRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(next.start, next.end);
    });
  }, []);

  const [mathOpen, setMathOpen] = useState(false);
  const mathSelection = useRef({ start: 0, end: 0 });
  const [mathSeed, setMathSeed] = useState({ latex: "", display: false });
  const openMath = () => {
    const field = fieldRef.current;
    const start = field?.selectionStart ?? 0;
    const end = field?.selectionEnd ?? 0;
    mathSelection.current = { start, end };
    setMathSeed(mathSeedFrom(field?.value.slice(start, end) ?? ""));
    setMathOpen(true);
  };
  const insertMath = (latex: string, display: boolean) =>
    applyFormat(({ text: value }) =>
      mathExpression(latex, display)({ text: value, ...mathSelection.current }),
    );

  // Grows with its text up to a point, then scrolls: the preview below it
  // should stay reachable without scrolling past a wall of source.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(Math.max(field.scrollHeight + 2, 160), 420)}px`;
  }, [text]);

  // Native events rather than React's onSelect, which misses a selection set
  // by script (and so by tools that set it that way).
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const report = () => {
      if (document.activeElement !== field) return;
      onSelectionChangeRef.current?.(field.selectionStart !== field.selectionEnd);
    };
    field.addEventListener("select", report);
    document.addEventListener("selectionchange", report);
    return () => {
      field.removeEventListener("select", report);
      document.removeEventListener("selectionchange", report);
    };
  }, []);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/30 focus-within:border-primary/50">
      <MathKeyboard
        open={mathOpen}
        onOpenChange={setMathOpen}
        initialLatex={mathSeed.latex}
        initialDisplay={mathSeed.display}
        onInsert={insertMath}
      />
      <div className="border-b border-border bg-background/90">
        <MarkdownToolbar onAction={applyFormat} onMath={openMath} controls={fieldId} />
      </div>
      <textarea
        id={fieldId}
        ref={fieldRef}
        value={text}
        maxLength={MAX_SCRATCHPAD_CHARS}
        onChange={(e) => setText(e.target.value)}
        // Leaving the field (for the sidebar, another workspace) hands the
        // text over now rather than after the pause.
        onBlur={send}
        onKeyDown={(event) => {
          if (event.key.toLowerCase() === "s" && hasModKey(event.nativeEvent)) {
            // Saved now, not offered as a web page download.
            event.preventDefault();
            send();
            return;
          }
          const item = toolbarShortcut(event);
          if (!item) return;
          event.preventDefault();
          applyFormat(item.action);
        }}
        aria-label={`${pad.title} (Markdown, with $…$ for math)`}
        placeholder={
          "Work it out here. Markdown, with $…$ and $$…$$ for math.\n\n$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$"
        }
        spellCheck={false}
        className="block w-full resize-y bg-transparent p-3 font-mono text-xs leading-relaxed outline-none placeholder:text-muted-foreground/70 coarse:text-sm"
      />
    </div>
  );
});
