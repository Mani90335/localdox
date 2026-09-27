import { Sparkles } from "lucide-react";

// Floating Ask AI trigger, shown in the reader when a document is open.
export function AskAiButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Ask AI"
      title="Ask AI"
      className="fixed bottom-6 right-6 z-40 hidden lg:inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-all hover:shadow-xl active:scale-95"
    >
      <Sparkles className="h-4 w-4" />
      <span className="hidden sm:inline">Ask AI</span>
    </button>
  );
}
