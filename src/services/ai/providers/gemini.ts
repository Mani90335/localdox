import {
  AIError,
  type AIProvider,
  type AIRequest,
  type ChatMessage,
  type StreamFinish,
} from "../types.ts";
import { readSSE } from "../sse.ts";

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

  async *streamChat(req: AIRequest, key: string): AsyncGenerator<string, StreamFinish> {
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

    let sawText = false;
    let finishReason = "";
    for await (const data of readSSE(res, req.signal)) {
      let json: GeminiChunk;
      try {
        json = JSON.parse(data);
      } catch {
        continue; // Ignore partial fragments.
      }
      if (json?.error) {
        throw new AIError("other", `Gemini: ${json.error.message ?? "the request failed."}`);
      }
      const blockReason = json?.promptFeedback?.blockReason;
      if (blockReason) {
        throw new AIError("blocked", `Gemini declined this request (${describe(blockReason)}).`);
      }
      const candidate = json?.candidates?.[0];
      const parts = candidate?.content?.parts;
      if (Array.isArray(parts)) {
        for (const p of parts) {
          // Thinking models may send their reasoning as thought parts.
          if (typeof p?.text === "string" && p.text && !p.thought) {
            sawText = true;
            yield p.text;
          }
        }
      }
      if (candidate?.finishReason) finishReason = candidate.finishReason;
    }
    return finish(finishReason, sawText);
  },
};

interface GeminiChunk {
  error?: { message?: string };
  promptFeedback?: { blockReason?: string };
  candidates?: {
    content?: { parts?: { text?: unknown; thought?: boolean }[] };
    finishReason?: string;
  }[];
}

// Finish reasons meaning the answer was withheld or cut off by a content
// filter. https://ai.google.dev/api/generate-content#FinishReason
const WITHHELD = new Set([
  "SAFETY",
  "RECITATION",
  "LANGUAGE",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "IMAGE_RECITATION",
  "ESCALATION",
  "PUP_LIMITED_DISABLED",
]);

function finish(reason: string, sawText: boolean): StreamFinish {
  if (WITHHELD.has(reason)) {
    throw new AIError("blocked", `Gemini withheld the answer (${describe(reason)}).`);
  }
  if (reason === "MAX_TOKENS") {
    if (!sawText) throw new AIError("other", "Gemini reached its output limit before answering.");
    return { reason: "length" };
  }
  if (!sawText) {
    throw new AIError(
      "other",
      reason && reason !== "STOP"
        ? `Gemini stopped without an answer (${describe(reason)}).`
        : "Gemini returned an empty answer.",
    );
  }
  // STOP is the one normal ending. Anything else (a malformed response, an
  // unexpected tool call, a dropped connection) leaves partial text.
  return { reason: reason === "STOP" ? "stop" : "interrupted" };
}

// "PROHIBITED_CONTENT" -> "prohibited content"
function describe(reason: string): string {
  return reason.toLowerCase().replace(/_/g, " ");
}

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
