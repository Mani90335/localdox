// Any-document-to-Markdown conversion (PDF/DOCX/PPTX/XLSX/ODT/RTF/EPUB/CSV
// via the AnyDoc WASM engine, off the main thread). Converting a document
// creates a linked Markdown copy; the original file is left untouched.

export {
  CONVERTER_VERSION,
  MAX_CONVERSION_INPUT,
  MAX_CONVERSION_OUTPUT,
  CONVERSION_TIMEOUT_MS,
  canConvertToMarkdown,
  sameSource,
  markdownCopyName,
  latestMarkdownCopies,
  parseDerivation,
  remapDerivation,
  describeConversionError,
  type Derivation,
  type ConversionSource,
  type ConversionResult,
  type ConversionFailure,
} from "./types";
export { remarkConvertedHtml, convertedAnchorMap, convertedFootnotes } from "./markdown-compat";
export { useDocumentConversion } from "./use-document-conversion";
export { ConversionActions } from "./ConversionActions";
export { ConvertedRemoteImage } from "./ConvertedRemoteImage";
