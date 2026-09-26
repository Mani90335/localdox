// Catalog of AI actions grouped into Generate / Explain / Rewrite. Each action
// declares the context slice it needs (feeding token optimization) and the task
// instruction the prompt builder wraps. Adding an action is a one-entry change.

import {
  FileText,
  ListChecks,
  Zap,
  GitBranch,
  CheckSquare,
  GraduationCap,
  StickyNote,
  HelpCircle,
  Baby,
  MessageCircleQuestion,
  Sparkles,
  PencilLine,
  Expand,
  Shrink,
  SpellCheck,
} from "lucide-react";
import type { ContextPreference } from "./context";

export type ActionGroup = "generate" | "explain" | "rewrite";

export interface AIAction {
  id: string;
  label: string;
  group: ActionGroup;
  icon: typeof FileText;
  /** Largest context slice this action should ever send (selection still wins). */
  context: ContextPreference;
  /** Task instruction handed to the model. */
  instruction: string;
  /** True when the action needs the user's own question/prompt text. */
  requiresInput?: boolean;
  /** Placeholder for the freeform input when relevant. */
  inputPlaceholder?: string;
}

export const ACTIONS: AIAction[] = [
  // ---- Generate ----
  {
    id: "notes",
    label: "Notes",
    group: "generate",
    icon: StickyNote,
    context: "document",
    instruction:
      "Create clear, well-organized study notes from the content. Use markdown headings and bullet points. Keep it faithful to the source.",
  },
  {
    id: "summary",
    label: "Summary",
    group: "generate",
    icon: FileText,
    context: "document",
    instruction:
      "Write a concise summary of the content in a few short paragraphs. Capture the main ideas only.",
  },
  {
    id: "key-points",
    label: "Key points",
    group: "generate",
    icon: ListChecks,
    context: "document",
    instruction: "Extract the key points as a tight markdown bullet list. One idea per bullet.",
  },
  {
    id: "tldr",
    label: "TL;DR",
    group: "generate",
    icon: Zap,
    context: "document",
    instruction: "Give a one to three sentence TL;DR of the content.",
  },
  {
    id: "mermaid",
    label: "Mermaid diagram",
    group: "generate",
    icon: GitBranch,
    context: "document",
    instruction:
      "Produce a single Mermaid diagram that captures the structure or flow of the content. Output ONLY one ```mermaid fenced code block, no prose. Choose the most fitting diagram type (flowchart, sequence, mindmap, etc.).",
  },
  {
    id: "action-items",
    label: "Action items",
    group: "generate",
    icon: CheckSquare,
    context: "document",
    instruction:
      "Extract concrete action items as a markdown task list using `- [ ]` checkboxes. Only include real, actionable tasks.",
  },
  {
    id: "study-notes",
    label: "Study notes",
    group: "generate",
    icon: GraduationCap,
    context: "document",
    instruction:
      "Create study notes with definitions, key concepts, and a short set of self-test questions at the end. Use markdown.",
  },

  // ---- Explain ----
  {
    id: "explain",
    label: "Explain",
    group: "explain",
    icon: HelpCircle,
    context: "section",
    instruction: "Explain the content clearly and accurately. Define any jargon.",
  },
  {
    id: "simplify",
    label: "Simplify",
    group: "explain",
    icon: Baby,
    context: "selection",
    instruction:
      "Rewrite the content in plain, simple language a beginner can follow, without losing the meaning.",
  },
  {
    id: "answer",
    label: "Answer a question",
    group: "explain",
    icon: MessageCircleQuestion,
    context: "document",
    instruction:
      "Answer the user's question using only the provided content. If the answer is not in the content, say so.",
    requiresInput: true,
    inputPlaceholder: "Ask a question about this document…",
  },

  // ---- Rewrite ----
  {
    id: "improve",
    label: "Improve writing",
    group: "rewrite",
    icon: Sparkles,
    context: "selection",
    instruction:
      "Improve the writing for clarity, flow, and tone while preserving the meaning and markdown formatting. Output only the rewritten text.",
  },
  {
    id: "rewrite",
    label: "Rewrite",
    group: "rewrite",
    icon: PencilLine,
    context: "selection",
    instruction:
      "Rewrite the content. Follow any style guidance in the user's note; otherwise keep it professional. Output only the rewritten text.",
    inputPlaceholder: "Optional: how should it be rewritten? (e.g. more formal)",
  },
  {
    id: "expand",
    label: "Expand",
    group: "rewrite",
    icon: Expand,
    context: "selection",
    instruction:
      "Expand the content with more detail, examples, and depth while staying on topic. Output only the expanded text.",
  },
  {
    id: "shorten",
    label: "Shorten",
    group: "rewrite",
    icon: Shrink,
    context: "selection",
    instruction:
      "Make the content more concise without losing essential meaning. Output only the shortened text.",
  },
  {
    id: "fix-grammar",
    label: "Fix grammar",
    group: "rewrite",
    icon: SpellCheck,
    context: "selection",
    instruction:
      "Fix grammar, spelling, and punctuation. Change nothing else. Output only the corrected text.",
  },
];

export const ACTION_GROUPS: { id: ActionGroup; label: string }[] = [
  { id: "generate", label: "Generate" },
  { id: "explain", label: "Explain" },
  { id: "rewrite", label: "Rewrite" },
];

export function getAction(id: string): AIAction | undefined {
  return ACTIONS.find((a) => a.id === id);
}
