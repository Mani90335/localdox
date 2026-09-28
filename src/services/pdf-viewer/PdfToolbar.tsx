import {
  BookOpen,
  Columns2,
  Maximize,
  Minimize,
  PanelLeft,
  PanelLeftClose,
  RotateCw,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { IconBtn } from "@/components/docs/viewer/viewer-controls";
import type { PdfReaderState } from "./use-pdf-reader-state";

/**
 * The PDF reader's header controls. Deliberately excludes a print button and
 * any cloud "save to Drive" affordance — every other control a full-featured
 * reader offers (zoom, rotate, layout, thumbnails/outline, search, download,
 * fullscreen) is here.
 */
export function PdfToolbar({
  reader,
  isFullscreen,
  onToggleFullscreen,
}: {
  file: MdFile;
  reader: PdfReaderState;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <IconBtn
        label={reader.sidebarOpen ? "Hide sidebar" : "Show thumbnails & outline"}
        onClick={reader.toggleSidebar}
        active={reader.sidebarOpen}
      >
        {reader.sidebarOpen ? (
          <PanelLeftClose className="h-4 w-4" />
        ) : (
          <PanelLeft className="h-4 w-4" />
        )}
      </IconBtn>
      <IconBtn label="Search in document" onClick={reader.toggleSearch} active={reader.searchOpen}>
        <Search className="h-4 w-4" />
      </IconBtn>

      <div className="mx-1 h-5 w-px bg-border" aria-hidden />

      <IconBtn label="Zoom out" onClick={reader.zoomOut}>
        <ZoomOut className="h-4 w-4" />
      </IconBtn>
      <button
        type="button"
        onClick={reader.resetZoom}
        title="Reset zoom"
        className="min-w-12 rounded-md px-1 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:text-foreground"
      >
        {Math.round(reader.zoom * 100)}%
      </button>
      <IconBtn label="Zoom in" onClick={reader.zoomIn}>
        <ZoomIn className="h-4 w-4" />
      </IconBtn>
      <IconBtn label="Rotate" onClick={reader.rotate}>
        <RotateCw className="h-4 w-4" />
      </IconBtn>

      {reader.canSpread && (
        <IconBtn
          label={
            reader.layoutMode === "spread" ? "Switch to single page" : "Switch to two-page spread"
          }
          onClick={reader.toggleLayoutMode}
          active={reader.layoutMode === "spread"}
        >
          {reader.layoutMode === "spread" ? (
            <Columns2 className="h-4 w-4" />
          ) : (
            <BookOpen className="h-4 w-4" />
          )}
        </IconBtn>
      )}

      <div className="mx-1 h-5 w-px bg-border" aria-hidden />

      <IconBtn
        label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        onClick={onToggleFullscreen}
      >
        {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
      </IconBtn>
    </div>
  );
}
