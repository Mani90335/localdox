// Non-secret AI preferences (default provider + model). Kept in its own
// localStorage key so persistence.ts's Prefs shape stays untouched. No API keys
// are ever stored here — those go through keys.ts.

import type { ProviderId } from "./types";

export interface AIConfig {
  defaultProvider: ProviderId;
  defaultModel: string;
}

const CONFIG_KEY = "localdox:ai-config";

const DEFAULT_CONFIG: AIConfig = {
  defaultProvider: "openai",
  defaultModel: "gpt-4o-mini",
};

export function loadAIConfig(): AIConfig {
  if (typeof localStorage === "undefined") return { ...DEFAULT_CONFIG };
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveAIConfig(patch: Partial<AIConfig>): AIConfig {
  const next = { ...loadAIConfig(), ...patch };
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — config stays in memory */
    }
  }
  return next;
}
