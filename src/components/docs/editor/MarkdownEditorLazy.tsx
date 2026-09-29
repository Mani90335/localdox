import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { deferredModule } from "@/lib/app/deferred-module";
import type { MarkdownEditor as Editor, MarkdownEditorHandle } from "./MarkdownEditor";

/**
 * The Markdown source editor, loaded when someone starts editing.
 *
 * Most visits only read, so the editor (toolbar, attachment picker, math
 * keyboard, formatting commands) stays out of the reader's download. Opening a
 * file's menu, creating a document or choosing Edit calls
 * `preloadMarkdownEditor`, so the download usually finishes before the editor
 * is needed. Precached with the offline shell (see vite.config.ts).
 */
const editor = deferredModule(() => import("./MarkdownEditor"));

/** Starts the editor's download without waiting for it. */
export const preloadMarkdownEditor = editor.preload;

/** Holds the editor's place while it downloads; hidden for the first moments
 *  so a cached load doesn't flash. */
function EditorPlaceholder() {
  return (
    <div
      role="status"
      aria-label="Opening editor"
      className="min-h-[50vh] rounded-lg border border-border bg-muted/30 animate-in fade-in fill-mode-both duration-300 delay-300"
    />
  );
}

export type { MarkdownEditorHandle };

export const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  ComponentPropsWithoutRef<typeof Editor>
>(function MarkdownEditor(props, ref) {
  const mod = editor.useModule();
  if (!mod) return <EditorPlaceholder />;
  return <mod.MarkdownEditor ref={ref} {...props} />;
});
