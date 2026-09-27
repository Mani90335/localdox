import { createContext } from "react";
import type { MdFile } from "@/lib/markdown/markdown-utils";

/** Workspace conversion commands shared by each document's Export menu. */
export const ConversionContext = createContext<{
  files: MdFile[];
  runningId: string | null;
  onConvert: (id: string) => void;
  onCancel: () => void;
  onOpen: (id: string) => void;
} | null>(null);
