/**
 * Workspace names are how the reader tells one workspace from another in the
 * switcher, so two carrying the same name is a real ambiguity rather than a
 * cosmetic one. Compared case- and whitespace-insensitively: "Notes" and
 * "notes " are the same name to a person reading the list.
 */
export function normalizeWorkspaceName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** `Notes` → `Notes (2)` when a workspace already carries that name. */
export function availableWorkspaceName(name: string, existing: { name: string }[]): string {
  const taken = new Set(existing.map((w) => normalizeWorkspaceName(w.name)));
  const base = name.trim() || "Workspace";
  if (!taken.has(normalizeWorkspaceName(base))) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.has(normalizeWorkspaceName(candidate))) return candidate;
  }
}

/**
 * Asks for a different workspace name until one is free, or the reader cancels.
 *
 * `existing` holds the names already in use; `excludeId` lets a rename keep its
 * own current name. Returns the accepted name, or `null` when the reader backs
 * out of the prompt.
 */
export function resolveWorkspaceName(
  proposed: string,
  existing: { id: string; name: string }[],
  opts: { excludeId?: string; whatIsIt?: string } = {},
): string | null {
  const { excludeId, whatIsIt = "A workspace" } = opts;
  const taken = new Set(
    existing.filter((w) => w.id !== excludeId).map((w) => normalizeWorkspaceName(w.name)),
  );
  let candidate = proposed.trim();
  while (candidate && taken.has(normalizeWorkspaceName(candidate))) {
    const next = window.prompt(
      `${whatIsIt} named “${candidate}” already exists. Enter a different name:`,
      candidate,
    );
    if (next == null) return null; // cancelled — leave everything untouched
    candidate = next.trim();
  }
  return candidate || null;
}
