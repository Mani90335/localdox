import { deferredModule } from "@/lib/app/deferred-module";
import type { NotesPanelProps } from "./NotesPanel";

export type { NoteSourceState, NotesTab } from "./NotesPanel";
export type { InsertRequest, InsertTarget, RoughWorkProps } from "./RoughWorkPanel";

/**
 * The Notes panel, downloaded the first time it opens. It renders Markdown,
 * and react-markdown has no place in the startup bundle of an app whose
 * reader may never open the panel. `deferredModule` rather than React.lazy:
 * the panel stays open across reloads, and Suspense's reveal throttle would
 * hold it back ~300 ms on every one (see deferred-module.ts).
 */
const panel = deferredModule(() => import("./NotesPanel"));

export function NotesPanel(props: NotesPanelProps) {
  const mod = panel.useModule();
  if (!mod) return <div role="status" aria-label="Loading notes" className="h-full" />;
  return <mod.NotesPanel {...props} />;
}
