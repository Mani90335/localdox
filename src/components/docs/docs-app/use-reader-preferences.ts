import { useEffect, useMemo, useState } from "react";

import {
  isDarkTheme,
  loadPrefs,
  savePrefs,
  type ReadingFont,
  type ReadingMode,
  type ThemePref,
} from "@/lib/workspace/persistence";
import { loadReadingFont } from "@/lib/fonts/fonts";
import { restoreCustomFont } from "@/lib/fonts/custom-font";
import { loadGoogleFont } from "@/lib/fonts/google-font";
import { clearMathCache } from "@/services/math";
import type { MathPreferences, MathRendererType } from "@/services/math";

type Theme = ThemePref;

/**
 * Every reader-facing appearance preference: theme, typeface, reading mode,
 * math rendering, and the diagram/AI feature toggles. Grouped together
 * because they share one shape — read once from `loadPrefs()`, written back
 * through `savePrefs()` on change, several of them also published onto
 * `<html>` as attributes so CSS and deeply-nested components (a diagram, an
 * equation) can answer to them without a prop reaching that far down.
 *
 * Kept separate from file/workspace/pane state in `DocsApp`: none of this
 * reads or writes a document, a folder, or the persisted workspace record —
 * it is `localStorage`-only, one level below the workspace machinery.
 */
export function useReaderPreferences() {
  const [theme, setTheme] = useState<Theme>(() => loadPrefs().theme);
  const [readingMode, setReadingMode] = useState<ReadingMode>(() => loadPrefs().readingMode);
  const [readingFont, setReadingFont] = useState<ReadingFont>(() => loadPrefs().readingFont);
  const [googleFont, setGoogleFont] = useState<string | null>(() => loadPrefs().googleFont);
  const [diagramColors, setDiagramColors] = useState<boolean>(() => loadPrefs().diagramColors);
  const [diagramCamera, setDiagramCamera] = useState<boolean>(() => loadPrefs().diagramCamera);
  const [diagramFollowNumbers, setDiagramFollowNumbers] = useState<boolean>(
    () => loadPrefs().diagramFollowNumbers,
  );
  const [diagramNumbers, setDiagramNumbers] = useState<boolean>(() => loadPrefs().diagramNumbers);
  const [showEmbedMedia, setShowEmbedMedia] = useState(() => loadPrefs().showEmbedMedia);
  useEffect(() => {
    savePrefs({ showEmbedMedia });
  }, [showEmbedMedia]);
  const [aiEnabled, setAiEnabled] = useState<boolean>(() => loadPrefs().aiEnabled);
  const [mathRenderer, setMathRenderer] = useState<MathRendererType>(
    () => loadPrefs().mathRenderer,
  );
  const [mathNumbering, setMathNumbering] = useState<boolean>(() => loadPrefs().mathNumbering);
  const [mathExplorer, setMathExplorer] = useState<boolean>(() => loadPrefs().mathExplorer);
  const [contentWidth, setContentWidth] = useState<number>(() => loadPrefs().contentWidth);

  // Theme: apply to <html> and persist as a lightweight preference.
  // Apply the selected reader theme. All five themes are keyed by the
  // `data-theme` attribute; dark-based themes also carry the `.dark` class so
  // dark-only rules (code highlighting, katex, mermaid) keep working.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.classList.toggle("dark", isDarkTheme(theme));
  }, [theme]);

  // Reading typeface is keyed by `data-font`. The webfont itself is fetched
  // here rather than bundled into the app's stylesheet — the attribute applies
  // immediately against the system fallback and the real face swaps in when it
  // lands.
  useEffect(() => {
    document.documentElement.setAttribute("data-font", readingFont);
    loadReadingFont(readingFont);
  }, [readingFont]);

  // Semantic diagram colouring rides the same channel: a diagram sits deep
  // inside rendered markdown with no props reaching it, so it watches <html>.
  // Written as "off" rather than removed, so the attribute's absence during
  // first paint still means the default (on).
  useEffect(() => {
    document.documentElement.setAttribute("data-diagram-colors", diagramColors ? "on" : "off");
    savePrefs({ diagramColors });
  }, [diagramColors]);

  // The explainer camera rides the same channel, for the same reason.
  useEffect(() => {
    document.documentElement.setAttribute("data-diagram-camera", diagramCamera ? "on" : "off");
    savePrefs({ diagramCamera });
  }, [diagramCamera]);

  // Step order and step numbers ride the same channel.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-diagram-order", diagramFollowNumbers ? "numbered" : "auto");
    root.setAttribute("data-diagram-numbers", diagramNumbers ? "on" : "off");
    savePrefs({ diagramFollowNumbers, diagramNumbers });
  }, [diagramFollowNumbers, diagramNumbers]);

  // Turning AI off removes its surfaces rather than disabling them, so the
  // attribute is published for CSS as well as read through props.
  useEffect(() => {
    document.documentElement.setAttribute("data-ai", aiEnabled ? "on" : "off");
    savePrefs({ aiEnabled });
  }, [aiEnabled]);

  // A custom face lives in IndexedDB, so it has to be re-registered with the
  // FontFace API on every boot before `[data-font="custom"]` can resolve it.
  // If the file is gone (cleared storage, another device), fall back rather
  // than leaving the reader on a family that no longer exists.
  useEffect(() => {
    let cancelled = false;
    void restoreCustomFont().then((record) => {
      if (cancelled || record) return;
      setReadingFont((current) => (current === "custom" ? "hyperlegible" : current));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A Google family is only a stored *name*, so the stylesheet has to be
  // re-requested on every boot before `[data-font="google"]` can resolve it.
  // A family that no longer loads (offline, renamed upstream) falls back rather
  // than leaving the reader on a face that never arrives.
  useEffect(() => {
    if (!googleFont) return;
    let cancelled = false;
    void loadGoogleFont(googleFont).catch(() => {
      if (cancelled) return;
      setReadingFont((current) => (current === "google" ? "hyperlegible" : current));
    });
    return () => {
      cancelled = true;
    };
  }, [googleFont]);

  useEffect(() => {
    savePrefs({ theme });
  }, [theme]);

  useEffect(() => {
    savePrefs({ readingMode });
  }, [readingMode]);

  useEffect(() => {
    savePrefs({ mathRenderer, mathNumbering, mathExplorer });
  }, [mathRenderer, mathNumbering, mathExplorer]);

  useEffect(() => {
    savePrefs({ contentWidth });
  }, [contentWidth]);

  /**
   * Switching engines invalidates every rendered equation: the cache is keyed
   * by renderer preference, so the old entries are simply unreachable rather
   * than wrong — but dropping them keeps memory from holding two full sets.
   */
  useEffect(() => {
    clearMathCache();
  }, [mathRenderer]);

  /**
   * MathJax's accessibility explorer, turned on for the page when the reader
   * asks for it. It pulls in a speech-rule engine, which is why it is neither
   * the default nor loaded alongside MathJax itself.
   */
  useEffect(() => {
    if (!mathExplorer) return;
    // Imported here rather than at module scope: a static import would pull
    // MathJax's adapter — and with it the loader for a 1 MB engine — into the
    // initial bundle of every reader, math or no math.
    void import("@/services/math/adapters/mathjax")
      .then((module) => module.enableExplorer())
      .catch(() => {
        // Nothing to recover: expressions stay readable, they just aren't
        // keyboard-explorable. Surfacing a toast for it would be noise.
      });
  }, [mathExplorer]);

  /**
   * What the viewer passes to its math layer. Memoized because it crosses into
   * a memoized component — a fresh object here would re-render every document.
   */
  const mathPreferences = useMemo<MathPreferences>(
    () => ({ renderer: mathRenderer, numberEquations: mathNumbering }),
    [mathRenderer, mathNumbering],
  );

  useEffect(() => {
    savePrefs({ readingFont });
  }, [readingFont]);

  useEffect(() => {
    savePrefs({ googleFont });
  }, [googleFont]);

  const cycleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return {
    theme,
    setTheme,
    cycleTheme,
    readingMode,
    setReadingMode,
    readingFont,
    setReadingFont,
    googleFont,
    setGoogleFont,
    diagramColors,
    setDiagramColors,
    diagramCamera,
    setDiagramCamera,
    diagramFollowNumbers,
    setDiagramFollowNumbers,
    diagramNumbers,
    setDiagramNumbers,
    showEmbedMedia,
    setShowEmbedMedia,
    aiEnabled,
    setAiEnabled,
    mathRenderer,
    setMathRenderer,
    mathNumbering,
    setMathNumbering,
    mathExplorer,
    setMathExplorer,
    contentWidth,
    setContentWidth,
    mathPreferences,
  };
}
