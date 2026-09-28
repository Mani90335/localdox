import {
  StaleViewError,
  ViewSupersededError,
  type RowWindow,
  type SheetLayout,
  type SheetSort,
  type SpreadsheetEngine,
  type SpreadsheetSource,
  type ViewInfo,
} from "./engine.ts";

export type SpreadsheetRequest = { reqId: number } & (
  | { type: "open"; source: SpreadsheetSource }
  | { type: "layout"; sheet: number }
  | { type: "view"; sheet: number; query: string; sort: SheetSort }
  | {
      type: "rows";
      viewId: number;
      start: number;
      end: number;
      columnStart: number;
      columnEnd: number;
    }
);

export type SpreadsheetResponse = { reqId: number } & (
  | { type: "opened"; sheets: string[] }
  | { type: "layout"; layout: SheetLayout }
  | { type: "view"; view: ViewInfo }
  | { type: "rows"; window: RowWindow }
  /** A newer view request overtook this one. */
  | { type: "superseded" }
  /** The requested view was dropped; a newer one replaced it. */
  | { type: "stale" }
  | { type: "error"; message: string }
);

/** Answers one request. Never throws: every request gets exactly one reply. */
export async function handleSpreadsheetRequest(
  engine: SpreadsheetEngine,
  request: SpreadsheetRequest,
): Promise<SpreadsheetResponse> {
  const { reqId } = request;
  try {
    switch (request.type) {
      case "open":
        return { reqId, type: "opened", sheets: engine.open(request.source).sheets };
      case "layout":
        return { reqId, type: "layout", layout: engine.layout(request.sheet) };
      case "view":
        return {
          reqId,
          type: "view",
          view: await engine.view(request.sheet, request.query, request.sort),
        };
      case "rows":
        return {
          reqId,
          type: "rows",
          window: engine.rows(
            request.viewId,
            request.start,
            request.end,
            request.columnStart,
            request.columnEnd,
          ),
        };
      default:
        return {
          reqId,
          type: "error",
          message: `Unknown request ${(request as { type?: unknown }).type}`,
        };
    }
  } catch (error) {
    if (error instanceof ViewSupersededError) return { reqId, type: "superseded" };
    if (error instanceof StaleViewError) return { reqId, type: "stale" };
    return {
      reqId,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
