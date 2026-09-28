import { AlertCircle, Check, Circle, Loader2 } from "lucide-react";

/** What the reader is told about the workspace's durability. */
export type SaveState = "pending" | "saving" | "saved" | "error";

const LABEL: Record<SaveState, string> = {
  pending: "Changes pending",
  saving: "Saving…",
  saved: "Saved on this device",
  error: "Not saved",
};

const DETAIL: Record<SaveState, string> = {
  pending: "Your latest changes will be saved to this device in a moment.",
  saving: "Writing your changes to this device.",
  saved: "Everything in this workspace is stored in this browser on this device.",
  error: "Your latest changes are not stored on this device yet.",
};

/**
 * The persistent save state, rendered wherever the app's chrome is: the docked
 * sidebar, the mobile header, the collapsed rail (`compact`).
 *
 * Deliberately not a live region. It changes on every pause in typing, and
 * announcing each "Saving…" would drown a screen reader; the failure that needs
 * attention is announced by `SaveErrorBanner` instead.
 */
export function SaveIndicator({ state, compact = false }: { state: SaveState; compact?: boolean }) {
  const Icon =
    state === "error"
      ? AlertCircle
      : state === "saving"
        ? Loader2
        : state === "pending"
          ? Circle
          : Check;
  const tone =
    state === "error"
      ? "text-destructive"
      : state === "saved"
        ? "text-muted-foreground"
        : "text-amber-600 dark:text-amber-400";
  return (
    <span
      data-save-state={state}
      data-testid="save-indicator"
      title={DETAIL[state]}
      className={`inline-flex min-w-0 shrink items-center gap-1.5 text-xs ${tone}`}
    >
      <Icon
        aria-hidden
        className={`shrink-0 ${
          state === "pending"
            ? "h-2 w-2 fill-current"
            : `h-3.5 w-3.5 ${state === "saving" ? "animate-spin" : ""}`
        }`}
      />
      <span className={compact ? "sr-only" : "truncate"}>{LABEL[state]}</span>
    </span>
  );
}
