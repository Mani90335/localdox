import { AIError, type AIProvider, type AIRequest } from "../types";
import { readSSE } from "../sse";

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

  async *streamChat(req: AIRequest, key: string): AsyncIterable<string> {
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

    for await (const data of readSSE(res, req.signal)) {
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data);
        const delta = json?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) yield delta;
      } catch {
        // Ignore keep-alive / partial fragments.
      }
    }
  },
};

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
