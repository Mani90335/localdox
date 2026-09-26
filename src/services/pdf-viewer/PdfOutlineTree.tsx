import type { PdfOutlineNode } from "./types";

/** A PDF's table of contents, resolved to plain page numbers by `PdfReader`. */
export function PdfOutlineTree({
  outline,
  currentPage,
  onSelect,
}: {
  outline: PdfOutlineNode[];
  currentPage: number;
  onSelect: (pageNumber: number) => void;
}) {
  return (
    <ul className="flex flex-col p-2 text-sm">
      {outline.map((node, i) => (
        <PdfOutlineItem
          key={i}
          node={node}
          currentPage={currentPage}
          onSelect={onSelect}
          depth={0}
        />
      ))}
    </ul>
  );
}

function PdfOutlineItem({
  node,
  currentPage,
  onSelect,
  depth,
}: {
  node: PdfOutlineNode;
  currentPage: number;
  onSelect: (pageNumber: number) => void;
  depth: number;
}) {
  const isCurrent = node.pageNumber !== null && node.pageNumber === currentPage;
  return (
    <li>
      <button
        type="button"
        onClick={() => node.pageNumber !== null && onSelect(node.pageNumber)}
        disabled={node.pageNumber === null}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        title={node.title}
        className={`block w-full truncate rounded-md py-1.5 pr-2 text-left text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-60 ${
          isCurrent
            ? "bg-primary/10 text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        }`}
      >
        {node.title || "Untitled section"}
      </button>
      {node.items.length > 0 && (
        <ul>
          {node.items.map((child, i) => (
            <PdfOutlineItem
              key={i}
              node={child}
              currentPage={currentPage}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
