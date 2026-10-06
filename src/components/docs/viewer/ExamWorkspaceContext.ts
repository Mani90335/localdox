import { createContext } from "react";
import type { MdFile } from "@/lib/markdown/markdown-utils";

/**
 * What an `.xam` needs from its workspace to be studied in place: the other
 * files (its rules and images), the folders that scope those rules, and the
 * actions it takes on them. Provided only in Exam Workspaces; everywhere else the context is
 * null and an `.xam` is a document like any other.
 */
export interface ExamWorkspace {
  workspaceId: string;
  /**
   * Settings is open over the reader. The paper lets go of exam storage (its
   * writer lock) so Settings can manage or delete exam data.
   */
  paused: boolean;
  files: MdFile[];
  folders: { id: string; parentId?: string | null }[];
  /** Show a ruleset where rulesets are edited: Settings ▸ Exam rules. */
  openRules: (fileId: string) => void;
  /**
   * Adds a text file beside the others without opening it. Returns its id and
   * the name it got, which differs from the one asked for when that is taken.
   */
  addTextFile: (
    name: string,
    content: string,
    folderId: string | null,
  ) => { id: string; name: string };
}
export const ExamWorkspaceContext = createContext<ExamWorkspace | null>(null);
