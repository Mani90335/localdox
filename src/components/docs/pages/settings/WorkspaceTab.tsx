import { workspaceFeatures, type WorkspaceKind } from "@/lib/workspace/kinds";
import { useRef, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Section, Group, Row, Empty, IconButton } from "./primitives";
import { Switch } from "@/components/ui/switch";

export function WorkspaceSettings({
  showEmbedMedia,
  onSetShowEmbedMedia,
  workspaces,
  currentWorkspaceId,
  onRename,
  onDelete,
  onNew,
  onOpenWorkspace,
  onImport,
  onExport,
  onShare,
}: {
  showEmbedMedia: boolean;
  onSetShowEmbedMedia: (show: boolean) => void;
  workspaces: { id: string; name: string; kind?: WorkspaceKind }[];
  currentWorkspaceId: string | null;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onNew: (name: string, kind?: WorkspaceKind) => void;
  onOpenWorkspace: (id: string) => void;
  onImport: (file: File) => void;
  onExport: () => void;
  onShare: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [kind, setKind] = useState<WorkspaceKind>("exam");

  const commitCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onNew(name, kind);
    setCreating(false);
    setNewName("");
  };

  return (
    <div className="space-y-7">
      <Section title="Sidebar">
        <Group>
          <Row
            label="Show embed-media folder"
            hint="Across all workspaces. Hidden attachments still appear in documents and exports."
            control={
              <Switch
                aria-label="Show embed-media folder"
                checked={showEmbedMedia}
                onCheckedChange={onSetShowEmbedMedia}
              />
            }
          />
        </Group>
      </Section>
      <Section
        title="Workspaces"
        action={
          !creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="coarse:min-h-11 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          )
        }
      >
        <Group>
          {workspaces.length === 0 && !creating && (
            <Empty>Create a workspace to organize your documents.</Empty>
          )}
          {creating && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <select
                aria-label="Workspace kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as WorkspaceKind)}
                className="rounded-md border border-border bg-background p-2 text-sm"
              >
                {Object.entries(workspaceFeatures).map(([value, feature]) => (
                  <option key={value} value={value} disabled={!feature.available}>
                    {feature.label}
                    {!feature.available ? " (coming later)" : ""}
                  </option>
                ))}
              </select>
              <input
                autoFocus
                type="text"
                placeholder="Workspace name..."
                aria-label="New workspace name"
                data-settings-draft
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitCreate();
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setCreating(false);
                    setNewName("");
                  }
                }}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 coarse:min-h-11"
              />
              <button
                onClick={commitCreate}
                disabled={!newName.trim()}
                className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Save
              </button>
              <IconButton
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
                label="Cancel new workspace"
              >
                <X className="h-4 w-4" />
              </IconButton>
            </div>
          )}
          {workspaces.map((ws) => (
            <WorkspaceItemRow
              key={ws.id}
              workspace={ws}
              isCurrent={ws.id === currentWorkspaceId}
              onRename={onRename}
              onDelete={onDelete}
              onOpen={onOpenWorkspace}
              canDelete={workspaces.length > 1}
            />
          ))}
        </Group>
      </Section>

      {/* Moved out of the workspace menus: occasional actions on the whole
          workspace, grouped where the workspaces themselves are managed. */}
      <Section title="Transfer">
        <Group>
          <Row
            label="Import workspace"
            hint="Add a workspace from an exported .json file"
            control={
              <button
                onClick={() => fileRef.current?.click()}
                className="coarse:min-h-11 rounded-md px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
              >
                Choose file
              </button>
            }
          />
          <Row
            label="Export workspace"
            hint={
              workspaces.find((w) => w.id === currentWorkspaceId)?.kind === "exam"
                ? "Download learning materials and reader annotations as .json. Exam papers and attempts are stored separately."
                : "Download the current workspace as .json"
            }
            control={
              <button
                onClick={onExport}
                className="coarse:min-h-11 rounded-md px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
              >
                Export
              </button>
            }
          />
          <Row
            label="Share workspace"
            hint="Create a link to the current workspace"
            control={
              <button
                onClick={onShare}
                className="coarse:min-h-11 rounded-md px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
              >
                Share
              </button>
            }
          />
        </Group>
      </Section>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function WorkspaceItemRow({
  workspace,
  isCurrent,
  onRename,
  onDelete,
  onOpen,
  canDelete,
}: {
  workspace: { id: string; name: string; kind?: WorkspaceKind };
  isCurrent: boolean;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
  canDelete: boolean;
}) {
  // Rename is progressive disclosure: the input only exists once you ask for
  // it, so the default state is a clean list of names.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(workspace.name);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== workspace.name) onRename(workspace.id, next);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(workspace.name);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 coarse:min-h-11"
          placeholder="Workspace name"
          aria-label="Workspace name"
          data-settings-draft
        />
        <button
          onClick={commit}
          disabled={!draft.trim()}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Save
        </button>
        <IconButton onClick={cancel} label="Cancel rename">
          <X className="h-4 w-4" />
        </IconButton>
      </div>
    );
  }

  return (
    <Row
      label={
        <span className="flex items-center gap-2">
          {workspace.name}
          {isCurrent && <span className="text-xs text-muted-foreground">Current</span>}
        </span>
      }
      hint={workspaceFeatures[workspace.kind ?? "reader"].label}
      control={
        <>
          {
            <button
              onClick={() => onOpen(workspace.id)}
              className="coarse:min-h-11 coarse:px-3 rounded-md px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              Open
            </button>
          }
          <IconButton onClick={() => setEditing(true)} label={`Rename ${workspace.name}`}>
            <Pencil className="h-4 w-4" />
          </IconButton>
          <IconButton
            onClick={() => {
              if (window.confirm(`Delete workspace "${workspace.name}"?`)) onDelete(workspace.id);
            }}
            label={`Delete ${workspace.name}`}
            danger
            disabled={isCurrent || !canDelete}
            title={
              isCurrent
                ? "Cannot delete the active workspace"
                : !canDelete
                  ? "Cannot delete your only workspace"
                  : "Delete workspace"
            }
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </>
      }
    />
  );
}
