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
// provider's key (quota/auth) or surface the error as-is (the rest). "blocked"
// means the provider refused the prompt or withheld the answer.
export type AIErrorKind = "auth" | "quota" | "network" | "blocked" | "other";

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

export interface AIProvider {
  id: ProviderId;
  label: string;
  /** Where the user gets a key — shown in Settings. */
  keyUrl: string;
  models: AIModel[];
  /** Cheap round-trip that resolves true when the key is usable. */
  validateKey(key: string): Promise<boolean>;
  /**
   * Stream assistant text as it arrives. Yields incremental chunks and returns
   * how the stream ended. Throws AIError("blocked") for a refused prompt or a
   * withheld answer, and an AbortError once `req.signal` aborts.
   */
  streamChat(req: AIRequest, key: string): AsyncGenerator<string, StreamFinish>;
}
