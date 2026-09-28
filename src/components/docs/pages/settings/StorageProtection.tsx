import { useEffect, useRef, useState } from "react";

type ProtectionState =
  | "checking"
  | "protected"
  | "unprotected"
  | "unavailable"
  | "check-error"
  | "requesting"
  | "denied"
  | "request-error";

const MESSAGES: Record<ProtectionState, string> = {
  checking: "Checking storage protection…",
  protected: "Protected from automatic cleanup. The browser has granted persistent storage.",
  unprotected:
    "Not protected from automatic cleanup. The browser may remove local data when space is low.",
  unavailable: "Storage protection is unavailable in this browser. Keep backups of your work.",
  "check-error": "Couldn't check storage protection. Try checking again.",
  requesting: "Requesting protection from automatic cleanup…",
  denied:
    "The browser did not grant protection. It may still remove local data when space is low. You can try again later.",
  "request-error":
    "Couldn't request storage protection. Protection has not been confirmed. Try again.",
};

/** Ask only from a user action; the browser owns the grant, never a preference. */
export function StorageProtection() {
  const [state, setState] = useState<ProtectionState>("checking");
  const [checkAttempt, setCheckAttempt] = useState(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    async function check() {
      let next: ProtectionState;
      try {
        const storage = navigator.storage;
        if (typeof storage?.persisted !== "function") {
          next = "unavailable";
        } else if (await storage.persisted()) {
          next = "protected";
        } else {
          next = typeof storage.persist === "function" ? "unprotected" : "unavailable";
        }
      } catch {
        next = "check-error";
      }
      if (!cancelled) setState(next);
    }
    void check();
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [checkAttempt]);

  async function requestProtection() {
    setState("requesting");
    let next: ProtectionState;
    try {
      // Invoke directly in the click handler to preserve user activation.
      next = (await navigator.storage.persist()) ? "protected" : "denied";
    } catch {
      next = "request-error";
    }
    if (mounted.current) setState(next);
  }

  const canRequest = ["unprotected", "denied", "request-error", "requesting"].includes(state);

  return (
    <div className="space-y-3 px-4 py-3.5">
      <div className="text-sm text-foreground">Protect local data</div>
      <p
        role="status"
        aria-label="Storage protection"
        aria-atomic="true"
        className="text-sm leading-relaxed text-muted-foreground"
      >
        {MESSAGES[state]}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Export workspace backups regularly from Settings → Workspace → Export. Protection cannot
        prevent data loss if you clear site data or lose this device.
      </p>
      {(canRequest || state === "check-error") && (
        <button
          type="button"
          disabled={state === "requesting"}
          onClick={
            state === "check-error"
              ? () => {
                  setState("checking");
                  setCheckAttempt((attempt) => attempt + 1);
                }
              : requestProtection
          }
          className="min-h-11 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-60"
        >
          {state === "check-error"
            ? "Check again"
            : state === "requesting"
              ? "Requesting protection…"
              : state === "request-error"
                ? "Try protection again"
                : "Protect local data"}
        </button>
      )}
    </div>
  );
}
