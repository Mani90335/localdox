// The math engine (@cortex-js/compute-engine) loads and runs here, off the
// reader's thread. See compute-client.ts for the protocol around it.
import { ComputeEngine } from "@cortex-js/compute-engine";
import { compute, configureEngine } from "./engine";
import type { WorkerReply, WorkerRequest } from "./protocol";

const ce = new ComputeEngine();
configureEngine(ce);

const reply = (message: WorkerReply) => self.postMessage(message);

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, request } = event.data;
  reply({ type: "result", id, result: compute(ce, request) });
};

reply({ type: "ready" });
