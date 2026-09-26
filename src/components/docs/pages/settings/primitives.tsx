import type { ReactNode } from "react";

/**
 * Shared building blocks for the settings page, modelled on Apple's grouped
 * inset lists: one surface per group, hairline dividers between rows, and no
 * per-row shadows or borders. Chrome stays quiet so the controls read first.
 */

/** A titled block. The description is optional on purpose — most groups don't need one. */
export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  // Sentence case at text size, not shouty small-caps: a settings page is a
  // list of choices, and the headings are signposts between them rather than
  // labels demanding attention of their own.
  return (
    <section className="space-y-2.5">
      <div className="flex items-end justify-between gap-4 px-0.5">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h2>
          {description && (
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The grouped surface itself. Rows inside are separated by hairlines, never by gaps. */
export function Group({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-border bg-card divide-y divide-border ${className}`}
    >
      {children}
    </div>
  );
}

/** Label on the left, control on the right — the standard settings row. */
export function Row({
  label,
  hint,
  control,
  className = "",
}: {
  label: ReactNode;
  hint?: ReactNode;
  control?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-3 ${className}`}>
      <div className="min-w-0">
        <div className="truncate text-sm text-foreground">{label}</div>
        {hint && <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div>}
      </div>
      {control && <div className="flex shrink-0 items-center gap-1">{control}</div>}
    </div>
  );
}

/** Quiet placeholder for empty groups — no dashed borders, no icons shouting. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Small icon-only affordance used at the trailing edge of rows. */
export function IconButton({
  onClick,
  label,
  danger = false,
  disabled = false,
  title,
  children,
}: {
  onClick: () => void;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      className={`inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors disabled:pointer-events-none disabled:opacity-30 coarse:size-11 ${
        danger
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-accent hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
