import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { indexedDB as fakeIndexedDB, IDBKeyRange } from "fake-indexeddb";

import { loadAIConfig, normalizeAIConfig } from "../src/services/ai/config.ts";
import { geminiProvider } from "../src/services/ai/providers/gemini.ts";
import { openaiProvider } from "../src/services/ai/providers/openai.ts";
import { PROVIDER_LIST, providerForModel } from "../src/services/ai/registry.ts";
import { AIError, type KeyCheck } from "../src/services/ai/types.ts";

Object.assign(globalThis, { indexedDB: fakeIndexedDB, IDBKeyRange });

// A12: Gemini offers only models Google still serves, saved choices of retired
// models migrate, keys travel in a header, and an unavailable model is
// reported as such rather than as a bad key or a quota.

// ---------------------------------------------------------------- helpers

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Call {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Answer fetches in order and record what was sent. */
function serve(...responses: (Response | Error)[]) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const googleError = (status: number, code: string, message: string, reason?: string) =>
  json(
    {
      error: {
        code: status,
        message,
        status: code,
        ...(reason ? { details: [{ reason, domain: "googleapis.com" }] } : {}),
      },
    },
    status,
  );

const sse = (...events: unknown[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });

const listed = (name: string, methods = ["generateContent", "countTokens"]) => ({
  name: `models/${name}`,
  supportedGenerationMethods: methods,
});

class MemoryStorage {
  #items = new Map<string, string>();
  get length() {
    return this.#items.size;
  }
  key(i: number) {
    return [...this.#items.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.#items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.#items.set(k, String(v));
  }
  removeItem(k: string) {
    this.#items.delete(k);
  }
  clear() {
    this.#items.clear();
  }
}

async function drain(gen: AsyncGenerator<string, unknown>) {
  let step = await gen.next();
  while (!step.done) step = await gen.next();
}

// ---------------------------------------------------------------- model list

describe("offered models", () => {
  test("Gemini offers none of the ids Google has shut down", () => {
    const offered = geminiProvider.models.map((m) => m.id);
    for (const retired of [
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
    ]) {
      assert.ok(!offered.includes(retired), `${retired} is still offered`);
      assert.ok(geminiProvider.retiredModels?.[retired], `${retired} has no replacement`);
    }
  });

  test("every retired id maps to a model its own provider offers", () => {
    for (const provider of PROVIDER_LIST) {
      const offered = new Set(provider.models.map((m) => m.id));
      for (const [from, to] of Object.entries(provider.retiredModels ?? {})) {
        assert.ok(offered.has(to), `${from} → ${to}, which ${provider.id} doesn't offer`);
        assert.ok(!offered.has(from), `${from} is both offered and retired`);
      }
    }
  });

  test("no two providers claim the same model id", () => {
    const ids = PROVIDER_LIST.flatMap((p) => p.models.map((m) => m.id));
    assert.equal(new Set(ids).size, ids.length);
  });
});

// ---------------------------------------------------------------- migration

describe("saved model migration", () => {
  test("each retired Gemini choice keeps its provider and its line", () => {
    const cases: [string, string][] = [
      ["gemini-2.0-flash", "gemini-3.8-flash"],
      ["gemini-2.0-flash-lite", "gemini-3.5-flash-lite"],
      ["gemini-1.5-flash", "gemini-3.8-flash"],
      ["gemini-1.5-pro", "gemini-3.1-pro-preview"],
    ];
    for (const [from, to] of cases) {
      assert.deepEqual(normalizeAIConfig({ defaultProvider: "gemini", defaultModel: from }), {
        defaultProvider: "gemini",
        defaultModel: to,
      });
    }
  });

  test("a listed model is kept, and its provider follows the model", () => {
    assert.deepEqual(
      normalizeAIConfig({ defaultProvider: "openai", defaultModel: "gemini-3.8-flash" }),
      { defaultProvider: "gemini", defaultModel: "gemini-3.8-flash" },
    );
  });

  test("an unknown model falls back to its provider's default, not another provider", () => {
    assert.deepEqual(
      normalizeAIConfig({ defaultProvider: "gemini", defaultModel: "gemini-0.9-mystery" }),
      { defaultProvider: "gemini", defaultModel: geminiProvider.models[0].id },
    );
    assert.deepEqual(normalizeAIConfig({ defaultProvider: "gemini" }), {
      defaultProvider: "gemini",
      defaultModel: geminiProvider.models[0].id,
    });
  });

  test("garbage falls back to the app default", () => {
    const fallback = normalizeAIConfig({});
    assert.ok(providerForModel(fallback.defaultModel));
    assert.deepEqual(
      normalizeAIConfig({ defaultProvider: 42, defaultModel: null } as never),
      fallback,
    );
  });

  describe("loadAIConfig", () => {
    let storage: MemoryStorage;
    beforeEach(() => {
      storage = new MemoryStorage();
      Object.assign(globalThis, { localStorage: storage });
    });
    afterEach(() => {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    });

    test("writes a migrated choice back once", () => {
      storage.setItem(
        "localdox:ai-config",
        JSON.stringify({ defaultProvider: "gemini", defaultModel: "gemini-1.5-pro" }),
      );
      const setItem = storage.setItem.bind(storage);
      let writes = 0;
      storage.setItem = (k, v) => {
        writes++;
        setItem(k, v);
      };

      assert.equal(loadAIConfig().defaultModel, "gemini-3.1-pro-preview");
      assert.deepEqual(JSON.parse(storage.getItem("localdox:ai-config")!), {
        defaultProvider: "gemini",
        defaultModel: "gemini-3.1-pro-preview",
      });
      assert.equal(loadAIConfig().defaultModel, "gemini-3.1-pro-preview");
      assert.equal(writes, 1, "a current config is not rewritten");
    });

    test("nothing saved means nothing written", () => {
      loadAIConfig();
      assert.equal(storage.length, 0);
    });

    test("unreadable JSON falls back without throwing", () => {
      storage.setItem("localdox:ai-config", "{not json");
      assert.ok(providerForModel(loadAIConfig().defaultModel));
      storage.setItem("localdox:ai-config", "null");
      assert.ok(providerForModel(loadAIConfig().defaultModel));
    });
  });
});

// ---------------------------------------------------------------- Gemini key check

describe("Gemini checkKey", () => {
  test("sends the key in a header, never the URL, and lists generation models", async () => {
    const calls = serve(
      json({
        models: [
          listed("gemini-3.8-flash"),
          listed("gemini-3.5-flash-lite"),
          listed("gemini-embedding-2", ["embedContent"]),
          { name: 42 },
        ],
      }),
    );
    const check = await geminiProvider.checkKey("secret-key");
    assert.deepEqual(check, { ok: true, available: ["gemini-3.8-flash", "gemini-3.5-flash-lite"] });
    assert.equal(calls[0].headers["x-goog-api-key"], "secret-key");
    assert.ok(!calls[0].url.includes("secret-key"), calls[0].url);
    assert.match(calls[0].url, /\/v1beta\/models\?pageSize=1000$/);
  });

  test("follows nextPageToken", async () => {
    const calls = serve(
      json({ models: [listed("gemini-3.8-flash")], nextPageToken: "p2" }),
      json({ models: [listed("gemini-3.1-pro-preview")] }),
    );
    const check = await geminiProvider.checkKey("k");
    assert.deepEqual(check, {
      ok: true,
      available: ["gemini-3.8-flash", "gemini-3.1-pro-preview"],
    });
    assert.match(calls[1].url, /pageToken=p2/);
  });

  test("a list that never ends accepts the key without ruling models out", async () => {
    const pages = Array.from({ length: 5 }, (_, i) =>
      json({ models: [listed(`m${i}`)], nextPageToken: `p${i + 1}` }),
    );
    const calls = serve(...pages);
    assert.deepEqual(await geminiProvider.checkKey("k"), { ok: true });
    assert.equal(calls.length, 5);
  });

  const failure = async (response: Response | Error) => {
    serve(response);
    const check: KeyCheck = await geminiProvider.checkKey("k");
    assert.equal(check.ok, false);
    return (check as { ok: false; error: AIError }).error;
  };

  test("tells a bad key, a quota, no credit, a refusal and no connection apart", async () => {
    // What Google returns today for an unknown key (checked 2026-09-28).
    const bad = await failure(
      googleError(
        400,
        "INVALID_ARGUMENT",
        "API key not valid. Please pass a valid API key.",
        "API_KEY_INVALID",
      ),
    );
    assert.equal(bad.kind, "auth");
    assert.equal(bad.message, "Gemini: invalid API key.");

    assert.equal(
      (await failure(googleError(429, "RESOURCE_EXHAUSTED", "Too many requests"))).kind,
      "quota",
    );
    assert.equal(
      (await failure(json({ error: { message: "Your Prepay credit balance is depleted." } }, 402)))
        .kind,
      "quota",
    );

    const denied = await failure(
      googleError(
        403,
        "PERMISSION_DENIED",
        "Generative Language API has not been used in project 1",
      ),
    );
    assert.equal(denied.kind, "auth");
    assert.match(denied.message, /refused this API key: Generative Language API/);

    const offline = await failure(new TypeError("Failed to fetch"));
    assert.equal(offline.kind, "network");
  });

  test("a 404 while listing is not a model error", async () => {
    const error = await failure(googleError(404, "NOT_FOUND", "Not found"));
    assert.equal(error.kind, "other");
  });
});

// ---------------------------------------------------------------- Gemini streaming

describe("Gemini streamChat", () => {
  const request = (model: string, temperature?: number) => ({
    messages: [
      { role: "system" as const, content: "Be brief." },
      { role: "user" as const, content: "hi" },
    ],
    model,
    ...(temperature !== undefined ? { temperature } : {}),
  });

  test("the key is a header, and Gemini 3 keeps its default temperature", async () => {
    const calls = serve(
      sse({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] }),
    );
    await drain(geminiProvider.streamChat(request("gemini-3.8-flash"), "secret-key"));
    const [call] = calls;
    assert.equal(call.headers["x-goog-api-key"], "secret-key");
    assert.ok(!call.url.includes("secret-key"), call.url);
    assert.match(call.url, /models\/gemini-3\.8-flash:streamGenerateContent\?alt=sse$/);
    assert.equal((call.body as { generationConfig?: unknown }).generationConfig, undefined);
  });

  test("an explicit temperature is still sent", async () => {
    const calls = serve(
      sse({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] }),
    );
    await drain(geminiProvider.streamChat(request("gemini-3.8-flash", 0.2), "k"));
    assert.deepEqual((calls[0].body as { generationConfig: unknown }).generationConfig, {
      temperature: 0.2,
    });
  });

  test("a retired model is a model error that names it, not a bad key", async () => {
    serve(
      googleError(
        404,
        "NOT_FOUND",
        "models/gemini-3.1-pro-preview is not found for API version v1beta, or is not supported for generateContent.",
      ),
    );
    await assert.rejects(
      drain(geminiProvider.streamChat(request("gemini-3.1-pro-preview"), "k")),
      (e: AIError) =>
        e.kind === "model" &&
        /Gemini 3\.1 Pro \(preview\)/.test(e.message) &&
        /Settings/.test(e.message),
    );
  });

  test("an invalid key while streaming is still an auth error", async () => {
    serve(googleError(400, "INVALID_ARGUMENT", "API key not valid.", "API_KEY_INVALID"));
    await assert.rejects(
      drain(geminiProvider.streamChat(request("gemini-3.8-flash"), "k")),
      (e: AIError) => e.kind === "auth",
    );
  });
});

// ---------------------------------------------------------------- OpenAI

describe("OpenAI checkKey and model errors", () => {
  test("lists the key's models", async () => {
    serve(json({ data: [{ id: "gpt-4o-mini" }, { id: 7 }, { id: "gpt-4.1" }] }));
    assert.deepEqual(await openaiProvider.checkKey("sk"), {
      ok: true,
      available: ["gpt-4o-mini", "gpt-4.1"],
    });
  });

  test("a bad key is auth, no connection is network", async () => {
    serve(json({ error: { message: "Incorrect API key" } }, 401));
    const bad = await openaiProvider.checkKey("sk");
    assert.equal(!bad.ok && bad.error.kind, "auth");
    serve(new TypeError("Failed to fetch"));
    const offline = await openaiProvider.checkKey("sk");
    assert.equal(!offline.ok && offline.error.kind, "network");
  });

  test("model_not_found is a model error", async () => {
    serve(
      json(
        { error: { message: "The model `gpt-x` does not exist", code: "model_not_found" } },
        404,
      ),
    );
    await assert.rejects(
      drain(openaiProvider.streamChat({ messages: [], model: "gpt-x" }, "sk")),
      (e: AIError) => e.kind === "model" && /gpt-x/.test(e.message),
    );
  });
});

// ---------------------------------------------------------------- agent

describe("runAgent with an unavailable model", () => {
  let runAgent: typeof import("../src/services/ai/agent.ts").runAgent;
  let keys: typeof import("../src/services/ai/keys.ts");

  beforeEach(async () => {
    ({ runAgent } = await import("../src/services/ai/agent.ts"));
    keys = await import("../src/services/ai/keys.ts");
  });

  afterEach(async () => {
    await keys.removeKey("openai");
    await keys.removeKey("gemini");
  });

  const input = {
    freeform: "Summarise",
    rawContext: { selection: null, section: null, document: { name: "a.md", content: "text" } },
    config: { defaultModel: "gemini-3.1-pro-preview" },
  };
  const notFound = () =>
    googleError(404, "NOT_FOUND", "models/gemini-3.1-pro-preview is not found");

  test("with one key, the model error reaches the user unchanged", async () => {
    await keys.setKey("gemini", "g-test");
    const calls = serve(notFound());
    await assert.rejects(
      runAgent(input),
      (e: AIError) =>
        e.kind === "model" &&
        /Gemini 3\.1 Pro \(preview\)/.test(e.message) &&
        !/invalid/i.test(e.message),
    );
    assert.equal(calls.length, 1);
  });

  test("with a second key, the next provider answers", async () => {
    await keys.setKey("gemini", "g-test");
    await keys.setKey("openai", "sk-test");
    const calls = serve(
      notFound(),
      sse(
        { choices: [{ delta: { content: "From OpenAI" } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ),
    );
    const result = await runAgent(input);
    assert.equal(result.provider, "openai");
    assert.equal(result.text, "From OpenAI");
    assert.match(calls[0].url, /gemini-3\.1-pro-preview/);
    assert.match(calls[1].url, /api\.openai\.com/);
  });
});
