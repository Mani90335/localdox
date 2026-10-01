import type { Components } from "react-markdown";
import { NoteCode, NotePre } from "./note-blocks";

/**
 * react-markdown renderers for notes, with remark-math parsing `$…$` (which,
 * with no rehype typesetter, arrives as `code.language-math`). A module
 * constant: a fresh object per render would remount every block.
 */
export const NOTE_COMPONENTS = { pre: NotePre, code: NoteCode } as Components;
