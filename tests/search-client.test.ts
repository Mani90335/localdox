import assert from "node:assert/strict";
import { test } from "node:test";
import { DocumentIndex } from "../src/lib/search/document-index.ts";
import {
  handleSearchRequest,
  type SearchRequest,
  type SearchResponse,
} from "../src/lib/search/protocol.ts";
import {
  createWorkerSearchClient,
  SearchClosedError,
  SearchRequestError,
} from "../src/lib/search/search-client.ts";
import { createLocalSearchClient } from "../src/lib/search/local-search-client.ts";

// A07: every request must settle (result, error reply, worker failure or
// close), and a replaced worker must not inherit anything.

/** Stands in for the search worker. With an index it answers like the real
 *  worker does: a handler per message, started without waiting for earlier
 *  ones, each reply delivered as its own task. */
class FakeWorker extends EventTarget {
  posted: SearchRequest[] = [];
  terminated = false;
  listeners = 0;
  failPost = false;

  private index?: DocumentIndex;

  constructor(index?: DocumentIndex) {
    super();
    this.index = index;
  }

  postMessage(request: SearchRequest) {
    if (this.failPost) throw new DOMException("could not clone", "DataCloneError");
    this.posted.push(request);
    if (this.index)
      void handleSearchRequest(this.index, request).then((response) =>
        setTimeout(() => this.reply(response)),
      );
  }

  reply(response: SearchResponse) {
    this.dispatchEvent(new MessageEvent("message", { data: response }));
  }

  terminate() {
    this.terminated = true;
  }

  override addEventListener(...args: Parameters<EventTarget["addEventListener"]>) {
    this.listeners++;
    super.addEventListener(...args);
  }

  override removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>) {
    this.listeners--;
    super.removeEventListener(...args);
  }
}

function workerClient(worker: FakeWorker) {
  const failures: unknown[] = [];
  const client = createWorkerSearchClient(worker as unknown as Worker, (reason) =>
    failures.push(reason),
  );
  return { client, failures };
}

test("replies are matched by request id, in any order, through one listener", async () => {
  const worker = new FakeWorker();
  const { client } = workerClient(worker);
  const listeners = worker.listeners;
  const first = client.search("one", ["w"]);
  const second = client.sync("w", []);
  const third = client.search("three", ["w"]);
  assert.equal(worker.listeners, listeners, "no listener per request");

  const [a, b, c] = worker.posted.map((request) => request.reqId);
  assert.equal(new Set([a, b, c]).size, 3);
  worker.reply({ reqId: c, type: "hits", hits: [], total: 0 });
  worker.reply({ reqId: b, type: "ack", generation: 7 });
  worker.reply({ reqId: 999, type: "hits", hits: [], total: 0 }); // unknown: ignored
  worker.reply({ reqId: a, type: "hits", hits: [], total: 0 });
  assert.deepEqual(await first, { hits: [], total: 0 });
  assert.equal(await second, 7);
  assert.deepEqual(await third, { hits: [], total: 0 });
});

test("an error reply rejects only its own request", async () => {
  const worker = new FakeWorker();
  const { client, failures } = workerClient(worker);
  const failing = client.search("x", ["w"]);
  const fine = client.sync("w", []);
  worker.reply({ reqId: worker.posted[0].reqId, type: "error", message: "boom" });
  await assert.rejects(
    failing,
    (error) => error instanceof SearchRequestError && /boom/.test(error.message),
  );
  worker.reply({ reqId: worker.posted[1].reqId, type: "ack", generation: 1 });
  assert.equal(await fine, 1);
  assert.equal(client.closed, false);
  assert.deepEqual(failures, []);
});

for (const event of ["error", "messageerror"] as const)
  test(`a worker ${event} settles every pending request and reports the failure once`, async () => {
    const worker = new FakeWorker();
    const { client, failures } = workerClient(worker);
    const pending = [client.search("a", ["w"]), client.sync("w", []), client.drop("w")];
    worker.dispatchEvent(new Event(event));
    worker.dispatchEvent(new Event(event));
    for (const request of pending)
      await assert.rejects(request, (error) => error instanceof SearchClosedError);
    assert.equal(failures.length, 1);
    assert.ok(worker.terminated);
    assert.equal(worker.listeners, 0, "listeners removed");
    assert.ok(client.closed);
    // A late reply from the dead worker, and requests after the failure.
    worker.reply({ reqId: worker.posted[0].reqId, type: "hits", hits: [], total: 0 });
    await assert.rejects(client.search("b", ["w"]), SearchClosedError);
    assert.equal(worker.posted.length, 3, "nothing posted to a failed worker");
  });

test("close rejects pending requests without reporting a failure, and is idempotent", async () => {
  const worker = new FakeWorker();
  const { client, failures } = workerClient(worker);
  const pending = client.search("a", ["w"]);
  client.close();
  client.close();
  await assert.rejects(pending, SearchClosedError);
  await assert.rejects(client.sync("w", []), SearchClosedError);
  assert.ok(worker.terminated);
  assert.equal(worker.listeners, 0);
  assert.deepEqual(failures, []);
});

test("a message the worker can't receive rejects that request and nothing else", async () => {
  const worker = new FakeWorker();
  const { client } = workerClient(worker);
  worker.failPost = true;
  await assert.rejects(client.sync("w", []), /could not clone/);
  worker.failPost = false;
  const later = client.search("a", ["w"]);
  worker.reply({ reqId: worker.posted[0].reqId, type: "hits", hits: [], total: 0 });
  assert.deepEqual(await later, { hits: [], total: 0 });
});

test("through a real index, a burst of edits, a drop and a search settle correctly", async () => {
  const worker = new FakeWorker(new DocumentIndex());
  const { client } = workerClient(worker);
  const docs = (tag: string) =>
    Array.from({ length: 40 }, (_, i) => ({
      id: String(i),
      name: `n${i}.md`,
      content: `${tag} ${i}`,
    }));
  const requests = [
    client.sync("current", docs("first")),
    client.sync("other", docs("elsewhere")),
    client.sync("current", docs("second")),
    client.drop("other"),
    client.sync("current", docs("third")),
  ];
  const { hits } = await client.search("third", ["current", "other"]);
  const generations = await Promise.all(requests);
  assert.deepEqual(
    [...generations].sort((a, b) => a - b),
    generations,
    "acks report the order the index applied them",
  );
  assert.equal(new Set(hits.map((hit) => hit.fileId)).size, 40);
  for (const stale of ["first", "second", "elsewhere"])
    assert.deepEqual((await client.search(stale, ["current", "other"])).hits, [], stale);

  // The worker's error reply for a bad request, then normal service.
  await assert.rejects(
    client.sync("current", [
      ...docs("third"),
      { id: "x", name: "x.md", content: null as unknown as string },
    ]),
    SearchRequestError,
  );
  assert.equal(
    new Set((await client.search("third", ["current"])).hits.map((hit) => hit.fileId)).size,
    40,
  );
});

test("the main-thread client indexes, reports errors and settles once closed", async () => {
  const client = createLocalSearchClient();
  const generation = await client.sync("w", [{ id: "1", name: "a.md", content: "local text" }]);
  assert.ok(generation > 0);
  assert.equal((await client.search("local", ["w"])).hits.length, 1);
  await assert.rejects(
    client.sync("w", [{ id: "2", name: "b.md", content: null as unknown as string }]),
    SearchRequestError,
  );
  const inFlight = client.search("local", ["w"]);
  client.close();
  await assert.rejects(inFlight, SearchClosedError, "a closed session's result is not delivered");
  await assert.rejects(client.drop("w"), SearchClosedError);
});
