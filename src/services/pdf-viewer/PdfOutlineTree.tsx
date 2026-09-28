import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  flattenOutline,
  initialExpanded,
  OUTLINE_VIRTUALIZE_ROWS,
  windowRange,
  type OutlineRow,
  type PdfOutlineResolver,
} from "./pdf-outline";
import type { PdfOutlineNode } from "./types";

const ROW_HEIGHT = 28;
/** The list's top/bottom padding, in px. */
const LIST_PADDING = 8;
const OVERSCAN = 12;
/** Deeper levels stop indenting further so titles stay readable in a narrow sidebar. */
const MAX_INDENT_LEVEL = 12;

/**
 * A PDF's table of contents as a keyboard-navigable tree. Destinations
 * resolve to pages only for rows on screen (for the current-page highlight)
 * and on click; a large outline opens collapsed to its top levels; and past
 * `OUTLINE_VIRTUALIZE_ROWS` visible rows only the rows in view are mounted.
 * Focus stays on the tree itself (`aria-activedescendant`), so a row
 * scrolling out of the mounted window never drops keyboard focus.
 */
export function PdfOutlineTree({
  outline,
  currentPage,
  onSelect,
  resolver,
}: {
  outline: PdfOutlineNode[];
  currentPage: number;
  onSelect: (pageNumber: number) => void;
  resolver: PdfOutlineResolver;
}) {
  const [expanded, setExpanded] = useState(() => initialExpanded(outline));
  const [shownOutline, setShownOutline] = useState(outline);
  if (shownOutline !== outline) {
    setShownOutline(outline);
    setExpanded(initialExpanded(outline));
  }

  const rows = useMemo(() => flattenOutline(outline, expanded), [outline, expanded]);
  const virtual = rows.length > OUTLINE_VIRTUALIZE_ROWS;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ first: 0, last: -1 });
  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const next = windowRange(
      rows.length,
      Math.max(0, el.scrollTop - LIST_PADDING),
      el.clientHeight,
      ROW_HEIGHT,
      OVERSCAN,
    );
    setRange((prev) => (prev.first === next.first && prev.last === next.last ? prev : next));
  }, [rows.length]);
  useLayoutEffect(() => {
    measure();
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const first = virtual ? range.first : 0;
  const last = virtual ? Math.min(range.last, rows.length - 1) : rows.length - 1;
  const mounted = useMemo(() => rows.slice(first, last + 1), [rows, first, last]);

  // Pages for the rows on screen: the current-page highlight and disabled
  // (unresolvable) entries. Rows that scroll away before their turn are dropped.
  useEffect(() => {
    resolver.prefetch(mounted.map((row) => row.node.dest));
  }, [resolver, mounted]);

  // Re-render once per frame as pages resolve, not once per page.
  const [, setResolvedVersion] = useState(0);
  useEffect(() => {
    let frame = 0;
    const unsubscribe = resolver.subscribe(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setResolvedVersion((v) => v + 1);
      });
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [resolver]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIndex = Math.max(
    0,
    rows.findIndex((row) => row.node.id === activeId),
  );
  const active: OutlineRow | undefined = rows[activeIndex];

  // Keyboard moves bring the active row into view, first scrolling the window
  // to it when it isn't mounted.
  const revealActive = useRef(false);
  useLayoutEffect(() => {
    if (!revealActive.current || !active) return;
    const el = scrollRef.current;
    const row = el?.querySelector<HTMLElement>(`[data-outline-id="${active.node.id}"]`);
    if (row) {
      revealActive.current = false;
      row.scrollIntoView({ block: "nearest" });
    } else if (el) {
      el.scrollTop = LIST_PADDING + activeIndex * ROW_HEIGHT - el.clientHeight / 2;
      measure();
    }
  }, [active, activeIndex, range, measure]);

  const toggle = (id: string, open?: boolean) =>
    setExpanded((prev) => {
      const isOpen = prev.has(id);
      if (open === isOpen) return prev;
      const next = new Set(prev);
      if (isOpen) next.delete(id);
      else next.add(id);
      return next;
    });

  // Latest click wins, if an earlier entry's destination is still resolving.
  const activation = useRef(0);
  useEffect(() => () => void activation.current++, []);
  const activate = (node: PdfOutlineNode) => {
    const token = ++activation.current;
    const known = resolver.peek(node.dest);
    if (typeof known === "number") {
      onSelect(known);
      return;
    }
    if (known === null) return;
    void resolver.resolve(node.dest).then((page) => {
      if (page !== null && token === activation.current) onSelect(page);
    });
  };

  const moveTo = (index: number) => {
    const row = rows[Math.min(Math.max(index, 0), rows.length - 1)];
    if (!row) return;
    revealActive.current = true;
    setActiveId(row.node.id);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!active || event.altKey || event.ctrlKey || event.metaKey) return;
    const { node } = active;
    const hasChildren = node.items.length > 0;
    const isOpen = expanded.has(node.id);
    switch (event.key) {
      case "ArrowDown":
        moveTo(activeIndex + 1);
        break;
      case "ArrowUp":
        moveTo(activeIndex - 1);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(rows.length - 1);
        break;
      case "ArrowRight":
        if (hasChildren && !isOpen) toggle(node.id, true);
        else if (hasChildren) moveTo(activeIndex + 1);
        break;
      case "ArrowLeft":
        if (hasChildren && isOpen) toggle(node.id, false);
        else if (active.parentId !== null)
          moveTo(rows.findIndex((row) => row.node.id === active.parentId));
        break;
      case "Enter":
      case " ":
        activate(node);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const treeId = useId();
  const domId = (id: string) => `${treeId}-${id}`;

  return (
    <div
      ref={scrollRef}
      role="tree"
      aria-label="Contents"
      tabIndex={0}
      aria-activedescendant={
        active && activeIndex >= first && activeIndex <= last ? domId(active.node.id) : undefined
      }
      onKeyDown={onKeyDown}
      onScroll={virtual ? measure : undefined}
      className="pdf-outline-tree group/tree min-h-0 flex-1 overflow-y-auto px-2 text-sm focus-visible:outline-none"
      style={{ paddingTop: LIST_PADDING, paddingBottom: LIST_PADDING }}
    >
      {first > 0 && <div aria-hidden style={{ height: first * ROW_HEIGHT }} />}
      {mounted.map((row, i) => {
        const index = first + i;
        const { node } = row;
        const page = resolver.peek(node.dest);
        const unavailable = page === null;
        const isCurrent = typeof page === "number" && page === currentPage;
        const hasChildren = node.items.length > 0;
        const isOpen = hasChildren && expanded.has(node.id);
        const isActive = index === activeIndex;
        return (
          <div
            key={node.id}
            id={domId(node.id)}
            data-outline-id={node.id}
            role="treeitem"
            aria-level={row.level}
            aria-posinset={row.posInSet}
            aria-setsize={row.setSize}
            aria-expanded={hasChildren ? isOpen : undefined}
            aria-disabled={unavailable || undefined}
            aria-current={isCurrent ? "page" : undefined}
            title={node.title}
            onClick={() => {
              setActiveId(node.id);
              activate(node);
            }}
            style={{
              height: ROW_HEIGHT,
              paddingLeft: Math.min(row.level - 1, MAX_INDENT_LEVEL) * 14,
            }}
            className={`flex cursor-pointer items-center rounded-md pr-2 text-xs font-medium transition-colors ${
              isCurrent
                ? "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            } ${unavailable ? "cursor-default opacity-60" : ""} ${
              isActive
                ? "group-focus-visible/tree:ring-2 group-focus-visible/tree:ring-ring group-focus-visible/tree:ring-inset"
                : ""
            }`}
          >
            <span
              aria-hidden
              onClick={(event) => {
                if (!hasChildren) return;
                event.stopPropagation();
                setActiveId(node.id);
                toggle(node.id);
              }}
              className="flex size-5 shrink-0 items-center justify-center"
            >
              {hasChildren && (
                <ChevronRight
                  className={`size-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
                />
              )}
            </span>
            <span className="truncate">{node.title || "Untitled section"}</span>
          </div>
        );
      })}
      {virtual && last < rows.length - 1 && (
        <div aria-hidden style={{ height: (rows.length - 1 - last) * ROW_HEIGHT }} />
      )}
    </div>
  );
}
