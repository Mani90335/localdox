import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, isolateHistory } from "@codemirror/commands";
import {
  foldGutter,
  foldKeymap,
  foldedRanges,
  HighlightStyle,
  syntaxHighlighting,
  unfoldEffect,
} from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { tags } from "@lezer/highlight";
import type { EditState, FormatAction } from "@/lib/markdown/markdown-format";
import { loadMonoFont } from "@/lib/fonts/fonts";

export interface MarkdownSourceHandle {
  selection: () => EditState;
  select: (start: number, end: number) => void;
  format: (action: FormatAction) => void;
  focus: () => void;
}

const colors = HighlightStyle.define([
  { tag: tags.heading, color: "var(--code-key)", fontWeight: "bold" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "var(--code-key)", textDecoration: "underline" },
  { tag: [tags.processingInstruction, tags.meta, tags.punctuation], color: "var(--code-punct)" },
  { tag: [tags.keyword, tags.typeName, tags.tagName], color: "var(--code-key)" },
  { tag: [tags.string, tags.monospace], color: "var(--code-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--code-number)" },
  { tag: [tags.comment, tags.quote], color: "var(--muted-foreground)" },
]);

const theme = EditorView.theme({
  "&": {
    height: "70vh",
    minHeight: "20rem",
    resize: "vertical",
    overflow: "hidden",
    backgroundColor: "transparent",
    color: "var(--foreground)",
    fontSize: "0.875rem",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)", lineHeight: "1.625" },
  ".cm-content": { padding: "1rem 0", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0 1rem" },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    color: "var(--muted-foreground)",
    borderRight: "1px solid var(--border)",
  },
  ".cm-foldGutter .cm-gutterElement": { cursor: "pointer", padding: "0 0.35rem" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in oklab, var(--primary) 24%, transparent)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "0.25rem",
  },
});

/** Owns the editable document; React receives changes for journaling and autosave. */
export const MarkdownSource = forwardRef<
  MarkdownSourceHandle,
  { initialContent: string; onChange: (text: string) => void }
>(function MarkdownSource({ initialContent, onChange }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initial = useRef(initialContent);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useLayoutEffect(() => {
    if (!host.current) return;
    loadMonoFont();
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(colors),
          history(),
          drawSelection(),
          lineNumbers(),
          foldGutter(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            id: "markdown-source",
            "aria-label": "Markdown source",
            "aria-multiline": "true",
            spellcheck: "false",
          }),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      selection: () => {
        const view = viewRef.current;
        return {
          text: view?.state.doc.toString() ?? initial.current,
          start: view?.state.selection.main.from ?? 0,
          end: view?.state.selection.main.to ?? 0,
        };
      },
      select: (start, end) => {
        const view = viewRef.current;
        if (!view) return;
        const from = Math.max(0, Math.min(start, view.state.doc.length));
        const to = Math.max(from, Math.min(end, view.state.doc.length));
        const effects = [EditorView.scrollIntoView(from, { y: "center" })];
        // Inspect-source jumps must reveal a selection inside a folded section.
        foldedRanges(view.state).between(from, to, (a, b) => {
          effects.push(unfoldEffect.of({ from: a, to: b }));
        });
        view.dispatch({ selection: { anchor: from, head: to }, effects });
        view.focus();
      },
      format: (action) => {
        const view = viewRef.current;
        if (!view) return;
        const text = view.state.doc.toString();
        const selection = view.state.selection.main;
        const next = action({ text, start: selection.from, end: selection.to });
        // Change only the edited span so folds, history and mapped positions survive.
        let from = 0;
        while (from < text.length && from < next.text.length && text[from] === next.text[from])
          from++;
        let to = text.length;
        let end = next.text.length;
        while (to > from && end > from && text[to - 1] === next.text[end - 1]) {
          to--;
          end--;
        }
        view.dispatch({
          changes: { from, to, insert: next.text.slice(from, end) },
          selection: { anchor: next.start, head: next.end },
          scrollIntoView: true,
          userEvent: "input",
          annotations: isolateHistory.of("full"),
        });
        view.focus();
      },
      focus: () => viewRef.current?.focus(),
    }),
    [],
  );

  return <div ref={host} />;
});
