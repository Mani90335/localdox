import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import "./board.css";

/**
 * Excalidraw is imported inside an effect, never at module scope.
 *
 * The package reads `navigator.platform` and `"netscape" in window` while its
 * own module is being defined. `BoardLazy` keeps a literal `import("./Board")`
 * so Vite can still emit a client chunk for this file — but that also makes it
 * a static edge in the server graph, and Nitro emits an SSR chunk for whatever
 * it finds here. Anything Excalidraw-shaped at top level would therefore be
 * evaluated during prerender and throw `window is not defined`, taking the
 * whole app shell down with it.
 *
 * Loading it from an effect sidesteps that completely: effects never run on the
 * server, so the import is reached only in a browser, while the module itself
 * stays harmless to evaluate.
 */
type ExcalidrawModule = typeof import("@excalidraw/excalidraw");

/**
 * Whether the app is currently on a dark surface.
 *
 * `DocsApp` is the single source of truth here: it stamps `data-theme` for all
 * five reader themes and toggles `.dark` for the three dark ones. Reading the
 * root element keeps boards correct for sepia and nord too, without threading a
 * new prop through the five call sites between here and the app shell.
 */
function useAppDarkMode() {
  const read = () =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const [isDark, setIsDark] = useState(read);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    sync();
    // The theme changes by class/attribute on <html>, so there is no event to
    // listen for — observing the attribute is what keeps an open board in step
    // with a theme switch instead of stranding it on the old palette.
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

/** Loads the editor in the browser only. Null until it has arrived. */
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
 * An `.excalidraw` board.
 *
 * The file's `content` is Excalidraw's own scene JSON, written by its
 * `serializeAsJSON`, so a board drawn here opens on excalidraw.com and a scene
 * exported from there opens here. Nothing about the format is ours.
 *
 * Persistence rides the workspace's existing autosave: the scene goes back
 * through `onContentChange` into the same `content` field every other document
 * writes to, so IndexedDB, dirty tracking and workspace switching need no
 * board-specific path.
 */
export function Board({
  fileId,
  content,
  onContentChange,
}: {
  fileId: string;
  content: string;
  onContentChange?: (content: string) => void;
}) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDark = useAppDarkMode();
  const excalidraw = useExcalidrawModule();
  // The last scene we wrote. Guards against re-saving an unchanged document on
  // every incidental change event.
  const lastSaved = useRef(content);
  // Latest scene seen from `onChange`, so a board closed mid-stroke can flush
  // whatever the debounce was still holding.
  const pending = useRef<string | null>(null);

  // The viewer builds a fresh `onContentChange` closure on every render, so the
  // flush effect below cannot depend on it directly: the effect would tear down
  // and re-run each render, flushing a scene, which saves, which re-renders.
  // Behind a ref the effect depends on nothing and runs only at unmount.
  const onContentChangeRef = useRef(onContentChange);
  useEffect(() => {
    onContentChangeRef.current = onContentChange;
  });

  // Parsed once per board. A malformed or empty file opens as a blank canvas
  // rather than throwing the viewer away — a board that won't open is worse
  // than a board that starts empty.
  const initialData = useMemo(() => {
    if (!content.trim()) return null;
    try {
      const scene = JSON.parse(content);
      return {
        elements: scene.elements ?? [],
        appState: scene.appState ?? {},
        files: scene.files ?? undefined,
        // The scroll position in a saved scene is not part of the drawing;
        // letting Excalidraw recompute it avoids restoring a board scrolled
        // off-screen.
        scrollToContent: true,
      };
    } catch {
      return null;
    }
  }, [fileId]); // eslint-disable-line react-hooks/exhaustive-deps

  const serialize = excalidraw?.serializeAsJSON;

  const handleChange = useCallback(
    (elements: unknown, appState: unknown, files: unknown) => {
      if (!serialize) return;
      // Excalidraw fires onChange for pointer moves and selection changes too,
      // not just edits. Serializing on each one would thrash IndexedDB for the
      // duration of a single drawn line, so the scene is written once the hand
      // stops moving — and `serializeAsJSON` keeps only the persistable slice
      // of appState, so cursor and selection churn does not count as a change.
      const serialized = (serialize as (...args: unknown[]) => string)(
        elements,
        appState,
        files,
        "local",
      );
      pending.current = serialized;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        if (serialized === lastSaved.current) return;
        lastSaved.current = serialized;
        onContentChangeRef.current?.(serialized);
      }, 600);
    },
    [serialize],
  );

  // A board closed mid-stroke must not lose the stroke.
  useEffect(() => {
    return () => {
      if (!saveTimer.current) return;
      clearTimeout(saveTimer.current);
      const serialized = pending.current;
      if (serialized && serialized !== lastSaved.current) {
        onContentChangeRef.current?.(serialized);
      }
    };
  }, []);

  if (!excalidraw) {
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-background text-sm text-muted-foreground"
        role="status"
        aria-label="Loading board"
      >
        Loading board…
      </div>
    );
  }

  const Excalidraw = excalidraw.Excalidraw as ComponentType<Record<string, unknown>>;

  return (
    <div className="excalidraw-surface h-full w-full">
      <Excalidraw
        initialData={initialData}
        onChange={handleChange}
        theme={isDark ? excalidraw.THEME.DARK : excalidraw.THEME.LIGHT}
      />
    </div>
  );
}
