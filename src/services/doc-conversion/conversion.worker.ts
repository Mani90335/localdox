import { convertDocument, initializeConverter } from "./anydoc-adapter";
import type { ConversionFailure, ConversionSource } from "./types";

self.onmessage = async (event: MessageEvent<ConversionSource>) => {
  try {
    await initializeConverter();
  } catch {
    self.postMessage({ error: { code: "startup" } });
    return;
  }
  try {
    self.postMessage({ result: await convertDocument(event.data) });
  } catch (error) {
    const failure = error as Partial<ConversionFailure> | null;
    self.postMessage({
      error: {
        code: typeof failure?.code === "string" ? failure.code : "unknown",
        pages: Array.isArray(failure?.pages) ? failure.pages : undefined,
      },
    });
  }
};
