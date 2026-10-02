import { transform } from "@babel/standalone";
import { instrument } from "./instrument";
self.onmessage = (event: MessageEvent<string>) => {
  try {
    self.postMessage({ code: instrument(transform, event.data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
