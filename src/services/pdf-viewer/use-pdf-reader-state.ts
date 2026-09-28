import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  getVisiblePages,
  nextPageIndex,
  prevPageIndex,
  type PdfLayoutMode,
} from "./pdf-book-pagination";
import { loadLastPage, saveLastPage, loadLayoutMode, saveLayoutMode } from "./pdf-last-page-store";
import type { PdfOutlineNode } from "./types";
import { clampZoom, ZOOM_STEP } from "./pdf-zoom";

/** Written to localStorage well after a flip settles, not on every page turn. */
const SAVE_DEBOUNCE_MS = 300;

export type PdfSidebarTab = "thumbnails" | "outline";
export type PdfRotation = 0 | 90 | 180 | 270;

export interface PdfReaderState {
  numPages: number | null;
  outline: PdfOutlineNode[];
  loadError: string | null;
  setNumPages: (n: number) => void;
  setOutline: (outline: PdfOutlineNode[]) => void;
  setLoadError: (message: string | null) => void;

  currentPage: number;
  visiblePages: number[];
  goNext: () => void;
  goPrev: () => void;
  goToPage: (page: number) => void;
  atStart: boolean;
  atEnd: boolean;

  layoutMode: PdfLayoutMode;
  /** False on mobile — the toolbar hides the spread toggle entirely then. */
  canSpread: boolean;
  toggleLayoutMode: () => void;

  zoom: number;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Multiplies the zoom by `factor`, within the zoom limits (pinch/wheel zoom). */
  zoomBy: (factor: number) => void;
  resetZoom: () => void;
  rotation: PdfRotation;
  rotate: () => void;

  sidebarOpen: boolean;
  sidebarTab: PdfSidebarTab;
  openSidebar: (tab?: PdfSidebarTab) => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  setSidebarTab: (tab: PdfSidebarTab) => void;

  /**
   * Whether the search panel is open. The query text itself lives in
   * `usePdfSearch` (it drives the scan), not here — the panel is UI
   * visibility, not search state.
   */
  searchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  toggleSearch: () => void;
}

/**
 * Everything the PDF toolbar and the lazy page renderer share, split out of
 * `PdfReader.tsx` so `DocumentViewer.tsx` can put toolbar controls in
 * `ViewerFrame`'s header slot and page canvases in its body slot from two
 * different components while both read and mutate one source of truth. Holds
 * no pdf.js objects itself — `PdfReader.tsx` reports document facts back in
 * through `setNumPages`/`setOutline`/`setLoadError` once it has actually
 * loaded something.
 */
export function usePdfReaderState(fileId: string): PdfReaderState {
  const isMobile = useIsMobile();

  const [numPages, setNumPages] = useState<number | null>(null);
  const [outline, setOutline] = useState<PdfOutlineNode[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(() => loadLastPage(fileId) ?? 1);
  const [storedLayoutMode, setStoredLayoutMode] = useState<PdfLayoutMode>(loadLayoutMode);
  // Mobile always reads single-page; the preference underneath is untouched so
  // returning to a wide screen restores whatever the reader chose there.
  const layoutMode: PdfLayoutMode = isMobile ? "single" : storedLayoutMode;

  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState<PdfRotation>(0);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<PdfSidebarTab>("thumbnails");

  const [searchOpen, setSearchOpen] = useState(false);

  // A new document resets per-view state, but not the persisted last-page /
  // layout preference — those are seeded fresh from storage below.
  const openFileId = useRef(fileId);
  useEffect(() => {
    if (openFileId.current === fileId) return;
    openFileId.current = fileId;
    setNumPages(null);
    setOutline([]);
    setLoadError(null);
    setCurrentPage(loadLastPage(fileId) ?? 1);
    setZoom(1);
    setRotation(0);
    setSidebarOpen(false);
    setSearchOpen(false);
  }, [fileId]);

  // A page saved from a previous, longer version of this same file could sit
  // past the end of what actually loaded.
  useEffect(() => {
    if (!numPages) return;
    setCurrentPage((page) => Math.min(Math.max(page, 1), numPages));
  }, [numPages]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(saveTimer.current ?? undefined), []);

  const goToPage = useCallback(
    (page: number) => {
      setCurrentPage((prev) => {
        const clamped = numPages ? Math.min(Math.max(page, 1), numPages) : Math.max(page, 1);
        if (clamped === prev) return prev;
        clearTimeout(saveTimer.current ?? undefined);
        saveTimer.current = setTimeout(() => saveLastPage(fileId, clamped), SAVE_DEBOUNCE_MS);
        return clamped;
      });
    },
    [fileId, numPages],
  );

  const goNext = useCallback(() => {
    if (numPages) goToPage(nextPageIndex(currentPage, layoutMode, numPages));
  }, [currentPage, layoutMode, numPages, goToPage]);

  const goPrev = useCallback(() => {
    if (numPages) goToPage(prevPageIndex(currentPage, layoutMode, numPages));
  }, [currentPage, layoutMode, numPages, goToPage]);

  const visiblePages = numPages
    ? getVisiblePages(currentPage, layoutMode, numPages)
    : [currentPage];

  const toggleLayoutMode = useCallback(() => {
    setStoredLayoutMode((mode) => {
      const next: PdfLayoutMode = mode === "single" ? "spread" : "single";
      saveLayoutMode(next);
      return next;
    });
  }, []);

  const zoomIn = useCallback(() => setZoom((z) => clampZoom(z * ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoom((z) => clampZoom(z / ZOOM_STEP)), []);
  const zoomBy = useCallback((factor: number) => setZoom((z) => clampZoom(z * factor)), []);
  const resetZoom = useCallback(() => setZoom(1), []);
  const rotate = useCallback(() => setRotation((r) => ((r + 90) % 360) as PdfRotation), []);

  const openSidebar = useCallback((tab?: PdfSidebarTab) => {
    if (tab) setSidebarTab(tab);
    setSidebarOpen(true);
  }, []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const toggleSearch = useCallback(() => setSearchOpen((open) => !open), []);

  return {
    numPages,
    outline,
    loadError,
    setNumPages,
    setOutline,
    setLoadError,
    currentPage,
    visiblePages,
    goNext,
    goPrev,
    goToPage,
    atStart: currentPage <= 1,
    atEnd: numPages ? visiblePages.includes(numPages) : false,
    layoutMode,
    canSpread: !isMobile,
    toggleLayoutMode,
    zoom,
    zoomIn,
    zoomOut,
    zoomBy,
    resetZoom,
    rotation,
    rotate,
    sidebarOpen,
    sidebarTab,
    openSidebar,
    closeSidebar,
    toggleSidebar,
    setSidebarTab,
    searchOpen,
    openSearch,
    closeSearch,
    toggleSearch,
  };
}
