import { AIError, type AIProvider, type AIRequest, type StreamFinish } from "../types.ts";
import { readSSE } from "../sse.ts";

const BASE = "https://api.openai.com/v1";

export const openaiProvider: AIProvider = {
  id: "openai",
  label: "OpenAI",
  keyUrl: "https://platform.openai.com/api-keys",
  models: [
    { id: "gpt-4o-mini", label: "GPT-4o mini (fast, cheap)" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
  ],

  async validateKey(key: string): Promise<boolean> {
    try {
      const res = await fetch(`${BASE}/models`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async *streamChat(req: AIRequest, key: string): AsyncGenerator<string, StreamFinish> {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      signal: req.signal,
      body: JSON.stringify({
        model: req.model,
        stream: true,
        temperature: req.temperature ?? 0.5,
        messages: req.messages,
      }),
    });

    if (!res.ok) {
      throw await toError(res);
    }

    let sawText = false;
    let finishReason = "";
    let done = false;
    for await (const data of readSSE(res, req.signal)) {
      if (data === "[DONE]") {
        done = true;
        break;
      }
      let json: OpenAIChunk;
      try {
        json = JSON.parse(data);
      } catch {
        continue; // Ignore keep-alive / partial fragments.
      }
      if (json?.error) {
        throw new AIError("other", `OpenAI: ${json.error.message ?? "the request failed."}`);
      }
      const choice = json?.choices?.[0];
      const delta = choice?.delta?.content;
      if (typeof delta === "string" && delta) {
        sawText = true;
        yield delta;
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
    }

    if (finishReason === "content_filter") {
      throw new AIError("blocked", "OpenAI withheld the answer (content filter).");
    }
    if (!sawText) {
      throw new AIError(
        "other",
        finishReason === "length"
          ? "OpenAI reached its output limit before answering."
          : "OpenAI returned an empty answer.",
      );
    }
    if (finishReason === "length") return { reason: "length" };
    return { reason: done || finishReason === "stop" ? "stop" : "interrupted" };
  },
};

interface OpenAIChunk {
  error?: { message?: string };
  choices?: { delta?: { content?: unknown }; finish_reason?: string | null }[];
}

async function toError(res: Response): Promise<AIError> {
  let detail = "";
  let code = "";
  try {
    const json = await res.json();
    detail = json?.error?.message ?? "";
    code = json?.error?.code ?? json?.error?.type ?? "";
  } catch {
    /* no JSON body */
  }
  const quota =
    res.status === 429 || /quota|insufficient_quota|exceeded/i.test(`${code} ${detail}`);
  if (res.status === 401) return new AIError("auth", "OpenAI: invalid API key.");
  if (quota) return new AIError("quota", "OpenAI: rate limit or quota exceeded.");
  return new AIError(
    "other",
    detail ? `OpenAI: ${detail}` : `OpenAI request failed (${res.status}).`,
  );
}
