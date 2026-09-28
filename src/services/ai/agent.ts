// The agent: turns a user request into a streamed answer. It (1) resolves which
// provider to use from the keys the user actually has, (2) determines the
// smallest sufficient context, (3) builds an optimized prompt, (4) executes with
// streaming, (5) falls back to another keyed provider when one is exhausted, and
// (6) returns the full text.
//
// Any single API key is enough: the configured default is only a preference —
// if its provider has no key, or its key is exhausted/invalid, the agent uses
// whatever other keyed provider is available.

import type { RawContext, ContextPreference } from "./context";
import { resolveContext } from "./context.ts";
import { buildMessages } from "./prompts.ts";
import { getAction, type AIAction } from "./actions.ts";
import { getProvider, providerForModel, PROVIDER_LIST } from "./registry.ts";
import { getKey, listConfigured } from "./keys.ts";
import { loadAIConfig, type AIConfig } from "./config.ts";
import { AIError, type AIProvider, type StreamFinish } from "./types.ts";

export interface AgentInput {
  /** Fixed action id, or omit for a freeform request. */
  actionId?: string;
  /** Freeform request text (when no actionId). */
  freeform?: string;
  /** User's note/question for actions that accept input. */
  userInput?: string;
  /** Everything available as context; the agent trims to the minimum. */
  rawContext: RawContext;
  /** Force the context slice (from the panel's context selector), overriding
   *  the action's default preference. */
  contextPreference?: ContextPreference;
  /** Overrides the saved default config. */
  config?: Partial<AIConfig>;
  signal?: AbortSignal;
  /** Called with each incremental chunk of assistant text. */
  onToken?: (chunk: string) => void;
}

export interface AgentResult {
  text: string;
  scopeLabel: string;
  approxTokens: number;
  model: string;
  provider: string;
  /** How the provider's stream ended; "stop" unless the answer is incomplete. */
  finish: StreamFinish["reason"];
}

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const cfg = { ...loadAIConfig(), ...input.config };

  // The ordered list of providers to try — keyed providers only, preferred one
  // first. Any single key is enough; extra keys become automatic fallbacks.
  const chain = await providerChain(cfg);
  input.signal?.throwIfAborted();
  if (chain.length === 0) {
    throw new AIError(
      "auth",
      "Add your OpenAI or Gemini API key in Settings → Ask AI to use this.",
    );
  }

  const action: AIAction | undefined = input.actionId ? getAction(input.actionId) : undefined;
  const preference: ContextPreference =
    input.contextPreference ?? action?.context ?? defaultPreference(input.rawContext);
  const context = resolveContext(input.rawContext, preference);
  const messages = buildMessages({
    action,
    freeform: input.freeform,
    userInput: input.userInput,
    context,
  });

  let lastError: AIError | null = null;
  for (let i = 0; i < chain.length; i++) {
    const { provider, key } = chain[i];
    const model = modelFor(provider, cfg.defaultModel);
    try {
      input.signal?.throwIfAborted();
      let text = "";
      // Iterated by hand: for-await drops the generator's return value.
      const stream = provider.streamChat({ messages, model, signal: input.signal }, key);
      let step = await stream.next();
      while (!step.done) {
        text += step.value;
        input.onToken?.(step.value);
        step = await stream.next();
      }
      // A provider that ends quietly after an abort must not read as a
      // complete answer.
      input.signal?.throwIfAborted();
      return {
        text,
        scopeLabel: context.scopeLabel,
        approxTokens: context.approxTokens,
        model,
        provider: provider.id,
        finish: step.value.reason,
      };
    } catch (err) {
      // Abort is user intent — never swallow or fall back. Once the signal
      // has aborted, whatever surfaced (a fetch TypeError, a stream error) is
      // the cancellation, not a provider failure.
      if (input.signal?.aborted) throw abortReason(input.signal);
      if ((err as Error)?.name === "AbortError") throw err;
      const aiErr = asAIError(err);
      lastError = aiErr;
      // Only quota/auth/model failures are worth trying the next key: they
      // belong to this provider. A genuine content/network error would just
      // repeat.
      const recoverable = aiErr.kind === "quota" || aiErr.kind === "auth" || aiErr.kind === "model";
      const hasNext = i < chain.length - 1;
      if (recoverable && hasNext) continue;
      // An unavailable model is not a bad key; its message says what to change.
      if (aiErr.kind === "model") throw aiErr;
      if (recoverable) throw exhaustionError(chain, aiErr);
      throw aiErr;
    }
  }

  throw lastError ?? new AIError("other", "The AI request could not be completed.");
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error && reason.name === "AbortError"
    ? reason
    : new DOMException("The request was cancelled.", "AbortError");
}

// Providers that have a key, preferred-first. The preferred provider comes from
// the configured default model (falling back to the configured default provider).
async function providerChain(cfg: AIConfig): Promise<{ provider: AIProvider; key: string }[]> {
  const configuredIds = new Set(await listConfigured());
  const preferredId = providerForModel(cfg.defaultModel)?.id ?? cfg.defaultProvider;

  const ordered: AIProvider[] = [];
  const preferred = getProvider(preferredId);
  if (preferred && configuredIds.has(preferred.id)) ordered.push(preferred);
  for (const provider of PROVIDER_LIST) {
    if (configuredIds.has(provider.id) && !ordered.includes(provider)) ordered.push(provider);
  }

  const out: { provider: AIProvider; key: string }[] = [];
  for (const provider of ordered) {
    const key = await getKey(provider.id);
    if (key) out.push({ provider, key });
  }
  return out;
}

// Use the configured model when it belongs to this provider; otherwise the
// provider's first (fastest) model — so a fallback provider still has a model.
function modelFor(provider: AIProvider, configuredModel: string): string {
  return provider.models.some((m) => m.id === configuredModel)
    ? configuredModel
    : provider.models[0].id;
}

function asAIError(err: unknown): AIError {
  if (err instanceof AIError) return err;
  const message = (err as Error)?.message ?? "The AI request failed.";
  // Network / CORS failures surface as TypeError from fetch.
  if ((err as Error)?.name === "TypeError") {
    return new AIError("network", "Could not reach the AI provider. Check your connection.");
  }
  return new AIError("other", message);
}

// Message shown when every available key is exhausted or invalid.
function exhaustionError(chain: { provider: AIProvider }[], last: AIError): AIError {
  if (chain.length === 1) {
    const name = chain[0].provider.label;
    const reason =
      last.kind === "auth"
        ? `Your ${name} API key is invalid.`
        : `Your ${name} API key limit is exhausted.`;
    return new AIError(
      last.kind,
      `${reason} Update it, or add another provider's key in Settings → Ask AI.`,
    );
  }
  return new AIError(
    last.kind,
    "All your API keys are exhausted or invalid. Update them in Settings → Ask AI.",
  );
}

// Freeform requests prefer a selection when present, else the whole document.
function defaultPreference(raw: RawContext): ContextPreference {
  if (raw.selection?.trim()) return "selection";
  return "document";
}
