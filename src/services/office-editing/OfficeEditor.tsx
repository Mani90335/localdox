import { flushSync } from "react-dom";
import { useEffect, useRef, useState } from "react";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { dataUrlToArrayBuffer, getDocumentKind } from "@/lib/markdown/document-utils";
import {
  binaryUpdate,
  csvDelimiter,
  editParagraph,
  JSZip,
  paragraphText,
  saveXlsx,
  serialize,
  setCell,
  WORD_NS,
  XLSX,
  xml,
  type CellEdits,
  type DocumentUpdate,
} from "./office";

export type OfficeEditorProps = {
  file: MdFile;
  onSave: (fileId: string, update: DocumentUpdate) => void;
  onDone: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};
const buttonClass =
  "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50";

export function OfficeEditor(props: OfficeEditorProps) {
  const { file, onSave, onDone, onDirtyChange } = props;
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [ready, setReady] = useState(false);
  const saveRef = useRef<(() => Promise<DocumentUpdate>) | null>(null);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  useEffect(() => {
    dirtyCallback.current?.(dirty);
  }, [dirty]);
  useEffect(() => () => dirtyCallback.current?.(false), []);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  const save = async () => {
    if (saving || !saveRef.current) return;
    setSaving(true);
    setError("");
    try {
      if (dirty) onSave(file.id, await saveRef.current());
      dirtyCallback.current?.(false);
      onDone();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The file could not be saved. Your edits are still here.",
      );
      setSaving(false);
    }
  };
  return (
    <section
      className="mx-auto max-w-7xl p-4 md:p-7"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "s") {
          event.preventDefault();
          void save();
        }
      }}
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <h1 className="truncate font-semibold">Edit {file.name}</h1>
          <p className="text-xs text-muted-foreground">
            {dirty ? "Unsaved changes" : "Changes save when you choose Save"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
            disabled={saving}
            onClick={onDone}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={!ready || saving}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <fieldset disabled={saving} className="min-w-0">
        {(file.kind ?? getDocumentKind(file.name, file.mimeType)) === "docx" ? (
          <WordEditor
            file={file}
            register={(save) => {
              saveRef.current = save;
              setReady(true);
            }}
            changed={() => setDirty(true)}
            onError={setError}
          />
        ) : (
          <SheetEditor
            file={file}
            register={(save) => {
              saveRef.current = save;
              setReady(true);
            }}
            changed={() => setDirty(true)}
            onError={setError}
          />
        )}
      </fieldset>
    </section>
  );
}

type EditorProps = {
  file: MdFile;
  register: (save: () => Promise<DocumentUpdate>) => void;
  changed: () => void;
  onError: (error: string) => void;
};
function SheetEditor({ file, register, changed, onError }: EditorProps) {
  const [book, setBook] = useState<XLSX.WorkBook | null>(null);
  const [active, setActive] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const extents = useRef(new Map<string, { rows: number; columns: number }>());
  const [revision, setRevision] = useState(0);
  const edits = useRef<CellEdits>(new Map());
  const viewport = useRef<HTMLDivElement>(null);
  const csv = file.kind === "csv" || /\.csv$/i.test(file.name);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const buffer = await dataUrlToArrayBuffer(file.data);
        const workbook = XLSX.read(csv ? file.content : buffer, {
          type: csv ? "string" : "array",
          raw: csv,
          ...(csv ? { FS: csvDelimiter(file.content) } : {}),
          cellStyles: true,
        });
        if (!alive) return;
        setBook(workbook);
        register(async () => {
          if (
            !csv &&
            buffer &&
            new Uint8Array(buffer)[0] === 0x50 &&
            new Uint8Array(buffer)[1] === 0x4b
          ) {
            if (!buffer) throw new Error("The workbook data is missing.");
            return binaryUpdate(
              await saveXlsx(buffer, edits.current),
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            );
          }
          for (const [name, cells] of edits.current) {
            for (const [address, value] of cells)
              setCell(workbook.Sheets[name], address, value, csv);
          }
          if (csv) {
            // Retain the source delimiter, BOM and newline convention.
            const FS = csvDelimiter(file.content);
            const content =
              (file.content.startsWith("\uFEFF") ||
              (buffer && new Uint8Array(buffer).subarray(0, 3).join(",") === "239,187,191")
                ? "\uFEFF"
                : "") +
              XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]], {
                FS,
                RS: file.content.includes("\r\n") ? "\r\n" : "\n",
                blankrows: true,
              });
            return { content, data: undefined, size: new TextEncoder().encode(content).byteLength };
          }
          return binaryUpdate(
            new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xls" })),
            "application/vnd.ms-excel",
          );
        });
      } catch (cause) {
        if (alive)
          onError(cause instanceof Error ? cause.message : "Could not open the spreadsheet.");
      }
    })();
    return () => {
      alive = false;
    };
    // A session parses exactly once. Draft cells live in a sparse overlay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);
  if (!book) return <p>Loading editor…</p>;
  const name = book.SheetNames[active];
  const sheet = book.Sheets[name];
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const rowCount = Math.max(range.e.r + 1, extents.current.get(name)?.rows ?? 0);
  const columnCount = Math.max(range.e.c + 1, extents.current.get(name)?.columns ?? 0);
  const firstColumn = Math.max(0, Math.floor(scrollLeft / 160) - 2);
  const lastColumn = Math.min(
    columnCount,
    firstColumn + Math.ceil((viewport.current?.clientWidth || 1200) / 160) + 5,
  );
  const columns = Array.from(
    { length: lastColumn - firstColumn },
    (_, index) => firstColumn + index,
  );
  const renderedColumns =
    columns.length + 1 + (firstColumn > 0 ? 1 : 0) + (lastColumn < columnCount ? 1 : 0);
  const valueAt = (row: number, column: number) => {
    const address = XLSX.utils.encode_cell({ r: row, c: column });
    const draft = edits.current.get(name)?.get(address);
    if (draft !== undefined) return draft;
    const cell = sheet[address] as XLSX.CellObject | undefined;
    return cell?.f ? `=${cell.f}` : cell?.v == null ? "" : String(cell.v);
  };
  const change = (row: number, column: number, value: string, notify = true) => {
    if (!edits.current.has(name)) edits.current.set(name, new Map());
    edits.current.get(name)!.set(XLSX.utils.encode_cell({ r: row, c: column }), value);
    const extent = extents.current.get(name) ?? { rows: rowCount, columns: columnCount };
    extent.rows = Math.max(extent.rows, row + 1);
    extent.columns = Math.max(extent.columns, column + 1);
    extents.current.set(name, extent);
    if (notify) {
      changed();
      setRevision((value) => value + 1);
    }
  };
  const focusCell = (row: number, column: number) => {
    const node = viewport.current;
    if (!node || row < 0 || column < 0 || row >= rowCount || column >= columnCount) return false;
    const top = row * 36;
    const left = 48 + column * 160;
    if (top < node.scrollTop || top + 72 > node.scrollTop + node.clientHeight)
      node.scrollTop = Math.max(0, top - 36);
    if (left < node.scrollLeft || left + 160 > node.scrollLeft + node.clientWidth)
      node.scrollLeft = Math.max(0, left - 48);
    // Commit a newly visible window before transferring focus. Deferring focus
    // to animation frames can lose rapid Tab presses on the previous cell.
    flushSync(() => {
      setScrollTop(node.scrollTop);
      setScrollLeft(node.scrollLeft);
    });
    const input = node.querySelector<HTMLInputElement>(
      `input[aria-label="Cell ${XLSX.utils.encode_cell({ r: row, c: column })}"]`,
    );
    input?.focus();
    input?.select();
    return true;
  };
  const first = Math.max(0, Math.floor(scrollTop / 36) - 6);
  const last = Math.min(
    rowCount,
    first + Math.ceil((viewport.current?.clientHeight || 540) / 36) + 14,
  );
  return (
    <>
      <p className="mb-3 text-xs text-muted-foreground">
        Edit cells directly. Paste tab-separated cells from a spreadsheet. Tab moves between cells.
        {!csv &&
          " Formulas recalculate when opened in Excel; this editor does not calculate results."}
      </p>
      <div className="flex flex-wrap items-center gap-1 rounded-t-lg border border-b-0 border-border bg-muted/20 px-2 py-1">
        {!csv &&
          book.SheetNames.length > 1 &&
          book.SheetNames.map((sheetName, index) => (
            <button
              type="button"
              className={`border-b-2 px-3 py-2 text-sm font-medium ${active === index ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:bg-accent"}`}
              aria-pressed={active === index}
              key={sheetName}
              onClick={() => {
                setActive(index);
                setScrollTop(0);
                setScrollLeft(0);
                viewport.current?.scrollTo(0, 0);
              }}
            >
              {sheetName}
            </button>
          ))}
        <div className="flex-1" />
        <button
          type="button"
          className="rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-accent"
          onClick={() => change(rowCount, 0, "")}
        >
          Add row
        </button>
        <button
          type="button"
          className="rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-accent"
          onClick={() => change(0, columnCount, "")}
        >
          Add column
        </button>
      </div>
      <div
        ref={viewport}
        className="h-[60dvh] overflow-auto rounded-b-lg border border-border"
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
          setScrollLeft(event.currentTarget.scrollLeft);
        }}
        data-revision={revision}
      >
        <table
          className="border-collapse text-sm"
          style={{ tableLayout: "fixed", width: 48 + columnCount * 160 }}
        >
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th style={{ width: 48 }}>#</th>
              {firstColumn > 0 && <th style={{ width: firstColumn * 160 }} aria-hidden />}
              {columns.map((column) => (
                <th key={column} style={{ width: 160 }}>
                  {XLSX.utils.encode_col(column)}
                </th>
              ))}
              {lastColumn < columnCount && (
                <th style={{ width: (columnCount - lastColumn) * 160 }} aria-hidden />
              )}
            </tr>
          </thead>
          <tbody>
            {first > 0 && (
              <tr style={{ height: first * 36 }} aria-hidden>
                <td colSpan={renderedColumns} />
              </tr>
            )}
            {Array.from({ length: last - first }, (_, offset) => {
              const row = first + offset;
              return (
                <tr key={`${name}-${row}`} style={{ height: 36 }}>
                  <th className="bg-muted text-xs font-normal">{row + 1}</th>
                  {firstColumn > 0 && <td aria-hidden />}
                  {columns.map((column) => (
                    <td key={column} className="border border-border p-0">
                      <input
                        aria-label={`Cell ${XLSX.utils.encode_cell({ r: row, c: column })}`}
                        className="h-8.75 w-full min-w-0 bg-transparent px-2 outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
                        value={valueAt(row, column)}
                        onChange={(event) => change(row, column, event.target.value)}
                        onKeyDown={(event) => {
                          let nextRow = row;
                          let nextColumn = column;
                          if (event.key === "Tab") {
                            nextColumn += event.shiftKey ? -1 : 1;
                            if (nextColumn >= columnCount) {
                              nextColumn = 0;
                              nextRow++;
                            }
                            if (nextColumn < 0) {
                              nextColumn = columnCount - 1;
                              nextRow--;
                            }
                          } else if (event.key === "Enter" || event.key === "ArrowDown")
                            nextRow += event.shiftKey ? -1 : 1;
                          else if (event.key === "ArrowUp") nextRow--;
                          else return;
                          if (focusCell(nextRow, nextColumn)) event.preventDefault();
                        }}
                        onPaste={(event) => {
                          const text = event.clipboardData.getData("text/plain");
                          if (!text.includes("\t") && !text.includes("\n")) return;
                          event.preventDefault();
                          const pasted = XLSX.read(text, { type: "string", raw: true, FS: "\t" });
                          const matrix = XLSX.utils.sheet_to_json<string[]>(
                            pasted.Sheets[pasted.SheetNames[0]],
                            { header: 1, defval: "", blankrows: true },
                          );
                          matrix.forEach((cells, r) =>
                            cells.forEach((value, c) =>
                              change(row + r, column + c, String(value), false),
                            ),
                          );
                          changed();
                          setRevision((value) => value + 1);
                        }}
                      />
                    </td>
                  ))}
                  {lastColumn < columnCount && <td aria-hidden />}
                </tr>
              );
            })}
            {last < rowCount && (
              <tr style={{ height: (rowCount - last) * 36 }} aria-hidden>
                <td colSpan={renderedColumns} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function WordEditor({ file, register, changed, onError }: EditorProps) {
  const [paragraphs, setParagraphs] = useState<string[] | null>(null);
  const drafts = useRef(new Map<number, string>());
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const buffer = await dataUrlToArrayBuffer(file.data);
        if (!buffer) throw new Error("The Word document data is missing.");
        const zip = await JSZip.loadAsync(buffer);
        const entry = zip.file("word/document.xml");
        if (!entry) throw new Error("The Word document body is missing.");
        const document = xml(await entry.async("string"));
        const nodes = Array.from(document.getElementsByTagNameNS(WORD_NS, "p"));
        if (!alive) return;
        setParagraphs(nodes.map(paragraphText));
        register(async () => {
          for (const [index, value] of drafts.current) editParagraph(nodes[index], value);
          zip.file("word/document.xml", serialize(document));
          return binaryUpdate(
            await zip.generateAsync({
              type: "uint8array",
              compression: "DEFLATE",
              compressionOptions: { level: 3 },
            }),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          );
        });
      } catch (cause) {
        if (alive)
          onError(cause instanceof Error ? cause.message : "Could not open the Word document.");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);
  const [page, setPage] = useState(0);
  if (!paragraphs) return <p>Loading editor…</p>;
  const pageSize = 50;
  return (
    <>
      <p className="mb-4 text-xs text-muted-foreground">
        Edit paragraph and table-cell text. Existing styles, images, and layout are retained. New
        text inherits the surrounding style. Headers and footers are unchanged.
      </p>
      <div className="space-y-3">
        {paragraphs.slice(page * pageSize, (page + 1) * pageSize).map((text, offset) => {
          const index = page * pageSize + offset;
          return (
            <label className="block text-xs text-muted-foreground" key={index}>
              Paragraph {index + 1}
              <textarea
                aria-label={`Paragraph ${index + 1}`}
                className="mt-1 block min-h-20 w-full resize-y rounded-md border border-border bg-background p-3 text-sm text-foreground"
                defaultValue={drafts.current.get(index) ?? text}
                onChange={(event) => {
                  drafts.current.set(index, event.target.value);
                  changed();
                }}
              />
            </label>
          );
        })}
      </div>
      {paragraphs.length > pageSize && (
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            className={buttonClass}
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            Previous paragraphs
          </button>
          <span className="text-xs">
            {page + 1} / {Math.ceil(paragraphs.length / pageSize)}
          </span>
          <button
            type="button"
            className={buttonClass}
            disabled={(page + 1) * pageSize >= paragraphs.length}
            onClick={() => setPage(page + 1)}
          >
            Next paragraphs
          </button>
        </div>
      )}
    </>
  );
}
