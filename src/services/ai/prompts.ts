// Prompt assembly. Kept deliberately terse — a lean system prompt plus the
// action instruction and the resolved (minimal) context. Separated from provider
// and action logic so prompt tuning never touches transport or the catalog.

import type { ChatMessage } from "./types";
import type { AIAction } from "./actions";
import type { ResolvedContext } from "./context";

const SYSTEM_PROMPT =
  "You are a writing and study assistant embedded in a document reader. " +
  "Work only from the provided content. Respond in clean GitHub-flavored markdown. " +
  "Be direct — no preamble, no restating the request, no sign-off.";

export interface BuildPromptArgs {
  action?: AIAction;
  /** Freeform request text when there is no fixed action. */
  freeform?: string;
  /** The user's own note/question (for actions that take input). */
  userInput?: string;
  context: ResolvedContext;
}

export function buildMessages({
  action,
  freeform,
  userInput,
  context,
}: BuildPromptArgs): ChatMessage[] {
  const task = action ? action.instruction : freeform?.trim() || "Help with this content.";

  const parts: string[] = [task];
  if (userInput?.trim() && action?.id !== "answer") {
    parts.push(`Additional guidance: ${userInput.trim()}`);
  }
  if (action?.id === "answer" && userInput?.trim()) {
    parts.push(`Question: ${userInput.trim()}`);
  }
  parts.push("", "Content:", context.text || "(no content provided)");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: parts.join("\n") },
  ];
}
