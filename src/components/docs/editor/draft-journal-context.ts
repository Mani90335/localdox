import { createContext } from "react";

import type { DraftJournal } from "@/lib/workspace/draft-journal";

/**
 * Where the Markdown editor records its draft on every change, so the text
 * survives a tab closing before the autosave and the workspace write land.
 * Provided by DocsApp, which owns the workspace id and flushes the journal
 * on `pagehide`; an editor rendered without it simply does not journal.
 */
export const DraftJournalContext = createContext<{
  workspaceId: string | null;
  journal: DraftJournal;
  /** Ask for the staged drafts to be written soon. */
  schedule: () => void;
} | null>(null);
