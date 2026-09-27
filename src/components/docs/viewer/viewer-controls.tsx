/**
 * Small controls shared across per-file-type viewers' `ViewerHeader` actions.
 *
 * Pulled out of `DocumentViewer.tsx` so viewers that live in their own
 * service folder (the PDF reader) can match the same icon-button look
 * without duplicating it or creating a dependency back on the dispatcher.
 */
export function IconBtn({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Pressed/toggled visual state, e.g. an open sidebar or search panel. */
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent ${
        active ? "bg-accent text-foreground" : "text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}
