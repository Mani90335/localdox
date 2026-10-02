/**
 * A segmented control: one rounded surface, hairline dividers between its
 * buttons, no gaps for the diagram to show through. Grouping by meaning — and
 * spacing the groups — is what tells the eye which buttons belong together,
 * so no group needs a label to explain itself.
 */
export function Tray({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-auto flex shrink-0 items-center overflow-hidden rounded-lg border border-border/70 bg-background/85 shadow-sm ring-1 ring-black/2 backdrop-blur-md [&>*+*]:border-l [&>*+*]:border-border/60">
      {children}
    </div>
  );
}

export function TrayButton({
  onClick,
  label,
  title,
  busy,
  active,
  children,
}: {
  onClick: (event: React.MouseEvent) => void;
  label: string;
  /** Tooltip, when it should differ from the accessible name. */
  title?: string;
  busy?: boolean;
  /** Renders the pressed state for a button that toggles something on. */
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      aria-pressed={active}
      title={title ?? label}
      className={`inline-flex h-8 w-8 items-center justify-center transition-colors duration-100 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent/80 disabled:pointer-events-none disabled:opacity-60 coarse:h-11 coarse:w-11 ${
        active ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}
