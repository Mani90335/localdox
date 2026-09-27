// In-place editing of Office/CSV files. Unlike doc-conversion, this edits the
// original binary file directly (surgically patching the OOXML package or CSV
// text) rather than producing a Markdown copy, so images/charts/other parts
// of the file survive untouched.

export { OfficeEditor, type OfficeEditorProps } from "./OfficeEditor";
export {
  binaryUpdate,
  csvDelimiter,
  editParagraph,
  paragraphText,
  saveXlsx,
  setCell,
  type CellEdits,
  type DocumentUpdate,
} from "./office";
