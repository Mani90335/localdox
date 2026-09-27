import { useEffect, useState } from "react";
import {
  BookOpen,
  Columns2,
  Download,
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
import { dataUrlToBlob } from "@/lib/markdown/document-utils";
import { IconBtn } from "@/components/docs/viewer/viewer-controls";
import type { PdfReaderState } from "./use-pdf-reader-state";

/**
 * The PDF reader's header controls. Deliberately excludes a print button and
 * any cloud "save to Drive" affordance — every other control a full-featured
 * reader offers (zoom, rotate, layout, thumbnails/outline, search, download,
 * fullscreen) is here.
 */
export function PdfToolbar({
  file,
  reader,
  isFullscreen,
  onToggleFullscreen,
}: {
  file: MdFile;
  reader: PdfReaderState;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const downloadUrl = useObjectUrl(file.data);

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
      {downloadUrl && (
        <a
          href={downloadUrl}
          download={file.name}
          title="Download"
          aria-label="Download"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Download className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}

/** A revoked-on-change object URL for the file's raw bytes, used by Download. */
function useObjectUrl(dataUrl: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const blob = dataUrlToBlob(dataUrl, "application/pdf");
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [dataUrl]);
  return url;
}
