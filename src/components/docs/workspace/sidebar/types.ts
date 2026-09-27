/** A sidebar folder, as far as the sidebar is concerned. */
export interface SidebarFolder {
  id: string;
  name: string;
  /** Folder this one sits inside; null/undefined = top level. */
  parentId?: string | null;
  /** Managed attachment folder, independent of its display name. */
  purpose?: "embed-media";
}
