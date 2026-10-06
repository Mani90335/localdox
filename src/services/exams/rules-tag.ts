/**
 * Which ruleset an `.xam` paper runs under, named in a header at its top:
 *
 *   ---
 *   rules: Probability mock.xrule
 *   ---
 *
 * The link lives inside the paper so it travels with the file (download,
 * share, export) and can be read or changed in the paper's own editor. It
 * names the ruleset by file name: the workspace keeps names unique, and a
 * name is something a person can read and type.
 *
 * No imports, so the sidebar, reader and settings can use it without loading
 * the exam engine.
 */

/** Rulesets are managed in Settings ▸ Exam rules, not listed among documents. */
export const isRulesFile = (file: { name: string; kind?: string }) =>
  file.kind === "exam-rules" || /\.xrule$/i.test(file.name);

export interface HeaderField {
  key: string;
  value: string;
  /** 1-based line in the paper. */
  line: number;
}
interface Header {
  fields: HeaderField[];
  /** Characters the header spans, including both `---` lines and the newline after. */
  length: number;
  /** Lines the header spans. */
  lines: number;
}

const FIELD = /^([A-Za-z][\w-]*)[ \t]*:(.*)$/;
const unquote = (s: string) => {
  const t = s.trim();
  return t.length > 1 && (t[0] === '"' || t[0] === "'") && t.at(-1) === t[0] ? t.slice(1, -1) : t;
};

/**
 * The `---` block at the very top, when it is one. Only `key: value` lines
 * (and blank lines) count: a paper that merely starts with a rule line and a
 * heading is content, not a header, and is left to the parser as before.
 */
export function paperHeader(source: string): Header | null {
  const lines = source.split("\n");
  if (lines[0]?.trimEnd() !== "---") return null;
  const fields: HeaderField[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (line.trimEnd() === "---") {
      const length = lines.slice(0, i + 1).join("\n").length + (i + 1 < lines.length ? 1 : 0);
      return { fields, length, lines: i + 1 };
    }
    if (!line.trim()) continue;
    const match = FIELD.exec(line);
    if (!match) return null;
    fields.push({ key: match[1], value: unquote(match[2]), line: i + 1 });
  }
  return null;
}

/** The ruleset file the paper names, or null when it names none. */
export function rulesTag(source: string): string | null {
  return paperHeader(source)?.fields.find((f) => f.key === "rules")?.value || null;
}

/** The paper with its header naming `rulesName`, adding the header if it has none. */
export function withRulesTag(source: string, rulesName: string): string {
  const header = paperHeader(source);
  const line = `rules: ${rulesName}`;
  if (!header) return `---\n${line}\n---\n\n${source}`;
  const lines = source.split("\n");
  const existing = header.fields.find((f) => f.key === "rules");
  if (existing) lines[existing.line - 1] = line;
  else lines.splice(1, 0, line);
  return lines.join("\n");
}

/**
 * The paper with its header replaced by as many empty lines, so the question
 * parser never sees it and every error still points at the right line.
 */
export function blankHeader(source: string): string {
  const header = paperHeader(source);
  return header ? "\n".repeat(header.lines) + source.slice(header.length) : source;
}

/** A ruleset's display name: its `name` field, else the file name without `.xrule`. */
export function rulesetTitle(file: { name: string; content: string }): string {
  try {
    const name = (JSON.parse(file.content) as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  } catch {
    // Not valid JSON yet: the file name still identifies it.
  }
  return file.name.replace(/\.xrule$/i, "");
}

/** Remove only the rules link, preserving any other header fields. */
export function withoutRulesTag(source: string): string {
  const header = paperHeader(source);
  if (!header) return source;
  const lines = source.split("\n");
  const indexes = new Set(header.fields.filter((f) => f.key === "rules").map((f) => f.line - 1));
  if (header.fields.every((f) => f.key === "rules"))
    return source.slice(header.length).replace(/^\n/, "");
  return lines.filter((_, i) => !indexes.has(i)).join("\n");
}
