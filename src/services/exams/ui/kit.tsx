/**
 * The Exam Sessions component kit. Small, unopinionated wrappers over the
 * `ex-` classes in exams.css. Build screens from these, not from raw classes,
 * so focus rings, target sizes and states stay consistent.
 */
import {
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { X } from "lucide-react";
import { usePortalContainer } from "@/hooks/use-portal-container";

type Variant = "primary" | "secondary" | "ghost" | "danger";
export function Button({
  variant = "secondary",
  block,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean }) {
  return (
    <button
      type={type}
      className={[
        "ex-btn",
        variant !== "secondary" && `ex-btn--${variant}`,
        block && "ex-btn--block",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
export function LinkButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={["ex-link", className].filter(Boolean).join(" ")} {...props} />
  );
}

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";
export function Chip({
  tone = "neutral",
  large,
  children,
  title,
}: {
  tone?: Tone;
  large?: boolean;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={["ex-chip", tone !== "neutral" && `ex-chip--${tone}`, large && "ex-chip--lg"]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}

export function StatBlocks({
  items,
  label,
}: {
  items: { label: string; value: ReactNode; detail?: ReactNode }[];
  label?: string;
}) {
  return (
    <dl className="ex-stats" aria-label={label} style={{ margin: 0 }}>
      {items.map((item) => (
        <div className="ex-stat" key={item.label}>
          <dt>{item.label}</dt>
          <dd>
            {item.value}
            {item.detail !== undefined && <small>{item.detail}</small>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      className="ex-bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
    >
      <span style={{ width: `${v}%` }} />
    </div>
  );
}
export function ProgressRing({
  value,
  max,
  label,
  children,
}: {
  value: number;
  max: number;
  label: string;
  children: ReactNode;
}) {
  const r = 14,
    c = 2 * Math.PI * r,
    share = max ? Math.min(1, value / max) : 0;
  return (
    <div
      className="ex-ring"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
        <circle className="track" cx="18" cy="18" r={r} fill="none" strokeWidth="4" />
        <circle
          className="value"
          cx="18"
          cy="18"
          r={r}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - share)}
        />
      </svg>
      <span>{children}</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  actions,
  quiet,
  headingLevel = 2,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  quiet?: boolean;
  headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className={quiet ? "ex-empty ex-empty--quiet" : "ex-empty"}>
      {icon && (
        <span className="ex-empty-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <H>{title}</H>
      {children && <p>{children}</p>}
      {actions && <div className="ex-row">{actions}</div>}
    </div>
  );
}
export function Skeleton({
  height = 16,
  width = "100%",
}: {
  height?: number;
  width?: number | string;
}) {
  return <div className="ex-skel" style={{ height, width }} aria-hidden="true" />;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="ex-page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="ex-muted">{subtitle}</p>}
      </div>
      {actions && <div className="ex-row">{actions}</div>}
    </header>
  );
}

/** WAI-ARIA tabs with roving focus (arrow keys, Home/End). */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idBase,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  idBase: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const last = tabs.length - 1,
      next =
        e.key === "ArrowRight"
          ? (i + 1) % tabs.length
          : e.key === "ArrowLeft"
            ? (i - 1 + tabs.length) % tabs.length
            : e.key === "Home"
              ? 0
              : e.key === "End"
                ? last
                : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div className="ex-tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          className="ex-tab"
          id={`${idBase}-tab-${t.id}`}
          aria-controls={`${idBase}-panel-${t.id}`}
          aria-selected={value === t.id}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
export function TabPanel({
  idBase,
  id,
  children,
}: {
  idBase: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${id}`}
      aria-labelledby={`${idBase}-tab-${id}`}
      className="ex-stack"
    >
      {children}
    </div>
  );
}

/** Single-choice segmented control (a radiogroup). */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="ex-seg" role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const step =
              e.key === "ArrowRight" || e.key === "ArrowDown"
                ? 1
                : e.key === "ArrowLeft" || e.key === "ArrowUp"
                  ? -1
                  : 0;
            if (!step) return;
            e.preventDefault();
            const n = (i + step + options.length) % options.length;
            onChange(options[n].value);
            refs.current[n]?.focus();
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Confirm dialog: focus trap, Esc cancels, scrim without blur, rendered at the
 * top of the stacking order (and inside the fullscreen element when needed).
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
  wide?: boolean;
}) {
  const container = usePortalContainer();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal container={container}>
        <DialogPrimitive.Overlay className="ex-portal ex-scrim" />
        <DialogPrimitive.Content
          className={wide ? "ex-portal ex-dialog ex-dialog--wide" : "ex-portal ex-dialog"}
          // Radix links its Description automatically; without one, opt out.
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <DialogPrimitive.Title className="ex-dialog-title">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="ex-dialog-desc">
              {description}
            </DialogPrimitive.Description>
          ) : null}
          {children && <div className="ex-dialog-body">{children}</div>}
          <div className="ex-dialog-footer">{footer}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
export const DialogClose = DialogPrimitive.Close;

/** Bottom sheet for small screens (same a11y as Dialog). */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  const container = usePortalContainer();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal container={container}>
        <DialogPrimitive.Overlay className="ex-portal ex-scrim" />
        <DialogPrimitive.Content className="ex-portal ex-sheet" aria-describedby={undefined}>
          <div className="ex-sheet-grip" aria-hidden="true" />
          <div className="ex-section-head" style={{ alignItems: "center", marginBottom: 12 }}>
            <DialogPrimitive.Title className="ex-dialog-title">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" className="ex-btn--icon" aria-label="Close">
                <X size={18} />
              </Button>
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Overflow menu ("Manage plan"). */
export function OverflowMenu({
  trigger,
  items,
}: {
  trigger: ReactNode;
  items: { label: string; icon?: ReactNode; onSelect: () => void }[];
}) {
  const container = usePortalContainer();
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal container={container}>
        <Menu.Content className="ex-portal ex-menu" align="end" sideOffset={6}>
          {items.map((item) => (
            <Menu.Item key={item.label} className="ex-menu-item" onSelect={item.onSelect}>
              {item.icon}
              {item.label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * The single toast slot. It floats in a fixed position; pages reserve bottom
 * padding for it so it never hides the end of the content.
 */
export function ToastRegion({ children, raised }: { children: ReactNode; raised?: boolean }) {
  return <div className={raised ? "ex-toasts ex-toasts--raised" : "ex-toasts"}>{children}</div>;
}
export function Toast({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="ex-toast" role="alert">
      <pre>{children}</pre>
      {actions && <div className="ex-row">{actions}</div>}
    </div>
  );
}

export function useStableId(prefix: string) {
  return `${prefix}-${useId().replace(/:/g, "")}`;
}

/**
 * Click-to-zoom wrapper. The thumbnail is a real button; the enlarged view is
 * a modal with a close button, Esc to dismiss, and a scrollable stage.
 */
export function Zoomable({ label, children }: { label: string; children: ReactNode }) {
  const container = usePortalContainer();
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger asChild>
        <button type="button" className="ex-zoom" aria-label={`Enlarge ${label}`}>
          {children}
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal container={container}>
        <DialogPrimitive.Overlay className="ex-portal ex-scrim" />
        <DialogPrimitive.Content className="ex-portal ex-lightbox" aria-describedby={undefined}>
          <div className="ex-lightbox-head">
            <DialogPrimitive.Title className="ex-small">{label}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" className="ex-btn--icon" aria-label="Close">
                <X size={18} />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="ex-lightbox-stage">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
