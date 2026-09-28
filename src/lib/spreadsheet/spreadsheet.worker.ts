import * as XLSX from "xlsx";
import { SpreadsheetEngine } from "./engine";
import { handleSpreadsheetRequest, type SpreadsheetRequest } from "./protocol";

const engine = new SpreadsheetEngine(XLSX);

self.onmessage = (event: MessageEvent<SpreadsheetRequest>) => {
  void handleSpreadsheetRequest(engine, event.data).then((response) => self.postMessage(response));
};
