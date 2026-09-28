// Provider-agnostic AI layer types. Everything the UI touches is expressed in
// terms of these interfaces so new providers drop in by implementing AIProvider
// and registering in registry.ts — no UI changes required.

// String-typed so third-party providers can extend the union at the edges
// without a central enum edit. The two shipped providers are named for typing.
export type ProviderId = "openai" | "gemini" | (string & {});

export interface AIModel {
  id: string;
  label: string;
}

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface AIRequest {
  messages: ChatMessage[];
  model: string;
  /** Abort in-flight streaming (used by the Stop button). */
  signal?: AbortSignal;
  temperature?: number;
}

// Categorized failure so the agent can decide whether to fall back to another
// provider's key (quota/auth/model) or surface the error as-is (the rest).
// "blocked" means the provider refused the prompt or withheld the answer;
// "model" means the key works but the chosen model is retired or not offered
// to it.
export type AIErrorKind = "auth" | "quota" | "network" | "blocked" | "model" | "other";

/**
 * How a stream ended, returned by streamChat once its last chunk is yielded.
 * "length": the model hit its output limit, so the answer is cut short.
 * "interrupted": the stream closed without the provider saying it was done.
 */
export interface StreamFinish {
  reason: "stop" | "length" | "interrupted";
}

export class AIError extends Error {
  kind: AIErrorKind;
  constructor(kind: AIErrorKind, message: string) {
    super(message);
    this.name = "AIError";
    this.kind = kind;
  }
}

/** What checking a key against the provider found. */
export type KeyCheck =
  | {
      ok: true;
      /** Model ids the key can generate with, when the provider lists them. */
      available?: string[];
    }
  | { ok: false; error: AIError };

export interface AIProvider {
  id: ProviderId;
  label: string;
  /** Where the user gets a key — shown in Settings. */
  keyUrl: string;
  /** Offered models; the first is the default. */
  models: AIModel[];
  /**
   * Model ids this app used to offer, mapped to the listed model that replaces
   * each one, so a saved choice survives the provider retiring it.
   */
  retiredModels?: Record<string, string>;
  /**
   * Cheap round-trip that says whether the key works and, when it does, which
   * models it can use. Never throws: failures come back as AIError.
   */
  checkKey(key: string): Promise<KeyCheck>;
  /**
   * Stream assistant text as it arrives. Yields incremental chunks and returns
   * how the stream ended. Throws AIError("blocked") for a refused prompt or a
   * withheld answer, and an AbortError once `req.signal` aborts.
   */
  streamChat(req: AIRequest, key: string): AsyncGenerator<string, StreamFinish>;
}
