# AI model choices and provider errors (A12)

## The problem

Ask AI sends requests from the browser straight to OpenAI or Google with the
reader's own key. The list of models to pick from was hard-coded, and Google
retires models on a schedule. By September 2026 every Gemini model Localdox
offered had been retired: 2.0 Flash and 2.0 Flash-Lite shut down on
2026-06-01, and 1.5 Flash and 1.5 Pro were no longer listed at all.

What the reader saw before this change:

| Situation                                     | Old behaviour                                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Picking any Gemini model                      | Every choice was a retired model; requests failed                                             |
| A retired model saved from an earlier version | Stayed selected, or Settings quietly switched the default to _another provider_               |
| Saving a key while offline or rate-limited    | "That key didn't validate", as if the key were wrong                                          |
| Requesting a retired model                    | Shown as a generic failure; a 403 was reported as "invalid API key"                           |
| The key itself                                | Sent in the URL (`?key=…`), where proxies, logs and error reports that record URLs can see it |
| Temperature                                   | Forced to 0.5; Google says Gemini 3 models should stay at their default of 1.0                |

## The mental model

There are three layers, each answering one question:

1. **What does the app offer?** A short, hand-picked list per provider
   (`provider.models`, first = default), checked against the provider's docs
   when edited. Retired ids map to their replacement (`provider.retiredModels`).
2. **What can this key use?** The provider's own model list, fetched with the
   key when it is saved and when Settings opens (`provider.checkKey`).
3. **What happened to this request?** Every failure has a kind: `auth`,
   `quota`, `network`, `blocked`, `model` (a real key, but a retired or
   withheld model) or `other`.

The hand-picked list is the product decision: short, labelled and tested. The
provider's list is only used to _remove_ options, never to add unknown ones,
because it also contains embedding, speech, image and live models.

```
localStorage "localdox:ai-config"
        │ loadAIConfig → normalizeAIConfig
        │   listed id           → keep (the provider follows the model)
        │   retired id          → its replacement, same provider
        │   unknown id          → the saved provider's default
        ▼
Settings (AiSettings)
        │ checkKey(key)  GET /v1beta/models?pageSize=1000   header x-goog-api-key
        │   ok        → the ids that support generateContent (cached for the session)
        │   not ok    → AIError: auth | quota | network | other → shown under the key
        ▼
chooseDefault: keep the choice if the key can use it, else the same provider's
next usable model (with a notice), else the first connected provider's
        ▼
runAgent → streamChat   POST …:streamGenerateContent?alt=sse   header x-goog-api-key
        404 NOT_FOUND → AIError("model"): try the next provider's key, or tell the
                        reader which model to change
```

## Where the code is

| File                                  | Role                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/services/ai/providers/gemini.ts` | Offered and retired models, `checkKey`, header auth, error classification              |
| `src/services/ai/providers/openai.ts` | The same contract for OpenAI (`checkKey`, `model_not_found`)                           |
| `src/services/ai/config.ts`           | `normalizeAIConfig`: the saved-choice migration, written back once                     |
| `src/services/ai/AiSettings.tsx`      | Availability per key, `chooseDefault`, greyed-out options, the notice and key errors   |
| `src/services/ai/agent.ts`            | Fallback on `model` errors like quota/auth; a lone `model` error keeps its own message |
| `tests/ai-models.test.ts`             | Offline unit tests using the response shapes Google returns                            |
| `tests/e2e/ai-models.spec.ts`         | Browser tests: offered list, migration, greyed-out model, key errors, retired model    |
| `tests/ai-gemini-contract.test.ts`    | Live check against Google; runs only with `LOCALDOX_GEMINI_TEST_KEY`                   |

## Why this approach

- **A curated list plus the key's list, not the key's list alone.** Google's
  list for a key contains dozens of non-chat models with no stable naming rule
  to filter them by. A curated list keeps labels readable; the key's list keeps
  them honest.
- **Migration at load, not in the UI.** The agent and Settings both read
  `loadAIConfig`, so fixing the saved value there fixes every reader. It is
  written back once so later loads are no-ops.
- **Unavailable models fall back like quota does.** A retired Gemini model says
  nothing about an OpenAI key, so a second key still answers. With only one
  key, the reader gets "Gemini can't use X … choose another model", not
  "invalid key".
- **No availability check per request.** That would add a round trip to every
  question. The 404 path covers a model retired mid-session.
- **A 403 is still `auth`.** Google uses it when a real key can't call the API
  or resource. It is not reported as "invalid key" any more; Google's own
  message is shown.

## Updating the list

1. Check <https://ai.google.dev/gemini-api/docs/models> and
   <https://ai.google.dev/gemini-api/docs/deprecations>.
2. Edit `MODELS` in `gemini.ts`. Add every id you remove to `retiredModels`,
   mapped to a listed model from the same line (Pro to Pro, Lite to Lite).
3. Run `npm test` (the invariants check that every replacement is offered),
   then the live check with a test account:
   `LOCALDOX_GEMINI_TEST_KEY=… node --experimental-strip-types --test tests/ai-gemini-contract.test.ts`

## Debugging

- "That key didn't validate": Google answered 400 `API_KEY_INVALID` (or 401).
- "Couldn't reach Google": the list request never got an answer (offline, blocked by an extension or firewall).
- "(not available to your key)" on an option: the key's model list left it out.
  Google limits some models to certain accounts: it offers 2.5 only to
  accounts that used it before, and says previews may need billing.
- In DevTools → Network, requests to `generativelanguage.googleapis.com` carry
  the key only in the `x-goog-api-key` request header. The URL never contains it.

## Limits

- The OpenAI list (`gpt-4o-mini`, `gpt-4o`, `gpt-4.1-mini`, `gpt-4.1`) was not
  re-checked against OpenAI's current models. The availability check will grey
  out any the key can't use, but the list itself needs the same review.
- `gemini-3.1-pro-preview` is a preview. Google can retire it at two weeks'
  notice, and it may need billing.
- The live contract check needs a dedicated key and is not run in CI.
