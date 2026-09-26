// The read-only half of the board story.
//
// `Board` is the editor a board file opens in; this is the figure a document
// embeds. They deliberately do not share a component: the editor carries
// autosave, debounce and a flush-on-unmount path, none of which can exist here,
// and folding both into one component behind an `editable` flag would put a
// save path one wrong prop away from a file the reader never opened.

import { useEffect, useMemo, useState, type ComponentType } from "react";
import "./board.css";

/**
 * Excalidraw is imported inside an effect, never at module scope — it reads
 * `navigator.platform` and `"netscape" in window` while its own module is being
 * defined, so evaluating it during prerender throws `window is not defined`.
 * `./Board` documents this at length; the same constraint applies here.
 */
type ExcalidrawModule = typeof import("@excalidraw/excalidraw");

function useExcalidrawModule() {
  const [module, setModule] = useState<ExcalidrawModule | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [mod] = await Promise.all([
        import("@excalidraw/excalidraw"),
        import("@excalidraw/excalidraw/index.css"),
      ]);
      if (!cancelled) setModule(mod);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return module;
}

/**
 * Whether the app is on a dark surface. Mirrors `Board`'s own observer so an
 * embedded board follows a theme switch exactly as an open one does.
 */
function useAppDarkMode() {
  const read = () =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const [isDark, setIsDark] = useState(read);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

export function BoardViewer({ scene, sceneKey }: { scene: string; sceneKey: string }) {
  const excalidraw = useExcalidrawModule();
  const isDark = useAppDarkMode();

  // Re-parsed whenever the referenced file's content changes, so a board edited
  // in its own tab updates in every document embedding it. Cheap: the scene is
  // JSON already in memory, and `initialData` is only read on mount.
  const initialData = useMemo(() => {
    try {
      const parsed = JSON.parse(scene);
      return {
        elements: parsed.elements ?? [],
        appState: parsed.appState ?? {},
        files: parsed.files ?? undefined,
        // The saved scroll position belongs to whoever drew the board, not to
        // the reader — frame the drawing itself instead.
        scrollToContent: true,
      };
    } catch {
      return null;
    }
  }, [scene]);

  if (!excalidraw) {
    return (
      <div
        className="docs-board-embed flex items-center justify-center bg-muted/30 text-sm text-muted-foreground"
        role="status"
        aria-label="Loading board"
      >
        Loading board…
      </div>
    );
  }

  const Excalidraw = excalidraw.Excalidraw as ComponentType<Record<string, unknown>>;

  return (
    <div className="excalidraw-surface docs-board-embed" role="img" aria-label={sceneKey}>
      <Excalidraw
        // Remounts on a different board so two embeds never share scene state.
        key={sceneKey}
        initialData={initialData}
        theme={isDark ? excalidraw.THEME.DARK : excalidraw.THEME.LIGHT}
        // The whole point of the embed. `viewModeEnabled` drops the toolbars,
        // the shape library and every editing affordance, leaving pan and zoom
        // — which is what makes a large board readable inside a column of prose.
        viewModeEnabled
        // No onChange is passed, so there is no path back to the file even if a
        // future Excalidraw version were to emit one in view mode.
        zenModeEnabled
        UIOptions={{
          // View mode already hides the editing UI; these remove what it keeps
          // and what a figure in a document has no use for.
          canvasActions: {
            export: false,
            loadScene: false,
            saveToActiveFile: false,
            toggleTheme: false,
            changeViewBackgroundColor: false,
            clearCanvas: false,
          },
        }}
      />
    </div>
  );
}
