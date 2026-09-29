import {
  AIError,
  type AIModel,
  type AIProvider,
  type AIRequest,
  type ChatMessage,
  type KeyCheck,
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

// Checked against Google's model and deprecation pages (updated 2026-09-24).
// Stable models first; the one Pro text model is still a preview, which Google
// may retire at two weeks' notice, so Settings also checks it against the key.
// https://ai.google.dev/gemini-api/docs/models
// https://ai.google.dev/gemini-api/docs/deprecations
const MODELS: AIModel[] = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)" },
];

export const geminiProvider: AIProvider = {
  id: "gemini",
  label: "Google Gemini",
  keyUrl: "https://aistudio.google.com/app/apikey",
  models: MODELS,
  // Every id earlier versions offered. 2.0 Flash and Flash-Lite shut down on
  // 2026-06-01 and 1.5 is no longer listed at all. Each maps to the listed
  // model in the same line (Pro to Pro, Lite to Lite).
  retiredModels: {
    "gemini-2.0-flash": "gemini-3.8-flash",
    "gemini-2.0-flash-lite": "gemini-3.5-flash-lite",
    "gemini-1.5-flash": "gemini-3.8-flash",
    "gemini-1.5-pro": "gemini-3.1-pro-preview",
  },

  async checkKey(key: string): Promise<KeyCheck> {
    const available: string[] = [];
    let pageToken = "";
    // Bounded: a misbehaving nextPageToken can't loop forever. One page of
    // 1,000 covers today's list many times over.
    for (let page = 0; page < 5; page++) {
      const query = `pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
      let res: Response;
      try {
        res = await fetch(`${BASE}/models?${query}`, { headers: { "x-goog-api-key": key } });
      } catch {
        return {
          ok: false,
          error: new AIError("network", "Couldn't reach Google. Check your connection."),
        };
      }
      if (!res.ok) return { ok: false, error: await toError(res) };
      let json: GeminiModelList;
      try {
        json = await res.json();
      } catch {
        return { ok: false, error: new AIError("other", "Gemini sent an unreadable model list.") };
      }
      for (const m of json?.models ?? []) {
        if (
          typeof m?.name === "string" &&
          m.supportedGenerationMethods?.includes("generateContent")
        ) {
          available.push(m.name.replace(/^models\//, ""));
        }
      }
      pageToken = typeof json?.nextPageToken === "string" ? json.nextPageToken : "";
      if (!pageToken) return { ok: true, available };
    }
    // The key works, but the list never ended, so it can't rule a model out.
    return { ok: true };
  },

  async *streamChat(req: AIRequest, key: string): AsyncGenerator<string, StreamFinish> {
    // The key goes in a header, not the URL, so it stays out of logs,
    // history and error reports that record URLs.
    const url = `${BASE}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: req.signal,
      body: JSON.stringify({
        ...toGeminiBody(req.messages),
        // Gemini 3 models are tuned for their default temperature (1.0);
        // Google warns lower values can make them loop. Send one only when
        // the caller asks.
        ...(req.temperature !== undefined
          ? { generationConfig: { temperature: req.temperature } }
          : {}),
      }),
    });

    if (!res.ok) {
      throw await toError(res, req.model);
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

interface GeminiModelList {
  models?: { name?: unknown; supportedGenerationMethods?: string[] }[];
  nextPageToken?: unknown;
}

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

async function toError(res: Response, model?: string): Promise<AIError> {
  let detail = "";
  let status = "";
  try {
    const json = await res.json();
    detail = json?.error?.message ?? "";
    status = json?.error?.status ?? "";
  } catch {
    /* no JSON body */
  }
  const text = `${status} ${detail}`;
  // 402: prepaid credit is used up.
  const quota =
    res.status === 429 || res.status === 402 || /RESOURCE_EXHAUSTED|quota|exceeded/i.test(text);
  if (quota) return new AIError("quota", "Gemini: rate limit or quota exceeded.");
  // An unknown key is a 400 INVALID_ARGUMENT whose reason is API_KEY_INVALID.
  if (res.status === 401 || /API_KEY_INVALID|API key not valid|API key expired/i.test(text)) {
    return new AIError("auth", "Gemini: invalid API key.");
  }
  // A real key that may not call this API or resource.
  if (res.status === 403 || /PERMISSION_DENIED/i.test(status)) {
    return new AIError(
      "auth",
      detail ? `Gemini refused this API key: ${detail}` : "Gemini refused this API key.",
    );
  }
  // Only a generation request names a model, so only it can be a model error.
  if (model && (res.status === 404 || status === "NOT_FOUND")) {
    const label = MODELS.find((m) => m.id === model)?.label ?? model;
    return new AIError(
      "model",
      `Gemini can't use ${label}: Google has retired it or doesn't offer it to this key. Choose another model in Settings → Ask AI.`,
    );
  }
  return new AIError(
    "other",
    detail ? `Gemini: ${detail}` : `Gemini request failed (${res.status}).`,
  );
}
