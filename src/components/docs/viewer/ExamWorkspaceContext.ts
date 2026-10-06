import { createContext } from "react";
import type { MdFile } from "@/lib/markdown/markdown-utils";

/**
 * What an `.xam` needs from its workspace to be studied in place: the other
 * files (its rules and images), the folders that scope those rules, and the
 * actions it takes on them. Practice uses these in every workspace; timed
 * exams run only when examEnabled is true.
 */
export interface ExamWorkspace {
  workspaceId: string;
  examEnabled: boolean;
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

/** Practice can use rules and assets in any workspace. */
export const PracticeWorkspaceContext = ExamWorkspaceContext;
