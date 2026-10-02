// The board's interface: the canvas surface and the chrome around it.
//
// All drawing and input lives in `BoardEditor`; this file is React only for
// what React is good at — buttons, menus, panels and their state. Components
// subscribe to the editor's coarse "ui" channel (tool, selection, history) or
// its "view" channel (zoom), so a pen stroke or a drag re-renders nothing.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ColorPicker } from "./ColorPicker";
import { BoardEditor, type BoardTheme, type Tool } from "./editor";
import { Icon, type IconName } from "./icons";
import { ImageTooLargeError, prepareImage } from "./images";
import {
  displayColor,
  FILL_SWATCHES,
  FONT_FAMILIES,
  FONT_SIZES,
  fontStack,
  HIGHLIGHT_SWATCHES,
  parseScene,
  serializeScene,
  STROKE_SWATCHES,
  type Arrowhead,
  type BoardElement,
  type StrokeStyle,
  type Swatch,
  type TextAlign,
} from "./model";
import { exportPng, exportSvg, isMarker, type Viewport } from "./render";
import { indexById, labelOf } from "./scene-ops";
import { loadBoardFont } from "./font";
import { clearTextMetrics } from "./text";
import "./board.css";

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

let probe: CanvasRenderingContext2D | null | undefined;

/** A token's value if the canvas can paint it (oklch support varies), else the fallback. */
function canvasColor(value: string, fallback: string) {
  if (!value) return fallback;
  if (probe === undefined) probe = document.createElement("canvas").getContext("2d");
  if (!probe) return fallback;
  probe.fillStyle = "#010203";
  probe.fillStyle = value;
  return probe.fillStyle === "#010203" ? fallback : value;
}

function readTheme(el: HTMLElement): BoardTheme {
  const dark = document.documentElement.classList.contains("dark");
  const css = getComputedStyle(el);
  const token = (name: string, fallback: string) =>
    canvasColor(css.getPropertyValue(name).trim(), fallback);
  return {
    dark,
    background: token("--background", dark ? "#17181d" : "#ffffff"),
    grid: token("--muted-foreground", dark ? "#9aa0ab" : "#6b7280"),
    accent: token("--primary", dark ? "#8f8cff" : "#4f46e5"),
    handleFill: token("--card", dark ? "#1f2026" : "#ffffff"),
  };
}

/**
 * Follows the app's theme. `DocsApp` sets `.dark` and `data-theme` on <html>
 * for every reader theme, and there's no event for it, so the attribute is
 * observed directly.
 */
function useThemeSync(editor: BoardEditor, root: React.RefObject<HTMLElement | null>) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const html = document.documentElement;
    const sync = () => {
      if (!root.current) return;
      const theme = readTheme(root.current);
      editor.setTheme(theme);
      setDark(theme.dark);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(html, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    return () => observer.disconnect();
  }, [editor, root]);
  return dark;
}

function useUi(editor: BoardEditor) {
  return useSyncExternalStore(
    useCallback((listener) => editor.subscribe("ui", listener), [editor]),
    () => editor.uiVersion,
    () => 0,
  );
}

function useView(editor: BoardEditor) {
  return useSyncExternalStore(
    useCallback((listener) => editor.subscribe("view", listener), [editor]),
    () => editor.viewVersion,
    () => 0,
  );
}

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? "⌘" : "Ctrl+";
const SHIFT = isMac ? "⇧" : "Shift+";

/** Where each board was last looked at, so returning to a tab doesn't re-frame it. */
const viewports = new Map<string, Viewport>();

function baseName(fileName: string) {
  return fileName.replace(/\.(board|excalidraw)$/i, "") || "board";
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export interface BoardProps {
  fileId: string;
  fileName?: string;
  content: string;
  onContentChange?: (content: string) => void;
  /** Renames the file (called from the board's title). */
  onRename?: (name: string) => void;
}

/**
 * A board document. Its `content` is the scene JSON; edits go back through
 * `onContentChange` into the same field every document writes to, so
 * IndexedDB, dirty tracking and workspace switching need no board-specific path.
 */
export function Board(props: BoardProps) {
  // A different file is a different editor: keying on the id gives each board
  // its own history, selection and view.
  return <BoardSurface key={props.fileId} {...props} />;
}

function BoardSurface({ fileId, fileName = "", content, onContentChange, onRename }: BoardProps) {
  const parsed = useMemo(() => {
    try {
      return { scene: parseScene(content, fileName) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "This board couldn't be read." };
    }
    // Parsed once per board. Later content changes are this editor's own saves.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if ("error" in parsed) {
    return (
      <div className="board-unreadable" role="alert">
        <div className="board-unreadable__card">
          <Icon name="sparkle" size={22} />
          <p className="board-unreadable__title">This board can’t be opened</p>
          <p className="board-unreadable__body">
            {parsed.error} The file hasn’t been changed — you can still download it from the file
            menu.
          </p>
        </div>
      </div>
    );
  }
  return (
    <BoardEditorView
      fileId={fileId}
      fileName={fileName}
      initialContent={content}
      scene={parsed.scene}
      onContentChange={onContentChange}
      onRename={onRename}
    />
  );
}

function BoardEditorView({
  fileId,
  fileName,
  initialContent,
  scene,
  onContentChange,
  onRename,
}: {
  fileId: string;
  fileName: string;
  initialContent: string;
  scene: ReturnType<typeof parseScene>;
  onContentChange?: (content: string) => void;
  onRename?: (name: string) => void;
}) {
  const [editor] = useState(() => new BoardEditor(scene, { readOnly: !onContentChange }));
  const rootRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useUi(editor);
  const dark = useThemeSync(editor, rootRef);

  // --- autosave -----------------------------------------------------------
  const onChangeRef = useRef(onContentChange);
  useEffect(() => {
    onChangeRef.current = onContentChange;
  });
  const lastSaved = useRef(initialContent);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const next = serializeScene(editor.toScene());
    if (next === lastSaved.current) return;
    lastSaved.current = next;
    onChangeRef.current?.(next);
  }, [editor]);

  useEffect(() => {
    if (editor.readOnly) return;
    const unsubscribe = editor.subscribe("change", () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      // Edits arrive as whole gestures, so a short pause is enough to batch a
      // flurry of them without leaving much unsaved.
      saveTimer.current = setTimeout(flush, 400);
    });
    const onHide = () => {
      if (saveTimer.current) flush();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      // Closing the board mid-pause must not lose the last edit.
      if (saveTimer.current) flush();
    };
  }, [editor, flush]);

  // --- mount, size, input -------------------------------------------------
  useEffect(() => {
    const root = rootRef.current;
    const sceneCanvas = sceneRef.current;
    const overlay = overlayRef.current;
    if (!root || !sceneCanvas || !overlay) return;
    const saved = viewports.get(fileId);
    if (saved) editor.setViewport(saved);
    editor.attach(root, sceneCanvas, overlay);

    const measure = () => {
      const rect = root.getBoundingClientRect();
      editor.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    };
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(root);
    measure();
    // A board that just opened takes the keyboard if nothing else has it
    // (the "New board" button that created it is gone), so R, P, T… work at
    // once. Focus held anywhere else — the sidebar, a dialog — is left alone.
    if (!document.activeElement || document.activeElement === document.body) {
      root.focus({ preventScroll: true });
    }

    // Measured per event: the board can move under a stationary pointer
    // (page scroll, a pane resize), and a stale rect would offset every stroke.
    const local = (e: { clientX: number; clientY: number }) => {
      const rect = root.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top] as const;
    };
    const down = (e: PointerEvent) => {
      // Focus is managed here, not by the browser: its mousedown default would
      // move focus back to the stage *after* a click opened a text editor (a
      // sticky note, a double-click), and the editor would close on blur.
      // The right button keeps its default so the context menu still opens.
      if (e.button !== 2) e.preventDefault();
      if (document.activeElement !== root) root.focus({ preventScroll: true });
      if (e.button === 0 || e.button === 1) overlay.setPointerCapture(e.pointerId);
      editor.pointerDown(e, ...local(e));
    };
    const move = (e: PointerEvent) => editor.pointerMove(e, ...local(e));
    const up = (e: PointerEvent) => editor.pointerUp(e);
    const cancel = (e: PointerEvent) => editor.pointerCancel(e);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      editor.wheel(e, ...local(e));
    };
    // Safari's own pinch events would zoom the page instead of the board.
    const gesture = (e: Event) => e.preventDefault();
    overlay.addEventListener("pointerdown", down);
    overlay.addEventListener("pointermove", move);
    overlay.addEventListener("pointerup", up);
    overlay.addEventListener("pointercancel", cancel);
    root.addEventListener("wheel", wheel, { passive: false });
    root.addEventListener("gesturestart", gesture);

    // A canvas doesn't re-lay itself out when a webfont swaps in, so text
    // measured against the fallback must be measured again once the face is
    // usable. The app's own loader is reused: same stylesheet, same files,
    // usually already cached because Atkinson is the default reading face.
    let mounted = true;
    const relayout = () => {
      if (!mounted) return;
      clearTextMetrics();
      editor.invalidate(true);
    };
    void loadBoardFont().then(relayout);

    return () => {
      mounted = false;
      viewports.set(fileId, { ...editor.viewport });
      resizeObserver.disconnect();
      overlay.removeEventListener("pointerdown", down);
      overlay.removeEventListener("pointermove", move);
      overlay.removeEventListener("pointerup", up);
      overlay.removeEventListener("pointercancel", cancel);
      root.removeEventListener("wheel", wheel);
      root.removeEventListener("gesturestart", gesture);
      editor.detach();
    };
  }, [editor, fileId]);

  useEffect(() => {
    editor.onAnnounce = setAnnouncement;
    editor.onRequestShortcuts = () => setShortcutsOpen(true);
    editor.onRequestImage = () => fileInputRef.current?.click();
    return () => {
      editor.onAnnounce = editor.onRequestShortcuts = editor.onRequestImage = null;
    };
  }, [editor]);

  // --- images, clipboard ---------------------------------------------------
  const addImages = useCallback(
    async (files: Iterable<File>, at?: [number, number]) => {
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        try {
          editor.insertImage(await prepareImage(file), at);
        } catch (error) {
          toast.error(
            error instanceof ImageTooLargeError
              ? error.message
              : `“${file.name}” couldn’t be added to the board.`,
          );
        }
      }
    },
    [editor],
  );

  const onPaste = (e: React.ClipboardEvent) => {
    if ((e.target as HTMLElement).tagName === "TEXTAREA" || editor.readOnly) return;
    const images = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    e.preventDefault();
    if (images.length) {
      void addImages(images);
      return;
    }
    editor.pasteText(e.clipboardData.getData("text/plain"));
  };
  const onCopy = (e: React.ClipboardEvent, cut = false) => {
    if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
    const text = cut && !editor.readOnly ? editor.cutSelection() : editor.copySelection();
    if (!text) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", text);
  };

  const onDrop = (e: React.DragEvent) => {
    if (editor.readOnly) return;
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = rootRef.current!.getBoundingClientRect();
    void addImages(files, editor.toWorld(e.clientX - rect.left, e.clientY - rect.top));
  };

  // --- exports -------------------------------------------------------------
  const name = baseName(fileName);
  const exportable = () => {
    const selected = editor.selectedElements();
    if (!selected.length) return editor.elements;
    const map = indexById(editor.elements);
    const ids = new Set(selected.map((el) => el.id));
    for (const el of selected) {
      const label = labelOf(el, map);
      if (label) ids.add(label.id);
    }
    return editor.elements.filter((el) => ids.has(el.id));
  };
  const exportAs = async (format: "png" | "svg") => {
    const elements = exportable();
    if (!elements.length) {
      toast("Nothing to export yet", { description: "Draw something on the board first." });
      return;
    }
    if (format === "png") {
      const blob = await exportPng(elements, editor.images.get);
      if (blob) download(blob, `${name}.png`);
    } else {
      const svg = exportSvg(elements, editor.files);
      if (svg) download(new Blob([svg], { type: "image/svg+xml" }), `${name}.svg`);
    }
  };
  const copyPng = async () => {
    const elements = exportable();
    if (!elements.length) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": exportPng(elements, editor.images.get).then((b) => b ?? new Blob()),
        }),
      ]);
      toast.success("Copied as image");
    } catch {
      toast.error("Your browser didn’t allow copying images.");
    }
  };
  const clearBoard = () => {
    if (!editor.elements.length) return;
    editor.apply(() => []);
    toast("Board cleared", {
      action: { label: "Undo", onClick: () => editor.undo() },
    });
  };
  const pasteFromMenu = async () => {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Permission denied: fall back to what was copied on this board.
    }
    editor.pasteText(text);
  };

  const actions = {
    exportAs,
    copyPng,
    clearBoard,
    pasteFromMenu,
    openShortcuts: () => setShortcutsOpen(true),
  };

  return (
    <div className="board" data-readonly={editor.readOnly || undefined}>
      {/* Title and tools come first in the DOM: that is the order a keyboard
          or screen-reader user meets them, before the canvas itself. */}
      <BoardTitle fileName={fileName} onRename={editor.readOnly ? undefined : onRename} />
      {!editor.readOnly && <ToolRail editor={editor} dark={dark} />}
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={editor.readOnly}>
          <div
            ref={rootRef}
            className="board-stage"
            tabIndex={0}
            role="application"
            aria-roledescription="board"
            aria-label={`Board: ${name}`}
            aria-describedby={`board-help-${fileId}`}
            onKeyDown={(e) => {
              if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
              if (e.key !== "Tab") e.currentTarget.dataset.engaged = "";
              if (editor.keyDown(e.nativeEvent)) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onKeyUp={(e) => editor.keyUp(e.nativeEvent)}
            onPointerDown={(e) => (e.currentTarget.dataset.engaged = "")}
            onBlur={(e) => {
              delete e.currentTarget.dataset.engaged;
              editor.blur();
            }}
            onPaste={onPaste}
            onCopy={(e) => onCopy(e)}
            onCut={(e) => onCopy(e, true)}
            onDragOver={(e) => {
              if (!editor.readOnly && [...e.dataTransfer.types].includes("Files"))
                e.preventDefault();
            }}
            onDrop={onDrop}
          >
            <canvas ref={sceneRef} className="board-canvas" aria-hidden="true" />
            <canvas
              ref={overlayRef}
              className="board-canvas board-canvas--overlay"
              aria-hidden="true"
            />
            <TextEditor editor={editor} dark={dark} />
            <EmptyHint editor={editor} />
          </div>
        </ContextMenuTrigger>
        <BoardContextMenu editor={editor} actions={actions} />
      </ContextMenu>

      <p id={`board-help-${fileId}`} className="sr-only">
        {editor.readOnly
          ? "Drag to pan. Pinch or hold Control and scroll to zoom."
          : "Press P to draw, R for a rectangle, A for an arrow, T for text, S for a sticky note, V to select. Press question mark for all shortcuts."}
      </p>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      <SelectionBar editor={editor} dark={dark} actions={actions} />
      <TopControls editor={editor} actions={actions} />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = e.target.files ? [...e.target.files] : [];
          e.target.value = "";
          void addImages(files);
          rootRef.current?.focus({ preventScroll: true });
        }}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

type Actions = {
  exportAs: (format: "png" | "svg") => Promise<void>;
  copyPng: () => Promise<void>;
  clearBoard: () => void;
  pasteFromMenu: () => Promise<void>;
  openShortcuts: () => void;
};

// ---------------------------------------------------------------------------
// Text editor overlay
// ---------------------------------------------------------------------------

function TextEditor({ editor, dark }: { editor: BoardEditor; dark: boolean }) {
  useView(editor);
  useUi(editor);
  const ref = useRef<HTMLTextAreaElement>(null);
  const geometry = editor.textEditorGeometry();
  const editingId = geometry?.id;

  useEffect(() => {
    const el = ref.current;
    if (!el || !editingId) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editingId]);

  if (!geometry) return null;
  const finish = () => {
    editor.endTextEdit();
    (ref.current?.closest(".board-stage") as HTMLElement | null)?.focus({ preventScroll: true });
  };
  const caret = geometry.fontSize * 0.7;
  return (
    <textarea
      ref={ref}
      className="board-text-editor"
      aria-label="Text"
      value={geometry.text}
      spellCheck
      wrap={geometry.wraps ? "soft" : "off"}
      onChange={(e) => editor.updateText(e.target.value)}
      onBlur={() => editor.endTextEdit()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          finish();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        left: geometry.left,
        top: geometry.top,
        width: geometry.width + (geometry.wraps ? 0 : caret),
        height: Math.max(geometry.height, geometry.fontSize * geometry.lineHeight),
        fontSize: geometry.fontSize,
        lineHeight: geometry.lineHeight,
        fontFamily: fontStack(geometry.fontFamily),
        textAlign: geometry.align,
        color: displayColor(geometry.strokeColor, dark),
        transform: geometry.angle ? `rotate(${geometry.angle}rad)` : undefined,
        transformOrigin: "center",
        whiteSpace: geometry.wraps ? "pre-wrap" : "pre",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyHint({ editor }: { editor: BoardEditor }) {
  useUi(editor);
  if (!editor.isEmpty || editor.readOnly || editor.editingId) return null;
  const hints: [string, string][] = [
    ["P", "Draw"],
    ["S", "Sticky note"],
    ["R", "Shape"],
    ["A", "Arrow"],
    ["T", "Text"],
  ];
  return (
    <div className="board-empty" aria-hidden="true">
      <p className="board-empty__title">A blank board</p>
      <p className="board-empty__body">
        Sketch, map out an idea, or drop in images. Everything saves as you go.
      </p>
      <div className="board-empty__keys">
        {hints.map(([key, label]) => (
          <span key={key} className="board-empty__key">
            <kbd>{key}</kbd>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool dock
// ---------------------------------------------------------------------------

interface ToolDef {
  tool: Tool;
  icon: IconName;
  label: string;
  key: string;
  /** Tucked into the overflow menu on narrow screens. */
  secondary?: boolean;
}

const TOOL_GROUPS: ToolDef[][] = [
  [
    { tool: "select", icon: "select", label: "Select", key: "V" },
    { tool: "hand", icon: "hand", label: "Pan", key: "H", secondary: true },
  ],
  [
    { tool: "pen", icon: "pen", label: "Pen", key: "P" },
    { tool: "marker", icon: "marker", label: "Highlighter", key: "M", secondary: true },
    { tool: "eraser", icon: "eraser", label: "Eraser", key: "E" },
  ],
  [
    { tool: "rectangle", icon: "rectangle", label: "Rectangle", key: "R" },
    { tool: "ellipse", icon: "ellipse", label: "Ellipse", key: "O", secondary: true },
    { tool: "diamond", icon: "diamond", label: "Diamond", key: "D", secondary: true },
    { tool: "arrow", icon: "arrow", label: "Arrow", key: "A" },
    { tool: "line", icon: "line", label: "Line", key: "L", secondary: true },
  ],
  [
    { tool: "text", icon: "text", label: "Text", key: "T" },
    { tool: "sticky", icon: "sticky", label: "Sticky note", key: "S" },
  ],
];

/**
 * The tool rail, down the board's left edge.
 *
 * Not along the bottom: there it competed with the phone's home indicator,
 * browser toolbars and the on-screen keyboard, sat at the far end of the page
 * for keyboard and screen-reader users, and was the last thing a magnifier
 * user panned to. On the left it is next to the workspace sidebar, comes
 * first in reading order after the title, and the options for the tool in
 * hand open right beside the tool.
 */
function ToolRail({ editor, dark }: { editor: BoardEditor; dark: boolean }) {
  useUi(editor);
  const secondary = TOOL_GROUPS.flat().filter((t) => t.secondary);
  return (
    <div className="board-rail-wrap">
      <div
        className="board-rail"
        role="toolbar"
        aria-label="Board tools"
        aria-orientation="vertical"
        onKeyDown={rovingFocus}
      >
        {TOOL_GROUPS.map((group, i) => (
          <div key={i} className="board-rail__group">
            {group.map((def) => (
              <button
                key={def.tool}
                type="button"
                className="board-tool"
                data-secondary={def.secondary || undefined}
                aria-pressed={editor.tool === def.tool}
                aria-label={def.label}
                aria-keyshortcuts={def.key}
                data-tip={`${def.label}  ${def.key}`}
                data-tip-side="right"
                onClick={() => editor.setTool(def.tool)}
              >
                <Icon name={def.icon} />
              </button>
            ))}
            {i === TOOL_GROUPS.length - 1 && (
              <button
                type="button"
                className="board-tool"
                aria-label="Image"
                aria-keyshortcuts="I"
                data-tip="Image  I"
                data-tip-side="right"
                onClick={() => editor.onRequestImage?.()}
              >
                <Icon name="image" />
              </button>
            )}
          </div>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="board-tool board-tool--overflow"
              aria-label="More tools"
              data-active={secondary.some((t) => t.tool === editor.tool) || undefined}
            >
              <Icon name="more" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="board-menu">
            {secondary.map((def) => (
              <DropdownMenuItem key={def.tool} onSelect={() => editor.setTool(def.tool)}>
                <Icon name={def.icon} size={18} />
                {def.label}
                <DropdownMenuShortcut>{def.key}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ToolOptions editor={editor} dark={dark} />
    </div>
  );
}

/** Arrow keys move between a toolbar's buttons, as a toolbar's should. */
function rovingFocus(e: React.KeyboardEvent<HTMLElement>) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")].filter(
    (b) => b.offsetParent !== null,
  );
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  e.preventDefault();
  e.stopPropagation();
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? buttons.length - 1
        : (index + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + buttons.length) %
          buttons.length;
  buttons[next]?.focus();
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

const isSticky = (el: BoardElement, map: Map<string, BoardElement>) =>
  el.type === "rectangle" &&
  el.strokeColor === "transparent" &&
  el.backgroundColor !== "transparent" &&
  !!labelOf(el, map);

/**
 * What the selection can be styled with, and its current values. With nothing
 * selected, the active drawing tool stands in for the selection, so the same
 * answers drive both the floating bar and the tool options.
 */
function styleContext(editor: BoardEditor) {
  const selected = editor.selectedElements();
  const tool = editor.tool;
  const map = indexById(editor.elements);
  const types = new Set<string>(
    selected.length ? selected.map((el) => el.type) : [tool === "pen" ? "freedraw" : tool],
  );
  const has = (...t: string[]) => t.some((x) => types.has(x));
  const stickies = selected.length ? selected.every((el) => isSticky(el, map)) : tool === "sticky";
  const shapes = has("rectangle", "ellipse", "diamond") && !stickies;
  const linear = has("arrow", "line");
  const pen = selected.length
    ? selected.some((el) => el.type === "freedraw" && !isMarker(el))
    : tool === "pen";
  const labelled = selected.some((el) => labelOf(el, map));
  const freeText = has("text");
  const text = freeText || stickies || labelled;
  const onlyImages = selected.length > 0 && selected.every((el) => el.type === "image");

  const sample = selected[0];
  const label = sample ? labelOf(sample, map) : undefined;
  const textSample = sample?.type === "text" ? sample : label;
  const style = editor.style;
  const value = {
    strokeColor: (stickies ? textSample?.strokeColor : sample?.strokeColor) ?? style.strokeColor,
    backgroundColor:
      sample?.backgroundColor ?? (stickies ? FILL_SWATCHES[3].light : style.backgroundColor),
    strokeWidth: sample?.strokeWidth ?? style.strokeWidth,
    strokeStyle: (sample?.strokeStyle ?? style.strokeStyle) as StrokeStyle,
    roundness: sample ? !!sample.roundness : style.roundness,
    startArrowhead: (sample?.type === "arrow"
      ? (sample.startArrowhead ?? null)
      : style.startArrowhead) as Arrowhead,
    endArrowhead: (sample?.type === "arrow"
      ? (sample.endArrowhead ?? null)
      : style.endArrowhead) as Arrowhead,
    fontSize: textSample?.fontSize ?? style.fontSize,
    fontFamily: textSample?.fontFamily ?? style.fontFamily,
    textAlign: (textSample?.textAlign ?? style.textAlign) as TextAlign,
  };
  return {
    selected,
    stickies,
    shapes,
    linear,
    pen,
    text,
    freeText,
    arrows: has("arrow"),
    cornered: (has("rectangle", "diamond") && !stickies) || linear,
    pathOnly: linear && !shapes,
    color: !onlyImages && (shapes || linear || pen || text),
    value,
  };
}

const WIDTHS = [
  { value: 1, icon: "widthThin", label: "Thin" },
  { value: 2, icon: "widthMedium", label: "Medium" },
  { value: 4, icon: "widthBold", label: "Bold" },
] as const satisfies readonly { value: number; icon: IconName; label: string }[];

/** Each font previews itself: "Aa" set in that face. */
const FONT_OPTIONS = FONT_FAMILIES.map((family) => ({
  value: family.value as number,
  text: "Aa",
  label: family.label,
  fontFamily: fontStack(family.value),
}));

const SIZE_OPTIONS = (Object.entries(FONT_SIZES) as [string, number][]).map(([key, size]) => ({
  value: size,
  text: key,
  label: { S: "Small", M: "Medium", L: "Large", XL: "Extra large" }[key] ?? key,
}));

/**
 * The selection's own toolbar, floating just above it — where the eye already
 * is. A single compact row; each control opens a small panel of choices
 * pointing away from the selection, so the change is seen as it is made.
 * Hidden while dragging, so it never chases the pointer.
 */
function SelectionBar({
  editor,
  dark,
  actions,
}: {
  editor: BoardEditor;
  dark: boolean;
  actions: Actions;
}) {
  useUi(editor);
  useView(editor);
  const barRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [open, setOpen] = useState<string | null>(null);
  const selectionKey = [...editor.selected].join(",");
  const visible = !editor.readOnly && editor.selected.size > 0 && !editor.interacting;

  useEffect(() => setOpen(null), [selectionKey]);
  // Measured after every render: the bar's width depends on which controls
  // the selection offers. The equality check below ends the loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w !== size.w || h !== size.h) setSize({ w, h });
  });
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  const box = visible ? editor.selectionScreenBox() : null;
  if (!box) return null;
  const ctx = styleContext(editor);
  const { value, selected } = ctx;

  // Above the selection, clear of its rotate handle; below when there's no
  // room; pinned under the top controls when the selection fills the view.
  const above = box.top - 40 - size.h;
  let top = above;
  let placement: "above" | "below" = "above";
  if (above < 64) {
    placement = "below";
    top = box.bottom + 20;
    if (top + size.h > box.height - 96) {
      top = 64;
      placement = "above";
    }
  }
  // Clear of the tool rail on the left.
  const left = Math.min(
    Math.max((box.left + box.right) / 2 - size.w / 2, 72),
    Math.max(8, box.width - size.w - 8),
  );
  // Panels open away from the selection, unless that would leave the board.
  const panelSide = placement === "above" && top > 220 ? "up" : "down";
  const menu = { open, setOpen, side: panelSide } as const;
  const grouped = selected.some((el) => el.groupIds.length);
  const oneGroup =
    selected.length > 1 &&
    selected.every(
      (el) => el.groupIds.length && el.groupIds.at(-1) === selected[0].groupIds.at(-1),
    );
  const swatchOf = (color: string) =>
    color === "transparent" ? "transparent" : displayColor(color, dark);

  return (
    <div
      ref={barRef}
      className="board-bar"
      role="toolbar"
      aria-label="Selection"
      data-placement={placement}
      style={{ left, top, visibility: size.w ? "visible" : "hidden" }}
      onKeyDown={rovingFocus}
    >
      {editor.selectionLocked ? (
        <button
          type="button"
          className="board-bar__unlock"
          onClick={() => editor.toggleLock()}
          aria-keyshortcuts={isMac ? "Meta+Shift+L" : "Control+Shift+L"}
        >
          <Icon name="unlock" size={18} />
          Unlock
        </button>
      ) : (
        <>
          {ctx.color && (
            <BarPanel
              id="color"
              label={ctx.stickies ? "Note color" : "Color"}
              {...menu}
              trigger={
                <span
                  className="board-bar__dot"
                  style={{
                    background: swatchOf(ctx.stickies ? value.backgroundColor : value.strokeColor),
                  }}
                />
              }
            >
              {ctx.stickies && (
                <Section label="Note">
                  <Swatches
                    swatches={FILL_SWATCHES}
                    value={value.backgroundColor}
                    dark={dark}
                    onChange={(backgroundColor, commit) =>
                      editor.setStyle({ backgroundColor }, { commit })
                    }
                  />
                </Section>
              )}
              <Section
                label={
                  ctx.stickies || (ctx.freeText && !ctx.shapes && !ctx.linear && !ctx.pen)
                    ? "Text"
                    : "Stroke"
                }
              >
                <Swatches
                  swatches={STROKE_SWATCHES}
                  value={value.strokeColor}
                  dark={dark}
                  onChange={(strokeColor, commit) => editor.setStyle({ strokeColor }, { commit })}
                />
              </Section>
            </BarPanel>
          )}
          {ctx.shapes && (
            <BarPanel
              id="fill"
              label="Fill"
              {...menu}
              trigger={
                value.backgroundColor === "transparent" ? (
                  <Icon name="noFill" size={18} />
                ) : (
                  <span
                    className="board-bar__fill"
                    style={{ background: swatchOf(value.backgroundColor) }}
                  />
                )
              }
            >
              <Section label="Fill">
                <Swatches
                  swatches={FILL_SWATCHES}
                  value={value.backgroundColor}
                  dark={dark}
                  allowNone
                  onChange={(backgroundColor, commit) =>
                    editor.setStyle({ backgroundColor }, { commit })
                  }
                />
              </Section>
            </BarPanel>
          )}
          {(ctx.shapes || ctx.linear || ctx.pen) && (
            <BarPanel
              id="stroke"
              label="Stroke"
              {...menu}
              trigger={
                <Icon
                  name={
                    value.strokeWidth >= 4
                      ? "widthBold"
                      : value.strokeWidth <= 1
                        ? "widthThin"
                        : "widthMedium"
                  }
                  size={18}
                />
              }
            >
              <Section label="Width">
                <Segmented
                  value={value.strokeWidth}
                  options={WIDTHS.map((w) => ({ ...w }))}
                  onChange={(strokeWidth) => editor.setStyle({ strokeWidth })}
                />
              </Section>
              {(ctx.shapes || ctx.linear) && (
                <Section label="Line">
                  <Segmented
                    value={value.strokeStyle}
                    options={[
                      { value: "solid", icon: "solid", label: "Solid" },
                      { value: "dashed", icon: "dashed", label: "Dashed" },
                      { value: "dotted", icon: "dotted", label: "Dotted" },
                    ]}
                    onChange={(strokeStyle) => editor.setStyle({ strokeStyle })}
                  />
                </Section>
              )}
              {ctx.cornered && (
                <Section label={ctx.pathOnly ? "Path" : "Corners"}>
                  <Segmented
                    value={value.roundness}
                    options={[
                      {
                        value: false,
                        icon: ctx.pathOnly ? "line" : "sharp",
                        label: ctx.pathOnly ? "Straight" : "Sharp",
                      },
                      { value: true, icon: "round", label: ctx.pathOnly ? "Curved" : "Rounded" },
                    ]}
                    onChange={(roundness) => editor.setStyle({ roundness })}
                  />
                </Section>
              )}
            </BarPanel>
          )}
          {ctx.arrows && (
            <BarPanel
              id="ends"
              label="Arrowheads"
              {...menu}
              trigger={<Icon name="headArrow" size={18} />}
            >
              <Section label="Start">
                <Segmented
                  value={value.startArrowhead}
                  options={HEADS.map((h) => ({ ...h, flip: true }))}
                  onChange={(startArrowhead) => editor.setStyle({ startArrowhead })}
                />
              </Section>
              <Section label="End">
                <Segmented
                  value={value.endArrowhead}
                  options={HEADS}
                  onChange={(endArrowhead) => editor.setStyle({ endArrowhead })}
                />
              </Section>
            </BarPanel>
          )}
          {ctx.text && (
            <BarPanel
              id="text"
              label="Text"
              {...menu}
              trigger={
                <span className="board-bar__text">
                  {SIZE_OPTIONS.find((o) => o.value === closestFontSize(value.fontSize))?.text}
                </span>
              }
            >
              <Section label="Font">
                <Segmented
                  value={value.fontFamily}
                  options={FONT_OPTIONS}
                  onChange={(fontFamily) => editor.setStyle({ fontFamily })}
                />
              </Section>
              <Section label="Size">
                <Segmented
                  value={closestFontSize(value.fontSize)}
                  options={SIZE_OPTIONS}
                  onChange={(fontSize) => editor.setStyle({ fontSize })}
                />
              </Section>
              {ctx.freeText && (
                <Section label="Align">
                  <Segmented
                    value={value.textAlign}
                    options={[
                      { value: "left", icon: "alignLeft", label: "Left" },
                      { value: "center", icon: "alignCenter", label: "Center" },
                      { value: "right", icon: "alignRight", label: "Right" },
                    ]}
                    onChange={(textAlign) => editor.setStyle({ textAlign })}
                  />
                </Section>
              )}
            </BarPanel>
          )}
          {(ctx.color || ctx.shapes) && <span className="board-bar__divider" aria-hidden="true" />}
          <IconButton
            icon="duplicate"
            label={`Duplicate  ${MOD}D`}
            tipSide={placement === "below" ? "bottom" : undefined}
            onClick={() => editor.duplicateSelection()}
          />
          <IconButton
            icon="trash"
            label="Delete  ⌫"
            tone="danger"
            tipSide={placement === "below" ? "bottom" : undefined}
            onClick={() => editor.deleteSelection()}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="board-icon-button" aria-label="More actions">
                <Icon name="more" size={18} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side={placement === "above" ? "top" : "bottom"}
              align="end"
              className="board-menu min-w-52"
            >
              <DropdownMenuItem onSelect={() => editor.reorderSelection("front")}>
                <Icon name="bringFront" size={18} />
                Bring to front
                <DropdownMenuShortcut>
                  {MOD}
                  {SHIFT}]
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor.reorderSelection("back")}>
                <Icon name="sendBack" size={18} />
                Send to back
                <DropdownMenuShortcut>
                  {MOD}
                  {SHIFT}[
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor.toggleLock()}>
                <Icon name="lock" size={18} />
                {selected.some((el) => el.type === "image") ? "Lock photo" : "Lock"}
                <DropdownMenuShortcut>
                  {MOD}
                  {SHIFT}L
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              {(selected.length > 1 && !oneGroup) || grouped ? <DropdownMenuSeparator /> : null}
              {selected.length > 1 && !oneGroup && (
                <DropdownMenuItem onSelect={() => editor.group()}>
                  <Icon name="group" size={18} />
                  Group
                  <DropdownMenuShortcut>{MOD}G</DropdownMenuShortcut>
                </DropdownMenuItem>
              )}
              {grouped && (
                <DropdownMenuItem onSelect={() => editor.ungroup()}>
                  <Icon name="ungroup" size={18} />
                  Ungroup
                  <DropdownMenuShortcut>
                    {MOD}
                    {SHIFT}G
                  </DropdownMenuShortcut>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void actions.copyPng()}>
                <Icon name="copy" size={18} />
                Copy as image
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void actions.exportAs("png")}>
                <Icon name="download" size={18} />
                Export selection as PNG
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  );
}

/** A bar button with a small anchored panel. One panel is open at a time. */
function BarPanel({
  id,
  label,
  trigger,
  children,
  open,
  setOpen,
  side,
}: {
  id: string;
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  open: string | null;
  setOpen: (id: string | null) => void;
  side: "up" | "down";
}) {
  const isOpen = open === id;
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="board-bar__item">
      <button
        ref={buttonRef}
        type="button"
        className="board-icon-button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        data-tip={isOpen ? undefined : label}
        data-tip-side={side === "down" ? "bottom" : undefined}
        onClick={() => setOpen(isOpen ? null : id)}
      >
        {trigger}
      </button>
      {isOpen && (
        <div
          className="board-pop"
          data-side={side}
          role="dialog"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            setOpen(null);
            buttonRef.current?.focus();
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Options for the tool in hand, in a slim column beside the rail: pick the
 * pen's colour before drawing, without anything opening over the canvas.
 */
function ToolOptions({ editor, dark }: { editor: BoardEditor; dark: boolean }) {
  useUi(editor);
  const tool = editor.tool;
  if (editor.readOnly || editor.selected.size || editor.editingId) return null;
  if (tool === "select" || tool === "hand" || tool === "eraser") return null;

  if (tool === "marker") {
    return (
      <div
        className="board-tool-options"
        role="toolbar"
        aria-label="Tool options"
        aria-orientation="vertical"
        onKeyDown={rovingFocus}
      >
        <Swatches
          flyout
          swatches={HIGHLIGHT_SWATCHES}
          value={editor.marker.color}
          dark={dark}
          onChange={(color) => editor.setMarker({ color })}
        />
        <span className="board-bar__divider" aria-hidden="true" />
        <Segmented
          value={editor.marker.width}
          options={[
            { value: 2, icon: "widthThin", label: "Fine" },
            { value: 4, icon: "widthMedium", label: "Medium" },
            { value: 7, icon: "widthBold", label: "Broad" },
          ]}
          onChange={(width) => editor.setMarker({ width })}
        />
      </div>
    );
  }
  const { value } = styleContext(editor);
  return (
    <div
      className="board-tool-options"
      role="toolbar"
      aria-label="Tool options"
      aria-orientation="vertical"
      onKeyDown={rovingFocus}
    >
      {tool === "sticky" ? (
        <Swatches
          flyout
          swatches={FILL_SWATCHES}
          value={
            editor.style.backgroundColor === "transparent"
              ? FILL_SWATCHES[3].light
              : editor.style.backgroundColor
          }
          dark={dark}
          onChange={(backgroundColor, commit) => editor.setStyle({ backgroundColor }, { commit })}
        />
      ) : (
        <Swatches
          flyout
          swatches={STROKE_SWATCHES}
          value={value.strokeColor}
          dark={dark}
          onChange={(strokeColor, commit) => editor.setStyle({ strokeColor }, { commit })}
        />
      )}
      {tool !== "sticky" && <span className="board-bar__divider" aria-hidden="true" />}
      {tool === "text" ? (
        <>
          <Segmented
            value={value.fontFamily}
            options={FONT_OPTIONS}
            onChange={(fontFamily) => editor.setStyle({ fontFamily })}
          />
          <Segmented
            value={closestFontSize(value.fontSize)}
            options={SIZE_OPTIONS}
            onChange={(fontSize) => editor.setStyle({ fontSize })}
          />
        </>
      ) : tool !== "sticky" ? (
        <Segmented
          value={value.strokeWidth}
          options={WIDTHS.map((w) => ({ ...w }))}
          onChange={(strokeWidth) => editor.setStyle({ strokeWidth })}
        />
      ) : null}
    </div>
  );
}

/** The board's name, edited in place. Renames the file; the extension is kept. */
function BoardTitle({
  fileName,
  onRename,
}: {
  fileName: string;
  onRename?: (name: string) => void;
}) {
  const extension = /\.excalidraw$/i.test(fileName) ? ".excalidraw" : ".board";
  const base = baseName(fileName);
  const [value, setValue] = useState(base);
  useEffect(() => setValue(base), [base]);
  if (!onRename) {
    return (
      <div className="board-title">
        <span className="board-title__static">{base}</span>
      </div>
    );
  }
  const commit = () => {
    const next = value.trim().replace(/[\\/]/g, "-");
    if (!next || next === base) {
      setValue(base);
      return;
    }
    onRename(`${next}${extension}`);
  };
  return (
    <div className="board-title">
      <input
        className="board-title__input"
        aria-label="Board name"
        value={value}
        spellCheck={false}
        size={Math.max(6, Math.min(value.length + 1, 40))}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setValue(base);
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
      />
    </div>
  );
}

function closestFontSize(size: number) {
  const sizes = Object.values(FONT_SIZES) as number[];
  return sizes.reduce(
    (best, s) => (Math.abs(s - size) < Math.abs(best - size) ? s : best),
    sizes[0],
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="board-field" role="group" aria-label={label}>
      <span className="board-field__label">{label}</span>
      {children}
    </div>
  );
}

function Swatches({
  swatches,
  value,
  dark,
  allowNone,
  onChange,
  label = "Color",
  flyout,
}: {
  swatches: Swatch[];
  value: string;
  dark: boolean;
  allowNone?: boolean;
  /** `commit: false` while a custom colour is being dragged; true once it settles. */
  onChange: (color: string, commit?: boolean) => void;
  label?: string;
  /** Open the custom picker beside the row (narrow tool column) instead of below it. */
  flyout?: boolean;
}) {
  const current = value.toLowerCase();
  const [picking, setPicking] = useState(false);
  // Any colour that isn't one of the presets came from the picker (or another
  // tool), and lights up the custom swatch.
  const custom =
    current !== "transparent" && !swatches.some((s) => s.light.toLowerCase() === current);
  return (
    <div className="board-swatches-wrap" data-flyout={flyout || undefined}>
      <div className="board-swatches">
        {allowNone && (
          <button
            type="button"
            className="board-swatch board-swatch--none"
            aria-label="No fill"
            aria-pressed={current === "transparent"}
            data-tip="No fill"
            onClick={() => onChange("transparent")}
          >
            <Icon name="noFill" size={18} />
          </button>
        )}
        {swatches.map((swatch) => (
          <button
            key={swatch.light}
            type="button"
            className="board-swatch"
            aria-label={swatch.name}
            aria-pressed={current === swatch.light.toLowerCase()}
            data-tip={swatch.name}
            style={{ "--swatch": dark ? swatch.dark : swatch.light } as React.CSSProperties}
            onClick={() => onChange(swatch.light)}
          />
        ))}
        <button
          type="button"
          className="board-swatch board-swatch--custom"
          aria-label="Custom color"
          aria-expanded={picking}
          aria-pressed={custom}
          data-tip={custom ? `Custom ${value}` : "Custom color"}
          style={
            custom ? ({ "--swatch": displayColor(value, dark) } as React.CSSProperties) : undefined
          }
          onClick={() => setPicking((open) => !open)}
        />
      </div>
      {picking && (
        <div className="board-color-flyout">
          <ColorPicker
            value={current === "transparent" ? "#9aa1ad" : value}
            label={`${label}: custom`}
            onChange={onChange}
          />
        </div>
      )}
    </div>
  );
}

function Segmented<T extends string | number | boolean | null>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: {
    value: T;
    icon?: IconName;
    text?: string;
    label: string;
    flip?: boolean;
    fontFamily?: string;
  }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="board-segmented">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className="board-segmented__option"
          aria-pressed={option.value === value}
          aria-label={option.label}
          data-tip={option.label}
          style={option.fontFamily ? { fontFamily: option.fontFamily } : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.icon ? <Icon name={option.icon} size={18} flip={option.flip} /> : option.text}
        </button>
      ))}
    </div>
  );
}

const HEADS: { value: Arrowhead; icon: IconName; label: string }[] = [
  { value: null, icon: "headNone", label: "None" },
  { value: "arrow", icon: "headArrow", label: "Arrow" },
  { value: "triangle", icon: "headTriangle", label: "Triangle" },
  { value: "dot", icon: "headDot", label: "Dot" },
  { value: "bar", icon: "headBar", label: "Bar" },
];

function IconButton({
  icon,
  label,
  onClick,
  disabled,
  tone,
  tipSide,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "danger";
  tipSide?: "bottom";
}) {
  return (
    <button
      type="button"
      className="board-icon-button"
      data-tone={tone}
      aria-label={label.split("  ")[0]}
      data-tip={label}
      data-tip-side={tipSide}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Top controls: history, zoom, menu
// ---------------------------------------------------------------------------

function ZoomLabel({ editor }: { editor: BoardEditor }) {
  useView(editor);
  return <>{Math.round(editor.viewport.zoom * 100)}%</>;
}

function TopControls({ editor, actions }: { editor: BoardEditor; actions: Actions }) {
  useUi(editor);
  return (
    <div className="board-top">
      {!editor.readOnly && (
        <div className="board-pill" role="toolbar" aria-label="History" onKeyDown={rovingFocus}>
          <IconButton
            icon="undo"
            label={`Undo  ${MOD}Z`}
            tipSide="bottom"
            disabled={!editor.canUndo}
            onClick={() => editor.undo()}
          />
          <IconButton
            icon="redo"
            label={`Redo  ${MOD}${SHIFT}Z`}
            tipSide="bottom"
            disabled={!editor.canRedo}
            onClick={() => editor.redo()}
          />
        </div>
      )}
      <div className="board-pill" role="toolbar" aria-label="Zoom" onKeyDown={rovingFocus}>
        <IconButton
          icon="minus"
          label={`Zoom out  ${MOD}−`}
          tipSide="bottom"
          onClick={() => editor.zoomBy(0.8)}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="board-zoom-label" aria-label="Zoom options">
              <ZoomLabel editor={editor} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="board-menu">
            <DropdownMenuItem onSelect={() => editor.zoomToFit()}>
              <Icon name="fit" size={18} />
              Zoom to fit
              <DropdownMenuShortcut>{SHIFT}1</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!editor.selected.size}
              onSelect={() => editor.zoomToFit({ selection: true })}
            >
              <Icon name="select" size={18} />
              Zoom to selection
              <DropdownMenuShortcut>{SHIFT}2</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => editor.resetZoom()}>
              <span className="board-menu__glyph">1:1</span>
              Actual size
              <DropdownMenuShortcut>{SHIFT}0</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton
          icon="plus"
          label={`Zoom in  ${MOD}+`}
          tipSide="bottom"
          onClick={() => editor.zoomBy(1.25)}
        />
      </div>
      <div className="board-pill">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="board-icon-button"
              aria-label="Board menu"
              data-tip="Board menu"
              data-tip-side="bottom"
            >
              <Icon name="more" size={18} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="board-menu min-w-56">
            {!editor.readOnly && (
              <DropdownMenuItem onSelect={() => editor.onRequestImage?.()}>
                <Icon name="image" size={18} />
                Insert image…
                <DropdownMenuShortcut>I</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => void actions.exportAs("png")}>
              <Icon name="download" size={18} />
              {editor.selected.size ? "Export selection as PNG" : "Export as PNG"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void actions.exportAs("svg")}>
              <Icon name="download" size={18} />
              {editor.selected.size ? "Export selection as SVG" : "Export as SVG"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void actions.copyPng()}>
              <Icon name="copy" size={18} />
              Copy as image
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={editor.showGrid}
              onCheckedChange={(on) => editor.setGrid(on === true)}
            >
              Dot grid
              <DropdownMenuShortcut>G</DropdownMenuShortcut>
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem onSelect={actions.openShortcuts}>
              <Icon name="keyboard" size={18} />
              Keyboard shortcuts
              <DropdownMenuShortcut>?</DropdownMenuShortcut>
            </DropdownMenuItem>
            {!editor.readOnly && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={editor.isEmpty}
                  onSelect={actions.clearBoard}
                  className="text-destructive focus:text-destructive"
                >
                  <Icon name="trash" size={18} />
                  Clear board
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

function BoardContextMenu({ editor, actions }: { editor: BoardEditor; actions: Actions }) {
  useUi(editor);
  const count = editor.selected.size;
  const selected = editor.selectedElements();
  const grouped = selected.some((el) => el.groupIds.length);
  const copy = () => {
    const text = editor.copySelection();
    if (text) void navigator.clipboard?.writeText(text).catch(() => {});
  };
  return (
    <ContextMenuContent className="board-menu min-w-56">
      {editor.selectionLocked ? (
        <ContextMenuItem onSelect={() => editor.toggleLock()}>
          Unlock
          <ContextMenuShortcut>
            {MOD}
            {SHIFT}L
          </ContextMenuShortcut>
        </ContextMenuItem>
      ) : count > 0 ? (
        <>
          <ContextMenuItem
            onSelect={() => {
              copy();
              editor.deleteSelection();
            }}
          >
            Cut<ContextMenuShortcut>{MOD}X</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={copy}>
            Copy<ContextMenuShortcut>{MOD}C</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void actions.pasteFromMenu()}>
            Paste<ContextMenuShortcut>{MOD}V</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => editor.duplicateSelection()}>
            Duplicate<ContextMenuShortcut>{MOD}D</ContextMenuShortcut>
          </ContextMenuItem>
          {count === 1 &&
            selected[0] &&
            selected[0].type !== "image" &&
            selected[0].type !== "freedraw" && (
              <ContextMenuItem onSelect={() => editor.editTextOf(selected[0])}>
                {selected[0].type === "text"
                  ? "Edit text"
                  : labelOf(selected[0], indexById(editor.elements))
                    ? "Edit label"
                    : "Add label"}
                <ContextMenuShortcut>↵</ContextMenuShortcut>
              </ContextMenuItem>
            )}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => editor.reorderSelection("front")}>
            Bring to front
            <ContextMenuShortcut>
              {MOD}
              {SHIFT}]
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => editor.reorderSelection("forward")}>
            Bring forward<ContextMenuShortcut>{MOD}]</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => editor.reorderSelection("backward")}>
            Send backward<ContextMenuShortcut>{MOD}[</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => editor.reorderSelection("back")}>
            Send to back
            <ContextMenuShortcut>
              {MOD}
              {SHIFT}[
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => editor.toggleLock()}>
            {selected.some((el) => el.type === "image") ? "Lock photo" : "Lock"}
            <ContextMenuShortcut>
              {MOD}
              {SHIFT}L
            </ContextMenuShortcut>
          </ContextMenuItem>
          {count > 1 && (
            <ContextMenuItem onSelect={() => editor.group()}>
              Group<ContextMenuShortcut>{MOD}G</ContextMenuShortcut>
            </ContextMenuItem>
          )}
          {grouped && (
            <ContextMenuItem onSelect={() => editor.ungroup()}>
              Ungroup
              <ContextMenuShortcut>
                {MOD}
                {SHIFT}G
              </ContextMenuShortcut>
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => void actions.exportAs("png")}>
            Export selection as PNG
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => editor.deleteSelection()}
          >
            Delete<ContextMenuShortcut>⌫</ContextMenuShortcut>
          </ContextMenuItem>
        </>
      ) : (
        <>
          <ContextMenuItem onSelect={() => void actions.pasteFromMenu()}>
            Paste<ContextMenuShortcut>{MOD}V</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => editor.selectAll()} disabled={editor.isEmpty}>
            Select all<ContextMenuShortcut>{MOD}A</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => editor.onRequestImage?.()}>
            Insert image…<ContextMenuShortcut>I</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => editor.zoomToFit()}>
            Zoom to fit<ContextMenuShortcut>{SHIFT}1</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => editor.setGrid(!editor.showGrid)}>
            {editor.showGrid ? "Hide dot grid" : "Show dot grid"}
            <ContextMenuShortcut>G</ContextMenuShortcut>
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  );
}

// ---------------------------------------------------------------------------
// Shortcuts
// ---------------------------------------------------------------------------

const SHORTCUTS: { title: string; items: [string, string][] }[] = [
  {
    title: "Tools",
    items: [
      ["V", "Select"],
      ["H  or hold Space", "Pan"],
      ["P", "Pen"],
      ["M", "Highlighter"],
      ["E", "Eraser"],
      ["R · O · D", "Rectangle · Ellipse · Diamond"],
      ["A · L", "Arrow · Line"],
      ["T", "Text"],
      ["S", "Sticky note"],
      ["I", "Insert image"],
    ],
  },
  {
    title: "Editing",
    items: [
      ["Double-click", "Edit text, or add a label"],
      [`${MOD}D`, "Duplicate"],
      ["Alt + drag", "Drag a copy"],
      ["Shift + drag", "Keep proportions · straight lines"],
      [`${MOD} + drag`, "Move without snapping"],
      ["Arrow keys", "Nudge (Shift for 10px)"],
      [`${MOD}G · ${MOD}${SHIFT}G`, "Group · Ungroup"],
      [`${MOD}${SHIFT}L`, "Lock · Unlock (right-click a locked item)"],
      [`${MOD}] · ${MOD}[`, "Forward · Backward"],
      [`${MOD}Z · ${MOD}${SHIFT}Z`, "Undo · Redo"],
    ],
  },
  {
    title: "View",
    items: [
      [`${SHIFT}1`, "Zoom to fit"],
      [`${SHIFT}2`, "Zoom to selection"],
      [`${SHIFT}0`, "Actual size"],
      [`${MOD}+ · ${MOD}−`, "Zoom in · out"],
      ["G", "Dot grid"],
    ],
  },
];

function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Board shortcuts</DialogTitle>
          <DialogDescription>
            Everything on the board can be done from the keyboard.
          </DialogDescription>
        </DialogHeader>
        <div className="board-shortcuts">
          {SHORTCUTS.map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              <dl>
                {group.items.map(([keys, action]) => (
                  <div key={action}>
                    <dt>{action}</dt>
                    <dd>
                      <kbd>{keys}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
