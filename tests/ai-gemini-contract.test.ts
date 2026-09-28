import assert from "node:assert/strict";
import { test } from "node:test";

import { geminiProvider } from "../src/services/ai/providers/gemini.ts";

// A12: a live check that every Gemini model Localdox offers is still served.
// It calls Google, so it runs only with a key for a dedicated test account:
//
//   LOCALDOX_GEMINI_TEST_KEY=… node --experimental-strip-types --test tests/ai-gemini-contract.test.ts
//
// Without the variable it is skipped, so `npm test` stays offline.

const key = process.env.LOCALDOX_GEMINI_TEST_KEY;
const skip = key ? false : "set LOCALDOX_GEMINI_TEST_KEY to call Google";

test("the key works and can use every offered model", { skip }, async () => {
  const check = await geminiProvider.checkKey(key!);
  assert.ok(check.ok, check.ok ? "" : check.error.message);
  assert.ok(check.available, "Google returned no complete model list");
  const missing = geminiProvider.models
    .map((m) => m.id)
    .filter((id) => !check.available!.includes(id));
  assert.deepEqual(missing, [], "offered models Google no longer serves to this key");
});

test("the default model streams a short answer that ends normally", { skip }, async () => {
  const stream = geminiProvider.streamChat(
    {
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
      model: geminiProvider.models[0].id,
      signal: AbortSignal.timeout(30_000),
    },
    key!,
  );
  let text = "";
  let step = await stream.next();
  while (!step.done) {
    text += step.value;
    step = await stream.next();
  }
  assert.ok(text.trim().length > 0);
  assert.equal(step.value.reason, "stop");
});
