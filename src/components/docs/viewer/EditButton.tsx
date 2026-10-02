import { Pencil } from "lucide-react";
import { preloadMarkdownEditor } from "../editor/MarkdownEditorLazy";

/**
 * The header's Edit control: an icon, because the pencil is universally read
 * as "edit" and the header is for the document, not for labels about it.
 */
export function EditButton({ onEdit }: { onEdit: () => void }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      // Hover is the moment to fetch the editor, so it is usually there by the
      // time the click lands.
      onPointerEnter={() => preloadMarkdownEditor()}
      onFocus={() => preloadMarkdownEditor()}
      aria-label="Edit"
      title="Edit"
      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-11 coarse:w-11"
    >
      <Pencil className="h-4 w-4" />
    </button>
  );
}
