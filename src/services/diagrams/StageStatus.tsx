import { LoaderCircle } from "lucide-react";

/** Shared placeholder while a stage's chunk or render is in flight. */
export function StageSpinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function MermaidError({ error }: { error: string }) {
  return (
    <div className="min-h-40 overflow-auto p-4 text-sm">
      <div className="mb-2 font-semibold text-destructive">Mermaid animation error</div>
      <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{error}</pre>
    </div>
  );
}
