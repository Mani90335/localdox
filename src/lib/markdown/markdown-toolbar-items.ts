// What the markdown toolbar offers, and in what order.
//
// Kept out of the component file so both the toolbar and the editor's shortcut
// handler can import it without either one dragging the other's module in —
// and so the component file exports only a component, which is what keeps fast
// refresh working during development.

import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  SquareCode,
  Strikethrough,
  Workflow,
} from "lucide-react";
import type { FormatAction } from "./markdown-format";
import * as md from "./markdown-format";

/** One button: what it looks like, what it does, and how else to reach it. */
export interface ToolbarItem {
  icon: typeof Bold;
  label: string;
  action: FormatAction;
  /** Rendered into the tooltip, and bound by the editor. Display form. */
  shortcut?: string;
}

/**
 * The groups, in the order they appear.
 *
 * Everyday actions only. Markdown has plenty more — footnotes, tables,
 * definition lists, admonitions — but a toolbar that offers everything is one
 * nobody can scan, and the reader editing a document is writing prose, not
 * reaching for a table of contents. Anything not here is still one keystroke
 * away in the source, which is the whole point of editing markdown.
 *
 * Grouped by what each action does to the document — inline emphasis, headings,
 * lists, blocks, references — so the row reads as five short lists rather than
 * one wall of fourteen icons.
 *
 * Only shortcuts that are already standard somewhere are offered. Inventing a
 * chord for, say, a horizontal rule buys nothing: nobody would guess it, and
 * the tooltip would be advertising a keystroke the reader has to memorise
 * rather than one they already know.
 */
export const TOOLBAR_GROUPS: ToolbarItem[][] = [
  [
    { icon: Bold, label: "Bold", action: md.bold, shortcut: "Mod+B" },
    { icon: Italic, label: "Italic", action: md.italic, shortcut: "Mod+I" },
    {
      icon: Strikethrough,
      label: "Strikethrough",
      action: md.strikethrough,
      shortcut: "Mod+Shift+X",
    },
  ],
  [
    { icon: Heading1, label: "Heading 1", action: md.heading(1), shortcut: "Mod+Alt+1" },
    { icon: Heading2, label: "Heading 2", action: md.heading(2), shortcut: "Mod+Alt+2" },
    { icon: Heading3, label: "Heading 3", action: md.heading(3), shortcut: "Mod+Alt+3" },
  ],
  [
    { icon: List, label: "Bulleted list", action: md.bulletList, shortcut: "Mod+Shift+8" },
    { icon: ListOrdered, label: "Numbered list", action: md.numberedList, shortcut: "Mod+Shift+7" },
    { icon: ListChecks, label: "Checklist", action: md.checklist },
  ],
  [
    { icon: Quote, label: "Blockquote", action: md.blockquote, shortcut: "Mod+Shift+." },
    { icon: Code, label: "Inline code", action: md.inlineCode, shortcut: "Mod+E" },
    { icon: SquareCode, label: "Code block", action: md.codeBlock, shortcut: "Mod+Alt+C" },
    { icon: Workflow, label: "Mermaid diagram", action: md.mermaidBlock, shortcut: "Mod+Alt+M" },
  ],
  [
    { icon: Link, label: "Link", action: md.link, shortcut: "Mod+K" },
    { icon: Image, label: "Image", action: md.image },
    { icon: Minus, label: "Horizontal rule", action: md.horizontalRule },
  ],
];

/** Every item, flattened — the editor binds shortcuts off this. */
export const TOOLBAR_ITEMS: ToolbarItem[] = TOOLBAR_GROUPS.flat();
