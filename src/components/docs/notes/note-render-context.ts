import { createContext } from "react";
import type { MathRendererType } from "@/services/math/types";

export interface NoteRenderSettings {
  /** The reader's math preference — part of the render cache's key. */
  renderer: MathRendererType;
  /** Whether this note is on (or near) screen; nothing is drawn before it is. */
  visible: boolean;
}

export const NoteRenderContext = createContext<NoteRenderSettings>({
  renderer: "auto",
  visible: true,
});
