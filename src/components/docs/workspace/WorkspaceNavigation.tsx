import { BookOpen, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Feature navigation stays in the core shell when opening workspace content. */
export function WorkspaceNavigation({
  name,
  materials,
  materialCount,
  onSelect,
}: {
  name: string;
  materials: boolean;
  materialCount: number;
  onSelect: (materials: boolean) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border bg-background px-4 py-3 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <GraduationCap className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground" title={name}>
            {name}
          </p>
          <p className="text-xs text-muted-foreground">Exam Workspace</p>
        </div>
      </div>
      <nav
        aria-label="Workspace features"
        className="flex max-w-full items-center gap-1 rounded-lg bg-muted/60 p-1"
      >
        <Button
          variant="ghost"
          className={`h-8 px-3 text-xs coarse:min-h-11 ${!materials ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
          aria-current={!materials ? "page" : undefined}
          aria-label={materials ? "Back to exams" : "Exams"}
          onClick={() => onSelect(false)}
        >
          <GraduationCap aria-hidden="true" /> Exams
        </Button>
        <Button
          variant="ghost"
          className={`h-8 px-3 text-xs coarse:min-h-11 ${materials ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
          aria-current={materials ? "page" : undefined}
          onClick={() => onSelect(true)}
        >
          <BookOpen aria-hidden="true" /> Learning materials ({materialCount})
        </Button>
      </nav>
    </div>
  );
}
