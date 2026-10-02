import { AttachmentPicker } from "./AttachmentPicker";
import { MathKeyboard } from "./MathKeyboard";
import type { MediaContext } from "@/lib/markdown/media-context";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import {
  forwardRef,
  memo,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Eye } from "lucide-react";
import { caretTop } from "@/lib/markdown/source-locate";
import { mathExpression, mathSeedFrom, type FormatAction } from "@/lib/markdown/markdown-format";
import { toolbarShortcut } from "@/lib/markdown/markdown-toolbar-items";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { DraftJournalContext } from "./draft-journal-context";
import { markEditorOpen } from "./open-editors";
import { hashText } from "@/lib/workspace/draft-journal";

const AUTOSAVE_MS = 600;

/**
 * The markdown source editor.
 *
 * The draft text used to be state on `MarkdownViewer`. Every keystroke
 * therefore re-rendered that entire component: the viewer header, the section
 * `<Select>` (which maps over every chunk in the document and word-counts each
 * one), the navigation footer and the saved-item context. Typing in a large
 * document was visibly behind the keyboard.
 *
 * The draft lives here now. A keystroke re-renders this component and nothing
 * else; the parent only hears about it on the debounced autosave.
 */

/** Imperative surface the viewer's "Inspect in source" jump drives. */
export interface MarkdownEditorHandle {
  /** Focus the textarea and select `[start, end)`, scrolled into view. */
  select: (start: number, end: number) => void;
}

interface Props {
  /** Source to edit. Read once per document — the editor owns it after that. */
  initialContent: string;
  /** Identity of the document being edited; remounts the draft when it changes. */
  fileId: string;
  /**
   * Debounced autosave, and the target of the Cmd/Ctrl+S shortcut.
   *
   * Takes the id of the document the text came from, not just the text. The
   * editor can be asked to save after the parent has already switched files —
   * the unmount flush below runs during that switch — and a save that only
   * carried content would land on whichever document happened to be active by
   * the time it arrived, overwriting it with the previous file's draft.
   */
  onSave: (fileId: string, content: string) => void;
  /** Leave the editor, keeping the current draft. Passes back the cursor's source index. */
  onDone: (cursorIndex?: number, content?: string) => void;
  /** Leave the editor, restoring `initialContent`. Passes back the cursor's source index. */
  onCancel: (cursorIndex?: number) => void;
  /** Shown when "Inspect in source" couldn't pin the text to a source span. */
  inspectMissed?: boolean;
  /**
   * Fired whenever the draft starts or stops differing from what the editor
   * opened with.
   *
   * The parent needs this to know whether leaving is destructive: navigating
   * away from an untouched editor should be silent, and only a draft with real
   * changes in it is worth stopping the reader for.
   */
  onDirtyChange?: (dirty: boolean) => void;
  /** Name of the document being edited, shown as a field above the source. */
  fileName?: string;
  /**
   * Rename the document. Omitted where renaming isn't on offer, in which case
   * the field is replaced by the plain autosave notice it used to be.
   *
   * A blank document is created as `new.md` and dropped straight into this
   * editor, which left naming it stranded in the sidebar's three-dots menu —
   * somewhere you had to leave the document to reach. The name belongs with
   * the text it names.
   */
  onRename?: (name: string) => void;
  mediaContext?: MediaContext;
  onImportAttachments?: (files: File[]) => Promise<MdFile[]>;
}

function MarkdownEditorImpl(
  {
    initialContent,
    fileId,
    onSave,
    onDone,
    onCancel,
    inspectMissed,
    onDirtyChange,
    fileName,
    onRename,
    mediaContext,
    onImportAttachments,
  }: Props,
  handleRef: React.Ref<MarkdownEditorHandle>,
) {
  // The draft and the document it belongs to are one piece of state, set
  // together and read together.
  //
  // They used to be separate — `draft` here, `fileId` arriving as a prop — and
  // that is what lost documents. This component is not remounted on a file
  // switch when the parent reuses the instance, so for one commit `draft` still
  // held the previous document's text while `fileId` had already become the new
  // one. Any save firing in that window paired one file's text with another
  // file's id and overwrote it. Keeping them in a single object makes that pair
  // impossible to form: every save checks that the draft's own id still matches
  // the document being edited, and drops the write if it doesn't.
  const [draft, setDraft] = useState(() => ({ fileId, text: initialContent }));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const setText = useCallback(
    (text: string | ((previous: string) => string)) =>
      setDraft((previous) => ({
        ...previous,
        text: typeof text === "function" ? text(previous.text) : text,
      })),
    [],
  );

  // Read by the shortcut and the unmount flush, so neither has to be rebuilt
  // (and re-bound) on every keystroke.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  // The window-level Cmd/Ctrl+S handler is bound once, so it reads the live id
  // through a ref rather than closing over the prop from its first render.
  const fileIdRef = useRef(fileId);
  fileIdRef.current = fileId;

  // Switching documents re-seeds the draft. `fileId` rather than
  // `initialContent`, so the parent echoing an autosave back doesn't clobber
  // whatever has been typed since.
  useEffect(() => {
    setDraft({ fileId, text: initialContent });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  // Changes made to this document from elsewhere wait while it is open here.
  useEffect(() => markEditorOpen(fileId), [fileId]);

  useImperativeHandle(
    handleRef,
    () => ({
      select: (start, end) => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(start, end);
        ta.scrollTop = Math.max(0, caretTop(ta, start) - ta.clientHeight / 3);
        ta.scrollIntoView({ behavior: "smooth", block: "center" });
      },
    }),
    [],
  );

  // Set when the reader cancels, to stop the unmount flush below from writing
  // the abandoned draft back over the content the parent just restored.
  const cancelledRef = useRef(false);

  // Tell the parent whether there is anything to lose. Held in a ref so an
  // inline callback from the parent doesn't re-run this on every keystroke, and
  // reported only on a transition rather than on every edit.
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  const dirty = draft.fileId === fileId && draft.text !== initialContent;
  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);
  // Leaving the editor entirely is not "unsaved work" — whatever happens on the
  // way out (a flush, a cancel, a save) has already been decided by then.
  useEffect(() => {
    return () => onDirtyChangeRef.current?.(false);
  }, []);

  // Autosave. Each of these re-renders the parent's file list, so the pause is
  // deliberately longer than a fast typist's gap between keystrokes.
  useEffect(() => {
    // A draft belonging to the document we just left is not this document's
    // text. The re-seed effect above is about to replace it; saving in the
    // meantime is what wrote one file's content over another's.
    if (draft.fileId !== fileId) return;
    if (draft.text === initialContent) return;
    const target = draft.fileId;
    const text = draft.text;
    const t = setTimeout(() => onSaveRef.current(target, text), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [draft, initialContent, fileId]);

  // Journal every change synchronously-durable (see draft-journal.ts), so a tab
  // closed inside the autosave window — or before the app's own write lands —
  // can offer the text back on the next load. The base is what this document
  // held when the editor opened; the journal re-bases it after each commit.
  const drafts = useContext(DraftJournalContext);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const fileNameRef = useRef(fileName);
  fileNameRef.current = fileName;
  const [openedBase] = useState(() => hashText(initialContent));
  useEffect(() => {
    const context = draftsRef.current;
    if (!context?.workspaceId) return;
    if (draft.fileId !== fileId || draft.text === initialContent) return;
    context.journal.stage({
      workspaceId: context.workspaceId,
      fileId: draft.fileId,
      fileName: fileNameRef.current ?? draft.fileId,
      text: draft.text,
      base: openedBase,
    });
    context.schedule();
  }, [draft, initialContent, fileId, openedBase]);

  // Don't lose the tail of a burst of typing when the editor closes between the
  // last keystroke and the autosave firing.
  //
  // This is the flush that used to lose documents. It runs *during* a file
  // switch, after the parent has re-rendered with the new document, so the id
  // is captured on the way in and the content is written back to the file it
  // was actually typed into.
  useEffect(() => {
    const target = fileId;
    const openedWith = initialContent;
    return () => {
      if (cancelledRef.current) return;
      const pending = draftRef.current;
      // Same guard as the autosave: flush only a draft that still belongs to
      // the document this effect was set up for.
      if (pending.fileId !== target) return;
      if (pending.text !== openedWith) onSaveRef.current(target, pending.text);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const pending = draftRef.current;
        if (pending.fileId !== fileIdRef.current) return;
        onSaveRef.current(pending.fileId, pending.text);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * Run a formatting action against the live selection.
   *
   * The new selection is written back in the same frame as the text, so the
   * reader never sees the caret jump to the end and come back. `setSelectionRange`
   * has to wait for React to commit the new value — setting it against the old
   * text would place it by the wrong offsets.
   */
  const applyFormat = useCallback(
    (action: FormatAction) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const next = action({ text: ta.value, start: ta.selectionStart, end: ta.selectionEnd });
      if (
        next.text === ta.value &&
        next.start === ta.selectionStart &&
        next.end === ta.selectionEnd
      ) {
        return;
      }
      setText(next.text);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus({ preventScroll: true });
        el.setSelectionRange(next.start, next.end);
      });
    },
    [setText],
  );

  // Formatting shortcuts. Bound on the textarea rather than the window: these
  // are edits to *this* field, and a global binding would fire while the reader
  // was typing in the search box or a rename input.
  const onShortcut = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const item = toolbarShortcut(event);
      if (!item) return;
      event.preventDefault();
      applyFormat(item.action);
    },
    [applyFormat],
  );

  const [attaching, setAttaching] = useState(false);
  const attachmentSelection = useRef({ start: 0, end: 0 });
  const openAttachments = () => {
    const textarea = textareaRef.current;
    attachmentSelection.current = {
      start: textarea?.selectionStart ?? 0,
      end: textarea?.selectionEnd ?? 0,
    };
    setAttaching(true);
  };
  const insertAttachment = (markdown: string) =>
    applyFormat(({ text }) => {
      const { start, end } = attachmentSelection.current;
      const insertion = `\n\n${markdown}\n\n`;
      return {
        text: text.slice(0, start) + insertion + text.slice(end),
        start: start + insertion.length,
        end: start + insertion.length,
      };
    });

  const [mathOpen, setMathOpen] = useState(false);
  const mathSelection = useRef({ start: 0, end: 0 });
  const [mathSeed, setMathSeed] = useState({ latex: "", display: false });
  const openMath = () => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? 0;
    const end = textarea?.selectionEnd ?? 0;
    mathSelection.current = { start, end };
    setMathSeed(mathSeedFrom(textarea?.value.slice(start, end) ?? ""));
    setMathOpen(true);
  };
  const insertMath = (latex: string, display: boolean) =>
    applyFormat(({ text }) => mathExpression(latex, display)({ text, ...mathSelection.current }));

  // The name is edited locally and committed on blur or Enter, not on every
  // keystroke: renaming re-derives the document's kind from its extension, and
  // doing that mid-word would route the reader through a different viewer for
  // each letter they typed.
  const [nameDraft, setNameDraft] = useState(fileName ?? "");
  useEffect(() => {
    setNameDraft(fileName ?? "");
  }, [fileName, fileId]);

  const commitName = useCallback(() => {
    const next = nameDraft.trim();
    if (!next || next === fileName) {
      setNameDraft(fileName ?? "");
      return;
    }
    onRename?.(next);
  }, [nameDraft, fileName, onRename]);

  const onNameKey = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitName();
        textareaRef.current?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        // Stop here rather than letting the app's Escape handling also read
        // this as "leave the editor" — abandoning a rename is its own step.
        event.stopPropagation();
        setNameDraft(fileName ?? "");
        event.currentTarget.blur();
      }
    },
    [commitName, fileName],
  );

  const cancel = useCallback(() => {
    // Order matters: the flag has to be set before the parent unmounts this
    // component, or the cleanup above would re-save the discarded draft.
    cancelledRef.current = true;
    // An abandoned draft is not something to offer back after a reload.
    const context = draftsRef.current;
    if (context?.workspaceId) context.journal.discard(context.workspaceId, draftRef.current.fileId);
    setText(initialContent);
    onCancel(textareaRef.current?.selectionStart);
  }, [initialContent, onCancel, setText]);

  return (
    <div>
      {/* Sticky exit bar: leaving edit mode stays reachable no matter how far
          the reader scrolls. Single-pane editor keeps typing smooth — no live
          full-document re-render on every keystroke. */}
      <div className="sticky top-16 z-(--z-sticky) -mx-1 mb-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-background/90 px-3 py-2">
        <div className="min-w-0 flex-1">
          {onRename ? (
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={onNameKey}
              spellCheck={false}
              aria-label="Document name"
              placeholder="Untitled.md"
              className="w-full max-w-xs truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium text-foreground outline-none transition-colors hover:border-border focus:border-primary/50 focus:bg-background coarse:min-h-11"
            />
          ) : (
            <span className="truncate text-xs font-medium text-muted-foreground">
              Editing — changes save automatically
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={cancel}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition-opacity hover:bg-muted/80 active:scale-95 coarse:min-h-11 coarse:px-4"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const pending = draftRef.current;
              onSaveRef.current(pending.fileId, pending.text);
              onDone(textareaRef.current?.selectionStart, pending.text);
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 active:scale-95 coarse:min-h-11 coarse:px-4"
          >
            <Eye className="h-3.5 w-3.5" /> Done · Preview
          </button>
        </div>
      </div>
      {inspectMissed && (
        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
          Couldn't pin that text to a spot in the source — the editor is open at the start of this
          section instead.
        </div>
      )}
      {/* Toolbar and field are one surface: the buttons act on the text
          directly below them, and a gap between the two would read as chrome
          belonging to the page rather than to this field.

          The toolbar is a plain header pinned to the top of that surface, not a
          sticky element. It was sticky once, which was wrong twice over: the
          offset had to guess the exit bar's height, and `position: sticky` does
          nothing useful inside this `overflow-hidden` box, which is not itself
          a scroll container — the row simply parked partway down the field. The
          editor scrolls as part of the page, so the header travels with it. */}
      {mediaContext && (
        <AttachmentPicker
          open={attaching}
          onOpenChange={setAttaching}
          context={mediaContext}
          onInsert={insertAttachment}
          onImport={onImportAttachments}
        />
      )}
      <MathKeyboard
        open={mathOpen}
        onOpenChange={setMathOpen}
        initialLatex={mathSeed.latex}
        initialDisplay={mathSeed.display}
        onInsert={insertMath}
      />
      <div className="overflow-hidden rounded-lg border border-border bg-muted/30 focus-within:border-primary/50">
        <div className="border-b border-border bg-background/90">
          <MarkdownToolbar
            onAction={applyFormat}
            onAttach={mediaContext ? openAttachments : undefined}
            onMath={openMath}
          />
        </div>
        <textarea
          id="markdown-source"
          ref={textareaRef}
          value={draft.text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onShortcut}
          spellCheck={false}
          className="min-h-[70vh] w-full resize-y bg-transparent p-4 font-mono text-sm leading-relaxed outline-none"
        />
      </div>
    </div>
  );
}

export const MarkdownEditor = memo(forwardRef<MarkdownEditorHandle, Props>(MarkdownEditorImpl));
