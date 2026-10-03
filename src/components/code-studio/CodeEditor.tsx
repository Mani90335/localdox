import { useEffect, useRef } from "react";
import { Annotation, Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  drawSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { Language } from "@/services/code-studio/protocol";

const markLine = StateEffect.define<number>();
const externalUpdate = Annotation.define<boolean>();
const highlight = StateField.define({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects)
      if (effect.is(markLine))
        value =
          effect.value > 0 && effect.value <= tr.state.doc.lines
            ? Decoration.set([
                Decoration.line({ class: "cs-executing-line" }).range(
                  tr.state.doc.line(effect.value).from,
                ),
              ])
            : Decoration.none;
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function CodeEditor({
  source,
  language,
  line,
  onChange,
  onRun,
}: {
  source: string;
  language: Language;
  line: number;
  onChange: (source: string) => void;
  onRun: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onRun });
  callbacks.current = { onChange, onRun };
  const languageConfig = useRef(new Compartment());
  const initialSource = useRef(source);
  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initialSource.current,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          drawSelection(),
          history(),
          bracketMatching(),
          syntaxHighlighting(defaultHighlightStyle),
          highlight,
          languageConfig.current.of([]),
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                callbacks.current.onRun();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.contentAttributes.of({ "aria-label": "Code editor", spellcheck: "false" }),
          EditorView.updateListener.of((update) => {
            if (update.transactions.some((tr) => tr.docChanged && !tr.annotation(externalUpdate)))
              callbacks.current.onChange(update.state.doc.toString());
          }),
          EditorView.theme({
            "&": { height: "100%", fontSize: "13px", background: "transparent" },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily: "'JetBrains Mono', monospace",
              lineHeight: "1.9",
            },
            ".cm-content": { padding: "22px 0" },
            ".cm-gutters": {
              background: "transparent",
              border: "none",
              color: "#8e909a",
              paddingRight: "16px",
            },
            ".cm-activeLineGutter": { background: "transparent", color: "#db623e" },
            ".cm-line": { padding: "0 24px 0 0" },
            "&.cm-focused": { outline: "none" },
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== source)
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: source },
        annotations: externalUpdate.of(true),
      });
  }, [source]);
  useEffect(() => {
    let active = true;
    const name = language === "cpp" ? "C++" : language === "python" ? "Python" : "JavaScript";
    languages
      .find((l) => l.name === name)
      ?.load()
      .then((extension) => {
        if (active)
          view.current?.dispatch({ effects: languageConfig.current.reconfigure(extension) });
      });
    return () => {
      active = false;
    };
  }, [language]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const validLine = Math.min(line, editor.state.doc.lines);
    editor.dispatch({
      effects: [
        markLine.of(validLine),
        ...(validLine > 0
          ? [EditorView.scrollIntoView(editor.state.doc.line(validLine).from, { y: "nearest" })]
          : []),
      ],
    });
  }, [line]);
  return <div ref={host} className="cs-code-editor" />;
}
