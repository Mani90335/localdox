// Context selection + token optimization. Builds the SMALLEST context that
// satisfies an action so we never spend tokens sending a whole document when a
// selection or a single section will do.

/** What the caller can offer as context — resolved down to the minimum needed. */
export interface RawContext {
  /** Highlighted text, if any. Cheapest and always preferred when present. */
  selection?: string | null;
  /** The active section (subtopic) of the current document. */
  section?: { title: string; content: string } | null;
  /** The whole current document. */
  document?: { name: string; content: string } | null;
  /** Extra documents the user explicitly picked. */
  extraDocuments?: { name: string; content: string }[];
}

/** Which slice of context an action wants. */
export type ContextPreference = "selection" | "section" | "document" | "documents";

export interface ResolvedContext {
  text: string;
  /** Human label for what was actually sent, shown in the panel. */
  scopeLabel: string;
  approxTokens: number;
}

// ~4 chars per token is a good rough estimate for English prose.
const CHARS_PER_TOKEN = 4;
// Hard ceiling on context characters (~3k tokens). Keeps requests cheap and
// avoids blowing small model context windows.
const MAX_CHARS = 12000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Collapse runs of blank lines and trim — removes cheap-to-drop whitespace. */
function tidy(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

// Strip workspace-embed / artifact noise and raw data URLs that would waste
// tokens without helping the model reason about the prose.
function stripNoise(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\(data:[^)]+\)/g, "[image]")
    .replace(/\(data:[^)]+\)/g, "(embedded)")
    .replace(/^#{1,6}\s+/gm, (m) => m); // keep headings; placeholder for clarity
}

/** Middle-truncate over-long context, leaving head + tail with a marker. */
function cap(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  const half = Math.floor(MAX_CHARS / 2);
  return `${text.slice(0, half)}\n\n… [content trimmed to save tokens] …\n\n${text.slice(-half)}`;
}

export function resolveContext(raw: RawContext, preference: ContextPreference): ResolvedContext {
  let text = "";
  let scopeLabel = "";

  const selection = raw.selection?.trim();

  // Selection always wins when the action can work from it — the cheapest path.
  if (selection && preference !== "documents") {
    text = selection;
    scopeLabel = "Highlighted text";
  } else if (preference === "documents" && raw.extraDocuments?.length) {
    const docs = dedupeDocuments(raw.extraDocuments);
    text = docs.map((d) => `## ${d.name}\n\n${stripNoise(d.content)}`).join("\n\n---\n\n");
    scopeLabel = `${docs.length} document${docs.length > 1 ? "s" : ""}`;
  } else if (preference === "section" && raw.section?.content.trim()) {
    text = `## ${raw.section.title}\n\n${stripNoise(raw.section.content)}`;
    scopeLabel = `Section · ${raw.section.title}`;
  } else if (raw.document?.content.trim()) {
    text = stripNoise(raw.document.content);
    scopeLabel = `Document · ${raw.document.name}`;
  } else if (raw.section?.content.trim()) {
    text = stripNoise(raw.section.content);
    scopeLabel = `Section · ${raw.section.title}`;
  } else if (selection) {
    text = selection;
    scopeLabel = "Highlighted text";
  }

  const finalText = cap(tidy(text));
  return { text: finalText, scopeLabel, approxTokens: estimateTokens(finalText) };
}

// Drop duplicate documents (same name+content) so multi-select never double-pays.
function dedupeDocuments(docs: { name: string; content: string }[]) {
  const seen = new Set<string>();
  return docs.filter((d) => {
    const sig = `${d.name}::${d.content.length}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}
