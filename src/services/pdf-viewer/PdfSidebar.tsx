import type { PDFPageProxy } from "pdfjs-dist";
import type { PdfReaderState } from "./use-pdf-reader-state";
import { PdfThumbnailList } from "./PdfThumbnailList";
import { PdfOutlineTree } from "./PdfOutlineTree";
import type { PdfOutlineResolver } from "./pdf-outline";

/** Thumbnails + outline/table-of-contents, docked left of the page area. */
export function PdfSidebar({
  reader,
  getPage,
  outlineResolver,
}: {
  reader: PdfReaderState;
  getPage: (pageNumber: number) => Promise<PDFPageProxy>;
  outlineResolver: PdfOutlineResolver;
}) {
  const hasOutline = reader.outline.length > 0;
  const tab = reader.sidebarTab === "outline" && hasOutline ? "outline" : "thumbnails";

  return (
    <aside className="pdf-sidebar flex w-56 shrink-0 flex-col border-r border-border bg-muted/20 sm:w-64">
      <div className="flex shrink-0 items-center gap-1 border-b border-border p-1.5">
        <SidebarTabButton
          active={tab === "thumbnails"}
          onClick={() => reader.setSidebarTab("thumbnails")}
        >
          Pages
        </SidebarTabButton>
        {hasOutline && (
          <SidebarTabButton
            active={tab === "outline"}
            onClick={() => reader.setSidebarTab("outline")}
          >
            Contents
          </SidebarTabButton>
        )}
      </div>
      {tab === "outline" ? (
        // Its own scroll container: it windows long lists by scroll position.
        <PdfOutlineTree
          outline={reader.outline}
          currentPage={reader.currentPage}
          onSelect={reader.goToPage}
          resolver={outlineResolver}
        />
      ) : (
        // Also its own scroll container, windowed by scroll position.
        <PdfThumbnailList
          numPages={reader.numPages ?? 0}
          currentPages={reader.visiblePages}
          getPage={getPage}
          onSelect={reader.goToPage}
        />
      )}
    </aside>
  );
}

function SidebarTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-7 flex-1 rounded-md text-xs font-medium transition-colors ${
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
