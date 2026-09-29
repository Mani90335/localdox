import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "@tanstack/react-router";
import {
  X,
  Sparkles,
  Send,
  Square,
  Copy,
  Check,
  CornerDownLeft,
  FilePlus2,
  Highlighter,
  FileText,
  Files,
  KeyRound,
} from "lucide-react";
import { useAI, type AskArgs } from "./use-ai";
import { ACTIONS, ACTION_GROUPS, getAction } from "./actions";
import type { ContextPreference } from "./context";

/** Which context slice the panel's selector is set to. */
type ContextMode = "selection" | "document" | "documents";

export interface AskAiFile {
  id: string;
  name: string;
  content: string;
}

export interface AskAiPrefill {
  selection?: string | null;
  actionId?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Selection + action to seed the panel with (from a right-click quick action). */
  prefill?: AskAiPrefill | null;
  /** Live selection captured when the panel opened. */
  initialSelection?: string | null;
  activeFile: AskAiFile | null;
  activeSection: { title: string; content: string } | null;
  files: AskAiFile[];
  onInsert: (markdown: string) => void;
  onCreateDoc: (name: string, content: string) => void;
}

const stripExt = (name: string) => name.replace(/\.(md|markdown|mdx|mmd|mermaid|txt)$/i, "");

export function AskAiPanel({
  open,
  onClose,
  prefill,
  initialSelection,
  activeFile,
  activeSection,
  files,
  onInsert,
  onCreateDoc,
}: Props) {
  const ai = useAI();
  const [selection, setSelection] = useState<string>("");
  const [contextMode, setContextMode] = useState<ContextMode>("document");
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  // Seed selection + context mode whenever the panel opens or the prefill changes.
  useEffect(() => {
    if (!open) return;
    const sel = (prefill?.selection ?? initialSelection ?? "").trim();
    setSelection(sel);
    setContextMode(sel ? "selection" : "document");
    setActiveActionId(prefill?.actionId ?? null);
    setInput("");
    ai.reset();
    void ai.refreshConfigured();
    // Auto-run a prefilled quick action.
    if (prefill?.actionId && !getAction(prefill.actionId)?.requiresInput) {
      // Defer so state above is committed before the request builds context.
      const timer = setTimeout(() => run(prefill.actionId!, sel), 0);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill, initialSelection]);

  // Autoscroll the streaming output.
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [ai.text]);

  const preferenceFor = (mode: ContextMode): ContextPreference | undefined => {
    if (mode === "selection") return "selection";
    if (mode === "documents") return "documents";
    return undefined; // "document" → let the action decide (section vs whole doc)
  };

  const run = (actionId: string | null, sel?: string) => {
    const effectiveSelection = sel ?? selection;
    setActiveActionId(actionId);
    const action = actionId ? getAction(actionId) : undefined;

    const args: AskArgs = {
      actionId: actionId ?? undefined,
      freeform: actionId ? undefined : input.trim(),
      userInput: action?.requiresInput || (action && input.trim()) ? input.trim() : undefined,
      contextPreference: preferenceFor(contextMode),
      rawContext: {
        selection: contextMode === "selection" ? effectiveSelection : null,
        section: activeSection,
        document: activeFile ? { name: activeFile.name, content: activeFile.content } : null,
        extraDocuments:
          contextMode === "documents"
            ? files
                .filter((f) => pickedIds.includes(f.id))
                .map((f) => ({ name: f.name, content: f.content }))
            : undefined,
      },
    };
    void ai.ask(args);
  };

  const canRun = useMemo(() => {
    if (contextMode === "documents" && pickedIds.length === 0) return false;
    if (contextMode === "selection" && !selection.trim()) return false;
    return true;
  }, [contextMode, pickedIds, selection]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30 flex lg:z-70 lg:justify-end pb-[env(safe-area-inset-bottom)] mb-16 lg:mb-0 lg:pb-0">
      <div
        className="absolute inset-0 bg-foreground/20 backdrop-blur-sm hidden lg:block"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full flex-col bg-background animate-in slide-in-from-right duration-200 lg:max-w-md lg:border-l border-border lg:shadow-2xl">
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="flex-1 text-sm font-semibold">Ask AI</span>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!ai.configured ? (
          <NoKeyState onClose={onClose} />
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* Context selector */}
              <div className="border-b border-border p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Context
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <ContextTab
                    icon={Highlighter}
                    label="Selection"
                    active={contextMode === "selection"}
                    disabled={!selection.trim()}
                    onClick={() => setContextMode("selection")}
                  />
                  <ContextTab
                    icon={FileText}
                    label="This doc"
                    active={contextMode === "document"}
                    disabled={!activeFile}
                    onClick={() => setContextMode("document")}
                  />
                  <ContextTab
                    icon={Files}
                    label="Documents"
                    active={contextMode === "documents"}
                    onClick={() => setContextMode("documents")}
                  />
                </div>

                {contextMode === "selection" && selection.trim() && (
                  <p className="mt-2 line-clamp-3 rounded-md border border-border bg-muted/40 p-2 text-xs italic text-muted-foreground">
                    &ldquo;{selection.trim()}&rdquo;
                  </p>
                )}
                {contextMode === "documents" && (
                  <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-1.5">
                    {files.length === 0 && (
                      <p className="p-2 text-xs text-muted-foreground">
                        No documents in this workspace.
                      </p>
                    )}
                    {files.map((f) => (
                      <label
                        key={f.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                      >
                        <input
                          type="checkbox"
                          checked={pickedIds.includes(f.id)}
                          onChange={(e) =>
                            setPickedIds((prev) =>
                              e.target.checked ? [...prev, f.id] : prev.filter((id) => id !== f.id),
                            )
                          }
                        />
                        <span className="truncate">{stripExt(f.name)}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="space-y-4 p-4">
                {ACTION_GROUPS.map((group) => (
                  <div key={group.id}>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {group.label}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {ACTIONS.filter((a) => a.group === group.id).map((action) => {
                        const Icon = action.icon;
                        const active = activeActionId === action.id;
                        return (
                          <button
                            key={action.id}
                            disabled={!canRun || ai.isStreaming}
                            onClick={() => run(action.id)}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                              active
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                            }`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {action.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Output */}
              {(ai.text || ai.isStreaming || ai.error || ai.status === "stopped") && (
                <div className="border-t border-border p-4">
                  {ai.scopeLabel && (
                    <div className="mb-2 text-xs font-medium text-muted-foreground">
                      Context sent: {ai.scopeLabel}
                    </div>
                  )}
                  {ai.error ? (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      {ai.error}
                    </div>
                  ) : (
                    <div
                      ref={outputRef}
                      className="docs-prose max-h-[40vh] overflow-y-auto rounded-md border border-border bg-card p-3 text-sm"
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{ai.text || "…"}</ReactMarkdown>
                    </div>
                  )}

                  {(ai.status === "stopped" || ai.notice) && (
                    <p role="status" className="mt-2 text-xs text-muted-foreground">
                      {ai.status === "stopped"
                        ? ai.text
                          ? "Stopped. The answer above is incomplete."
                          : "Stopped before any answer arrived."
                        : ai.notice}
                    </p>
                  )}

                  {ai.text && !ai.isStreaming && !ai.error && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <FooterButton
                        icon={copied ? Check : Copy}
                        label={copied ? "Copied" : "Copy"}
                        onClick={() => {
                          navigator.clipboard.writeText(ai.text);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        }}
                      />
                      {activeFile && (
                        <FooterButton
                          icon={CornerDownLeft}
                          label="Insert into doc"
                          onClick={() => onInsert(ai.text)}
                        />
                      )}
                      <FooterButton
                        icon={FilePlus2}
                        label="New document"
                        onClick={() =>
                          onCreateDoc(defaultDocName(activeActionId, activeFile?.name), ai.text)
                        }
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Freeform input */}
            <div className="shrink-0 border-t border-border p-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (input.trim() && canRun && !ai.isStreaming) run(null);
                    }
                  }}
                  rows={2}
                  placeholder="Ask anything about the content…"
                  className="max-h-32 min-h-10 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                />
                {ai.isStreaming ? (
                  <button
                    onClick={ai.abort}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-destructive text-destructive-foreground"
                    aria-label="Stop"
                  >
                    <Square className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => run(null)}
                    disabled={!input.trim() || !canRun}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                    aria-label="Send"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function ContextTab({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: typeof FileText;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-1 rounded-md border p-2 text-xs font-medium transition-colors disabled:opacity-30 ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function FooterButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Copy;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function NoKeyState({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <KeyRound className="h-6 w-6" />
      </div>
      <div>
        <h3 className="font-semibold">Connect an AI provider</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Add your own OpenAI or Gemini API key to start using Ask AI. Your key stays in your
          browser.
        </p>
      </div>
      <Link
        to="/settings"
        onClick={onClose}
        className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
      >
        Open Ask AI settings
      </Link>
    </div>
  );
}

function defaultDocName(actionId: string | null, sourceName?: string): string {
  const base = sourceName ? stripExt(sourceName) : "Untitled";
  const action = actionId ? getAction(actionId) : undefined;
  const suffix = action ? ` — ${action.label}` : " — AI";
  return `${base}${suffix}.md`;
}
