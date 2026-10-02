import { traceSchema, type Language, type Trace } from "./protocol";
import { runJavaScript } from "./javascript-runtime";

// Keep the trusted compiler warm between edits. Authored programs always get
// their own disposable execution worker. Release Babel after a minute idle.
let idleCompiler: Worker | undefined;
let idleCompilerTimer: ReturnType<typeof setTimeout> | undefined;

function compile(source: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker =
      idleCompiler ??
      new Worker(new URL("./compiler.worker.ts", import.meta.url), { type: "module" });
    idleCompiler = undefined;
    clearTimeout(idleCompilerTimer);
    let finished = false;
    const finish = (error?: string, code?: string, reusable = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      if (reusable) {
        idleCompiler?.terminate();
        idleCompiler = worker;
        idleCompilerTimer = setTimeout(() => {
          if (idleCompiler === worker) idleCompiler = undefined;
          worker.terminate();
        }, 60000);
      } else worker.terminate();
      signal.removeEventListener("abort", abort);
      if (error) reject(new Error(error));
      else resolve(code!);
    };
    const abort = () => finish("Execution cancelled.");
    const timer = setTimeout(() => finish("The compiler timed out."), 20000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (e) => finish(e.data.error, e.data.code, true);
    worker.onerror = () => finish("The JavaScript compiler could not load. Please try again.");
    if (signal.aborted) abort();
    else worker.postMessage(source);
  });
}

export async function execute(
  language: Language,
  source: string,
  stdin: string,
  signal: AbortSignal,
): Promise<Trace> {
  if (source.length > 50000) throw new Error("Use a program smaller than 50,000 characters.");
  if (!source.trim()) throw new Error("Write a program first, or choose a foundation lesson.");
  if (language !== "javascript") {
    const endpoint = import.meta.env.VITE_CODE_RUNNER_URL;
    if (!endpoint)
      throw new Error(
        `${language === "cpp" ? "C++" : "Python"} needs the isolated runner. Start the service in services/code-runner and set VITE_CODE_RUNNER_URL. You can explore all foundation animations now.`,
      );
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/trace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, source, stdin }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      credentials: "omit",
    }).catch(() => {
      if (signal.aborted) throw new Error("Execution cancelled.");
      throw new Error(
        `${language === "cpp" ? "C++" : "Python"} needs the isolated runner. The configured service did not respond. Start services/code-runner/server.py and check its allowed origin.`,
      );
    });
    if (!response.ok)
      throw new Error(
        (await response.text()).slice(0, 1000) ||
          "The execution service could not run this program.",
      );
    const text = await response.text();
    if (text.length > 16000000) throw new Error("The trace exceeds the 16 MB display limit.");
    return traceSchema.parse(JSON.parse(text));
  }
  const compiled = await compile(source, signal);
  if (signal.aborted) throw new Error("Execution cancelled.");
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.setAttribute("sandbox", "allow-scripts");
    frame.title = "Isolated code execution";
    const token = crypto.randomUUID();
    const workerCode = `const deny=()=>{throw new Error('Network and additional workers are disabled in Code Studio.')};for(const name of ['fetch','XMLHttpRequest','WebSocket','WebTransport','EventSource','Worker','SharedWorker','importScripts','BroadcastChannel']){Object.defineProperty(self,name,{value:deny,writable:false,configurable:false});}const run=${runJavaScript.toString()};self.onmessage=e=>{const result=run(e.data);self.postMessage(result);};`;
    // Authored code executes only in a worker with an opaque origin, no network,
    // no DOM or workspace storage. The parent can terminate a blocked worker.
    frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'"><script>const worker=new Worker(URL.createObjectURL(new Blob([${JSON.stringify(workerCode).replace(/</g, "\\u003c")}],{type:'text/javascript'})));worker.onmessage=e=>parent.postMessage({token:${JSON.stringify(token)},trace:e.data},'*');worker.onerror=()=>parent.postMessage({token:${JSON.stringify(token)},error:'Execution failed.'},'*');addEventListener('message',e=>{if(e.source===parent)worker.postMessage(e.data)});parent.postMessage({token:${JSON.stringify(token)},ready:true},'*');</script>`;
    const finish = (error?: string, trace?: unknown) => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      signal.removeEventListener("abort", abort);
      frame.remove();
      if (error) reject(new Error(error));
      else {
        try {
          resolve(traceSchema.parse(trace));
        } catch {
          reject(new Error("The program produced an invalid or oversized trace."));
        }
      }
    };
    const abort = () => finish("Execution cancelled.");
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.token !== token) return;
      if (event.data.ready) frame.contentWindow!.postMessage({ source, compiled, stdin }, "*");
      else finish(event.data.error, event.data.trace);
    };
    const timer = setTimeout(
      () => finish("Stopped after 8 seconds. Try a smaller input or check for an infinite loop."),
      8000,
    );
    window.addEventListener("message", receive);
    signal.addEventListener("abort", abort, { once: true });
    document.body.append(frame);
  });
}
