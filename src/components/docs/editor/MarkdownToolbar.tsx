import { Paperclip, Sigma } from "lucide-react";
import type { FormatAction } from "@/lib/markdown/markdown-format";
import { TOOLBAR_GROUPS } from "@/lib/markdown/markdown-toolbar-items";

/**
 * The formatting toolbar above the markdown source editor.
 *
 * What it offers lives in `lib/markdown-toolbar-items` — this file is only the
 * row itself. Every button is a pure transform applied to the textarea's
 * current selection, so pressing one and typing its shortcut run the same code.
 */

const isApple = () =>
  typeof navigator !== "undefined" &&
  /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

/** "Mod+Shift+X" as the reader's own keyboard writes it. */
function shortcutLabel(shortcut: string): string {
  const apple = isApple();
  return shortcut
    .replace("Mod", apple ? "⌘" : "Ctrl")
    .replace("Alt", apple ? "⌥" : "Alt")
    .replace("Shift", apple ? "⇧" : "Shift")
    .replaceAll("+", apple ? "" : "+");
}

export function MarkdownToolbar({
  onAction,
  onAttach,
  onMath,
}: {
  onAction: (action: FormatAction) => void;
  onAttach?: () => void;
  /** Opens the math keyboard dialog. Separate from `onAction`: what it inserts
   *  comes from composing an expression in a dialog, not from a pure transform
   *  of the current selection. */
  onMath?: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      aria-controls="markdown-source"
      // Scrolls rather than wraps on a narrow screen: a toolbar that reflows to
      // two rows moves every button the moment the window changes, and the
      // reader loses the muscle memory that made it worth having.
      className="flex items-center gap-0.5 overflow-x-auto px-1 py-1 [scrollbar-none] [&::-webkit-scrollbar]:hidden"
    >
      {onAttach && (
        <button
          type="button"
          aria-label="Attach media or files"
          title="Attach media or files"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onAttach}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent coarse:h-11 coarse:w-11"
        >
          <Paperclip className="h-3.5 w-3.5" />
        </button>
      )}
      {onMath && (
        <button
          type="button"
          aria-label="Insert equation"
          title="Insert equation"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onMath}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent coarse:h-11 coarse:w-11"
        >
          <Sigma className="h-3.5 w-3.5" />
        </button>
      )}
      {TOOLBAR_GROUPS.map((group, index) => (
        <div key={index} className="flex items-center gap-0.5">
          {index > 0 && <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />}
          {group.map(({ icon: Icon, label, action, shortcut }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              title={shortcut ? `${label} (${shortcutLabel(shortcut)})` : label}
              // The textarea must keep both focus and its selection: a button
              // that steals focus would collapse the selection before the
              // action ever ran.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onAction(action)}
              // 28px is a comfortable mouse target and a poor thumb one. The
              // row already scrolls rather than wraps, so widening these on a
              // touch device costs nothing but a little more scrolling.
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-11 coarse:w-11"
            >
              <Icon className="h-3.5 w-3.5 coarse:h-4.5 coarse:w-4.5" />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
