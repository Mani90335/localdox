import JSZip from "jszip";
import * as XLSX from "xlsx";

export const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export type CellEdits = Map<string, Map<string, string>>;
export type DocumentUpdate = { content: string; data?: string; size: number };
export function xml(source: string): XMLDocument {
  const document = new DOMParser().parseFromString(source, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("The document contains invalid XML.");
  return document;
}
const serialize = (document: XMLDocument) => new XMLSerializer().serializeToString(document);

export async function binaryUpdate(bytes: Uint8Array, mime: string): Promise<DocumentUpdate> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not prepare the edited file."));
    reader.readAsDataURL(blob);
  });
  return { content: "", data, size: bytes.byteLength };
}

/** Inspect the first CSV record without counting delimiters inside quotes. */
export function csvDelimiter(content: string): string {
  const counts = new Map([
    [",", 0],
    [";", 0],
    ["\t", 0],
  ]);
  let quoted = false;
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (char === '"') {
      if (quoted && content[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (char === "\n" || char === "\r") break;
      if (counts.has(char)) counts.set(char, counts.get(char)! + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

export function setCell(sheet: XLSX.WorkSheet, address: string, value: string, csv: boolean) {
  const previous = sheet[address] as XLSX.CellObject | undefined;
  const cell: XLSX.CellObject = { ...previous, t: "s", v: value };
  delete cell.w;
  delete cell.f;
  delete cell.F;
  if (!csv && value.startsWith("=") && value.length > 1) {
    cell.f = value.slice(1);
    cell.t = "n";
    delete cell.v;
  } else if (
    !csv &&
    /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value) &&
    !/^[-+]?0\d/.test(value) &&
    Number.isFinite(Number(value))
  ) {
    cell.t = "n";
    cell.v = Number(value);
  } else if (!csv && /^(TRUE|FALSE)$/.test(value)) {
    cell.t = "b";
    cell.v = value === "TRUE";
  }
  sheet[address] = cell;
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const point = XLSX.utils.decode_cell(address);
  range.s.r = Math.min(range.s.r, point.r);
  range.s.c = Math.min(range.s.c, point.c);
  range.e.r = Math.max(range.e.r, point.r);
  range.e.c = Math.max(range.e.c, point.c);
  sheet["!ref"] = XLSX.utils.encode_range(range);
}

/** Patch only edited cells in OOXML. A SheetJS re-export would drop drawings,
 * charts and other package parts that its community writer does not retain. */
export async function saveXlsx(buffer: ArrayBuffer, edits: CellEdits): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(buffer);
  const book = xml(await zip.file("xl/workbook.xml")!.async("string"));
  const rels = xml(await zip.file("xl/_rels/workbook.xml.rels")!.async("string"));
  for (const sheet of Array.from(book.getElementsByTagNameNS(SHEET_NS, "sheet"))) {
    const changes = edits.get(sheet.getAttribute("name") || "");
    if (!changes?.size) continue;
    const id = sheet.getAttributeNS(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "id",
    );
    const relationship = Array.from(rels.documentElement.children).find(
      (node) => node.getAttribute("Id") === id,
    );
    const target = relationship?.getAttribute("Target");
    if (!target) throw new Error("The worksheet location could not be found.");
    const path = new URL(target, "https://office.local/xl/workbook.xml").pathname.slice(1);
    const entry = zip.file(path);
    if (!entry) throw new Error("The worksheet data could not be found.");
    const document = xml(await entry.async("string"));
    const data = document.getElementsByTagNameNS(SHEET_NS, "sheetData")[0];
    if (!data) throw new Error("The worksheet has no cell data.");
    const rows = new Map(Array.from(data.children, (row) => [Number(row.getAttribute("r")), row]));
    const cells = new Map(
      Array.from(data.getElementsByTagNameNS(SHEET_NS, "c"), (cell) => [
        cell.getAttribute("r"),
        cell,
      ]),
    );
    const arrayRanges = Array.from(data.getElementsByTagNameNS(SHEET_NS, "f"))
      .filter((formula) => formula.getAttribute("t") === "array" && formula.hasAttribute("ref"))
      .map((formula) => XLSX.utils.decode_range(formula.getAttribute("ref")!));
    for (const [address, value] of changes) {
      const position = XLSX.utils.decode_cell(address);
      if (
        arrayRanges.some(
          (range) =>
            position.r >= range.s.r &&
            position.r <= range.e.r &&
            position.c >= range.s.c &&
            position.c <= range.e.c,
        )
      ) {
        throw new Error(`Cell ${address} belongs to an array formula. Edit that formula in Excel.`);
      }
      let row = rows.get(position.r + 1);
      if (!row) {
        row = document.createElementNS(SHEET_NS, "row");
        row.setAttribute("r", String(position.r + 1));
        data.insertBefore(
          row,
          Array.from(data.children).find(
            (candidate) => Number(candidate.getAttribute("r")) > position.r + 1,
          ) ?? null,
        );
        rows.set(position.r + 1, row);
      }
      let cell = cells.get(address);
      if (!cell) {
        cell = document.createElementNS(SHEET_NS, "c");
        cell.setAttribute("r", address);
        row.insertBefore(
          cell,
          Array.from(row.children).find(
            (candidate) =>
              XLSX.utils.decode_cell(candidate.getAttribute("r") || "A1").c > position.c,
          ) ?? null,
        );
      }
      const formula = cell.getElementsByTagNameNS(SHEET_NS, "f")[0];
      if (formula?.getAttribute("t") === "shared" || formula?.getAttribute("t") === "array") {
        throw new Error(
          `Cell ${address} belongs to a shared or array formula. Edit that formula in Excel.`,
        );
      }
      for (const child of Array.from(cell.children)) {
        if (["f", "v", "is"].includes(child.localName)) child.remove();
      }
      const scratch: XLSX.WorkSheet = {};
      setCell(scratch, address, value, false);
      const next = scratch[address] as XLSX.CellObject;
      cell.removeAttribute("t");
      if (next.f) {
        const f = document.createElementNS(SHEET_NS, "f");
        f.textContent = next.f;
        cell.insertBefore(f, cell.getElementsByTagNameNS(SHEET_NS, "extLst")[0] ?? null);
      } else if (next.t === "s") {
        cell.setAttribute("t", "inlineStr");
        const inline = document.createElementNS(SHEET_NS, "is");
        const text = document.createElementNS(SHEET_NS, "t");
        text.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
        text.textContent = value;
        inline.append(text);
        cell.insertBefore(inline, cell.getElementsByTagNameNS(SHEET_NS, "extLst")[0] ?? null);
      } else {
        cell.setAttribute("t", next.t);
        const v = document.createElementNS(SHEET_NS, "v");
        v.textContent = next.t === "b" ? (next.v ? "1" : "0") : String(next.v);
        cell.insertBefore(v, cell.getElementsByTagNameNS(SHEET_NS, "extLst")[0] ?? null);
      }
      const dimension = document.getElementsByTagNameNS(SHEET_NS, "dimension")[0];
      if (dimension) {
        const range = XLSX.utils.decode_range(dimension.getAttribute("ref") || "A1");
        range.s.r = Math.min(range.s.r, position.r);
        range.s.c = Math.min(range.s.c, position.c);
        range.e.r = Math.max(range.e.r, position.r);
        range.e.c = Math.max(range.e.c, position.c);
        dimension.setAttribute("ref", XLSX.utils.encode_range(range));
      }
    }
    zip.file(path, serialize(document));
  }
  const contentTypes = xml(await zip.file("[Content_Types].xml")!.async("string"));
  for (const relation of Array.from(rels.documentElement.children)) {
    if (!relation.getAttribute("Type")?.endsWith("/calcChain")) continue;
    const path = new URL(
      relation.getAttribute("Target")!,
      "https://office.local/xl/workbook.xml",
    ).pathname.slice(1);
    zip.remove(path);
    relation.remove();
    for (const entry of Array.from(contentTypes.documentElement.children)) {
      if (entry.getAttribute("PartName") === `/${path}`) entry.remove();
    }
  }
  zip.file("xl/_rels/workbook.xml.rels", serialize(rels));
  zip.file("[Content_Types].xml", serialize(contentTypes));
  let calculation = book.getElementsByTagNameNS(SHEET_NS, "calcPr")[0];
  if (!calculation) {
    calculation = book.createElementNS(SHEET_NS, "calcPr");
    book.documentElement.insertBefore(
      calculation,
      book.getElementsByTagNameNS(SHEET_NS, "extLst")[0] ?? null,
    );
  }
  calculation.setAttribute("fullCalcOnLoad", "1");
  calculation.setAttribute("forceFullCalc", "1");
  calculation.setAttribute("calcMode", "auto");
  zip.file("xl/workbook.xml", serialize(book));
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 3 },
  });
}

export function paragraphTokens(paragraph: Element) {
  return Array.from(paragraph.getElementsByTagNameNS(WORD_NS, "*")).filter(
    (node) => ["t", "tab", "br", "cr"].includes(node.localName) && node.closest("p") === paragraph,
  );
}
const tokenText = (node: Element) =>
  node.localName === "t" ? node.textContent || "" : node.localName === "tab" ? "\t" : "\n";
export const paragraphText = (paragraph: Element) =>
  paragraphTokens(paragraph).map(tokenText).join("");

/** Keep untouched runs (and their formatting, links, images and bookmarks).
 * Insertions inherit the run at the edit; common prefixes/suffixes retain style. */
export function editParagraph(paragraph: Element, value: string) {
  const original = paragraphText(paragraph);
  if (original === value) return;
  let start = 0;
  while (start < original.length && start < value.length && original[start] === value[start])
    start++;
  let suffix = 0;
  while (
    suffix < original.length - start &&
    suffix < value.length - start &&
    original[original.length - 1 - suffix] === value[value.length - 1 - suffix]
  )
    suffix++;
  const end = original.length - suffix;
  const insertion = value.slice(start, value.length - suffix);
  const document = paragraph.ownerDocument;
  let tokens = paragraphTokens(paragraph);
  if (!tokens.length) {
    const run = document.createElementNS(WORD_NS, "w:r");
    const text = document.createElementNS(WORD_NS, "w:t");
    run.append(text);
    paragraph.append(run);
    tokens = [text];
  }
  let offset = 0;
  let inserted = false;
  for (const token of tokens) {
    const text = tokenText(token);
    const before = offset;
    offset += text.length;
    let replacement = text.slice(0, Math.max(0, start - before));
    if (!inserted && start <= offset) {
      replacement += insertion;
      inserted = true;
    }
    replacement += text.slice(Math.max(0, end - before));
    if (replacement === text) continue;
    const nodes = replacement
      .split(/([\t\n])/)
      .filter(Boolean)
      .map((part) => {
        const node = document.createElementNS(
          WORD_NS,
          part === "\t" ? "w:tab" : part === "\n" ? "w:br" : "w:t",
        );
        if (node.localName === "t") {
          node.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
          node.textContent = part;
        }
        return node;
      });
    token.replaceWith(...nodes);
  }
}

export { JSZip, XLSX, serialize };
