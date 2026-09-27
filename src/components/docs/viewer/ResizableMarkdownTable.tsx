import {
  Children,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type TableHTMLAttributes,
} from "react";

/** Width changes only affect this table; the surrounding reading column stays put. */
export function ResizableMarkdownTable({
  children,
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [wrap, setWrap] = useState(true);
  const [widths, setWidths] = useState<number[]>([]);
  const drag = useRef<{ index: number; x: number; widths: number[] } | null>(null);
  const measuredWidths = () =>
    Array.from(
      tableRef.current?.querySelectorAll("thead th") ?? [],
      (cell) => cell.getBoundingClientRect().width,
    );
  return (
    <div className="docs-table-container" data-wrap={wrap}>
      <div className="docs-table-controls">
        <label>
          <input
            type="checkbox"
            checked={wrap}
            onChange={(event) => setWrap(event.target.checked)}
          />{" "}
          Wrap words
        </label>
        <button type="button" onClick={() => setWidths([])}>
          Reset widths
        </button>
        <span>Drag column edges to resize</span>
      </div>
      <div className="docs-table-wrap">
        <table
          {...props}
          ref={tableRef}
          style={{
            ...props.style,
            width: widths.length
              ? widths.reduce((a, b) => a + b, 0)
              : wrap
                ? "100%"
                : "max-content",
            tableLayout: "auto",
          }}
        >
          {widths.length > 0 && (
            <colgroup>
              {widths.map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
          )}
          {children}
        </table>
        <div className="docs-table-resize-controls">
          {/* Overlay handles leave Markdown's custom header renderers intact. */}
          {Children.toArray(children).length > 0 && (
            <ColumnHandles
              tableRef={tableRef}
              widths={widths}
              onWidths={setWidths}
              measuredWidths={measuredWidths}
              drag={drag}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ColumnHandles({
  tableRef,
  widths,
  onWidths,
  measuredWidths,
  drag,
}: {
  tableRef: RefObject<HTMLTableElement | null>;
  widths: number[];
  onWidths: (widths: number[]) => void;
  measuredWidths: () => number[];
  drag: RefObject<{ index: number; x: number; widths: number[] } | null>;
}) {
  const [positions, setPositions] = useState<number[]>([]);
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const observer = new ResizeObserver(() => {
      let edge = 0;
      setPositions(
        Array.from(
          table.querySelectorAll("thead th"),
          (cell) => (edge += cell.getBoundingClientRect().width),
        ),
      );
    });
    observer.observe(table);
    return () => observer.disconnect();
  }, [tableRef]);
  return positions.map((position, index) => (
    <button
      key={index}
      type="button"
      className="docs-column-resizer"
      style={{ left: position - 5 }}
      aria-label={`Resize column ${index + 1}`}
      title="Drag to resize; use arrow keys for smaller adjustments"
      onPointerDown={(event) => {
        event.preventDefault();
        const initial = measuredWidths();
        drag.current = { index, x: event.clientX, widths: initial };
        onWidths(initial);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.index !== index) return;
        const next = [...current.widths];
        next[index] = Math.max(64, next[index] + event.clientX - current.x);
        onWidths(next);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const next = widths.length ? [...widths] : measuredWidths();
        next[index] = Math.max(64, next[index] + (event.key === "ArrowRight" ? 24 : -24));
        onWidths(next);
      }}
    />
  ));
}
