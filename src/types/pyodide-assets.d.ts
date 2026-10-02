declare module "virtual:pyodide-assets" {
  /** Public directory of the advanced math engine, e.g. "/pyodide/314.0.7/". */
  export const PYODIDE_BASE: string;
  export const PYODIDE_VERSION: string;
  /** Compressed size of everything it downloads, in bytes. */
  export const PYODIDE_DOWNLOAD_BYTES: number;
}
