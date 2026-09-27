import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Clock, FileText, FolderOpen, Upload } from "lucide-react";
import { Modal } from "@/components/ui/modal";

export interface WorkspaceFileItem {
  id: string;
  name: string;
  minutes: number;
}

export interface WorkspaceItem {
  id: string;
  name: string;
  current: boolean;
}

interface Props {
  userName: string | null;
  onSubmitName: (name: string) => void;
  files: WorkspaceFileItem[];
  workspaces: WorkspaceItem[];
  onOpenFile: (fileId: string, subtopicId?: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onUpload: () => void;
  onFilesDrop?: (files: FileList) => void;
}

const stripExt = (name: string) => name.replace(/\.(md|markdown|mdx|mmd|mermaid|txt)$/i, "");

export function HomePage({
  userName,
  onSubmitName,
  files,
  workspaces,
  onOpenFile,
  onOpenWorkspace,
  onUpload,
  onFilesDrop,
}: Props) {
  const [draft, setDraft] = useState("");
  const [showModal, setShowModal] = useState(!userName);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    if (!userName) setShowModal(true);
  }, [userName]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = draft.trim();
    if (!value) return;
    onSubmitName(value);
    setShowModal(false);
  };

  const displayName = userName ?? "there";

  return (
    <>
      <main className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-4xl flex-col px-6 pb-8 pt-14 md:px-10 md:pt-20">
        <header className="max-w-2xl">
          <h1 className="mt-3 text-2xl font-bold tracking-[-0.04em] text-foreground md:text-4xl">
            Welcome, {displayName}.
          </h1>
        </header>

        <div className="mt-10 w-full sm:w-96">
          <div
            className="w-full"
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              if (e.dataTransfer.files.length > 0) onFilesDrop?.(e.dataTransfer.files);
            }}
          >
            <button
              onClick={onUpload}
              className={`group relative flex w-full h-full items-center justify-between overflow-hidden rounded-2xl border p-5 text-left shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                drag
                  ? "border-primary bg-primary text-primary-foreground ring-4 ring-primary/15"
                  : "border-foreground/10 bg-foreground text-background"
              }`}
            >
              <span className="pointer-events-none absolute -right-7 -top-10 h-32 w-32 rounded-full border border-background/15" />
              <span className="pointer-events-none absolute right-12 top-10 h-16 w-16 rounded-full border border-background/10" />
              <span className="relative flex min-w-0 flex-1 items-center gap-4">
                <span className="min-w-0">
                  <span className="block text-base font-semibold">Add files to this workspace</span>
                  <span className="mt-1 block text-sm text-background/65">
                    Drop documents, spreadsheets, PDFs, or presentations here.
                  </span>
                </span>
              </span>
              <span className="relative ml-4 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background text-foreground transition-transform duration-200 group-hover:-translate-y-0.5">
                <Upload className="h-4 w-4" />
              </span>
            </button>
          </div>
        </div>

        <section className="mt-12">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                {workspaces.find((w) => w.current)?.name || "Workspace"}
              </h2>
              <p className="mt-1 text-sm font-medium text-muted-foreground">
                {files.length} {files.length === 1 ? "document" : "documents"}
              </p>
            </div>
            <button
              onClick={() => {
                const cw = workspaces.find((w) => w.current);
                if (cw) onOpenWorkspace(cw.id);
              }}
              className="group mb-1 flex shrink-0 items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-primary/80"
            >
              View All
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>

          {files.length > 0 && (
            <div className="flex flex-col gap-3">
              {files.map((item) => (
                <button
                  key={`file-${item.id}`}
                  onClick={() => onOpenFile(item.id)}
                  className="group flex items-center justify-between rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform duration-200 group-hover:scale-105">
                      <FileText className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-foreground transition-colors group-hover:text-primary">
                        {stripExt(item.name)}
                      </h3>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {item.minutes} min read
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="ml-4 h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                </button>
              ))}
            </div>
          )}
        </section>
      </main>

      <Modal
        open={showModal}
        onOpenChange={() => {
          /* Name is required — keep the modal open until the form is submitted. */
        }}
        size="sm"
        showClose={false}
        bodyClassName="p-6"
      >
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Welcome
        </div>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-foreground">
          What do we call you?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          We&apos;ll remember it on this device to personalize your reading.
        </p>
        <form className="mt-5 flex gap-2" onSubmit={submit}>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Your name"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Continue
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </Modal>
    </>
  );
}
