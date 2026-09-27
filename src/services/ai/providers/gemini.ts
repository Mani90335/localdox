import { AIError, type AIProvider, type AIRequest, type ChatMessage } from "../types";
import { readSSE } from "../sse";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

// Gemini splits the system prompt into systemInstruction and uses role "model"
// for the assistant. Convert the provider-agnostic ChatMessage[] accordingly.
function toGeminiBody(messages: ChatMessage[]) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  return {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
  };
}

export const geminiProvider: AIProvider = {
  id: "gemini",
  label: "Google Gemini",
  keyUrl: "https://aistudio.google.com/app/apikey",
  models: [
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash (fast)" },
    { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash-Lite" },
    { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  ],

  async validateKey(key: string): Promise<boolean> {
    try {
      const res = await fetch(`${BASE}/models?key=${encodeURIComponent(key)}`);
      return res.ok;
    } catch {
      return false;
    }
  },

  async *streamChat(req: AIRequest, key: string): AsyncIterable<string> {
    const url = `${BASE}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: req.signal,
      body: JSON.stringify({
        ...toGeminiBody(req.messages),
        generationConfig: { temperature: req.temperature ?? 0.5 },
      }),
    });

    if (!res.ok) {
      throw await toError(res);
    }

    for await (const data of readSSE(res, req.signal)) {
      try {
        const json = JSON.parse(data);
        const parts = json?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          for (const p of parts) {
            if (typeof p?.text === "string" && p.text) yield p.text;
          }
        }
      } catch {
        // Ignore partial fragments.
      }
    }
  },
};

async function toError(res: Response): Promise<AIError> {
  let detail = "";
  let status = "";
  try {
    const json = await res.json();
    detail = json?.error?.message ?? "";
    status = json?.error?.status ?? "";
  } catch {
    /* no JSON body */
  }
  const quota =
    res.status === 429 || /RESOURCE_EXHAUSTED|quota|exceeded/i.test(`${status} ${detail}`);
  const auth =
    res.status === 401 ||
    res.status === 403 ||
    /API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(`${status} ${detail}`);
  if (quota) return new AIError("quota", "Gemini: rate limit or quota exceeded.");
  if (auth) return new AIError("auth", "Gemini: invalid API key.");
  return new AIError(
    "other",
    detail ? `Gemini: ${detail}` : `Gemini request failed (${res.status}).`,
  );
}
