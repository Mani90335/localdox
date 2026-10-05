export const workspaceKinds = ["exam", "documentation", "reader"] as const;
export type WorkspaceKind = (typeof workspaceKinds)[number];

export const workspaceFeatures = {
  exam: { label: "Exam Workspace", exams: true, materials: true, available: true },
  documentation: {
    label: "Documentation Workspace",
    exams: false,
    materials: true,
    available: false,
  },
  reader: { label: "Reader Workspace", exams: false, materials: true, available: true },
} as const;

/** Workspaces created before kinds were introduced are readers. */
export const workspaceKind = (record: { kind?: WorkspaceKind }): WorkspaceKind =>
  record.kind ?? "reader";
export const LEGACY_EXAM_WORKSPACE = "localdox-legacy-exams";
