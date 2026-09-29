// Babel (2.9 MB) loads and compiles here, off the reader's thread.
import { transform } from "@babel/standalone";
import { compileInteractive, type CompileReply, type CompileRequest } from "./compile";

const reply = (message: CompileReply) => self.postMessage(message);

self.onmessage = (event: MessageEvent<CompileRequest>) => {
  const { id, source } = event.data;
  reply({ type: "result", id, result: compileInteractive(transform, source) });
};

reply({ type: "ready" });
