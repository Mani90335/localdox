import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ESCAPE_DEPTH, useNavEscape } from "@/hooks/use-nav-history";
import { PdfBook, PdfToolbar, usePdfReaderState } from "@/services/pdf-viewer";
import { IconBtn } from "../viewer-controls";
import { ViewerFrame } from "./shared";
import type { Props } from "./shared";

export function PdfViewer({ file, prevFile, nextFile, onNavFile, onOpenPalette }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const reader = usePdfReaderState(file.id);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useNavEscape(isFullscreen, () => void document.exitFullscreen?.(), ESCAPE_DEPTH.mode);
  useNavEscape(reader.sidebarOpen, reader.closeSidebar, ESCAPE_DEPTH.panel);
  useNavEscape(reader.searchOpen, reader.closeSearch, ESCAPE_DEPTH.panel);

  return (
    <div ref={containerRef} className="bg-background">
      <ViewerFrame
        file={file}
        prevFile={prevFile}
        nextFile={nextFile}
        onNavFile={onNavFile}
        onOpenPalette={onOpenPalette}
        navAction={<PdfPageIndicator reader={reader} />}
        action={
          <PdfToolbar
            file={file}
            reader={reader}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() =>
              document.fullscreenElement
                ? void document.exitFullscreen?.()
                : containerRef.current?.requestFullscreen?.()
            }
          />
        }
      >
        <PdfBook file={file} reader={reader} />
      </ViewerFrame>
    </div>
  );
}

/** The current-page fact, in the header's `navAction` slot next to the search field. */
function PdfPageIndicator({ reader }: { reader: ReturnType<typeof usePdfReaderState> }) {
  const [draft, setDraft] = useState("");
  useEffect(() => setDraft(String(reader.currentPage)), [reader.currentPage]);
  if (!reader.numPages) return null;
  const commit = () => {
    const page = Number.parseInt(draft, 10);
    if (Number.isFinite(page)) reader.goToPage(page);
    else setDraft(String(reader.currentPage));
  };
  return (
    <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
      <IconBtn label="Previous page" onClick={reader.goPrev} disabled={reader.atStart}>
        <ChevronLeft className="h-4 w-4" />
      </IconBtn>
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.currentTarget.blur();
          }
        }}
        aria-label="Page number"
        className="h-7 w-10 rounded-md border border-border bg-background text-center tabular-nums outline-none focus:ring-2 focus:ring-primary/20"
      />
      <span aria-hidden>/ {reader.numPages}</span>
      <IconBtn label="Next page" onClick={reader.goNext} disabled={reader.atEnd}>
        <ChevronRight className="h-4 w-4" />
      </IconBtn>
    </div>
  );
}
