// Non-secret AI preferences (default provider + model). Kept in its own
// localStorage key so persistence.ts's Prefs shape stays untouched. No API keys
// are ever stored here — those go through keys.ts.

import type { ProviderId } from "./types";
import { PROVIDER_LIST, getProvider, providerForModel } from "./registry.ts";

export interface AIConfig {
  defaultProvider: ProviderId;
  defaultModel: string;
}

const CONFIG_KEY = "localdox:ai-config";

const DEFAULT_CONFIG: AIConfig = {
  defaultProvider: "openai",
  defaultModel: "gpt-4o-mini",
};

/**
 * Point a saved choice at a model the app still offers. A listed model keeps
 * its provider; a retired one becomes its named replacement; anything else
 * becomes its provider's default. The provider only changes when the saved one
 * no longer exists.
 */
export function normalizeAIConfig(saved: Partial<AIConfig>): AIConfig {
  const model = typeof saved.defaultModel === "string" ? saved.defaultModel : "";
  const owner = providerForModel(model);
  if (owner) return { defaultProvider: owner.id, defaultModel: model };
  const retiredFrom = PROVIDER_LIST.find((p) => p.retiredModels?.[model]);
  if (retiredFrom) {
    return { defaultProvider: retiredFrom.id, defaultModel: retiredFrom.retiredModels![model] };
  }
  const provider =
    typeof saved.defaultProvider === "string" ? getProvider(saved.defaultProvider) : undefined;
  if (provider) return { defaultProvider: provider.id, defaultModel: provider.models[0].id };
  return { ...DEFAULT_CONFIG };
}

export function loadAIConfig(): AIConfig {
  if (typeof localStorage === "undefined") return { ...DEFAULT_CONFIG };
  let saved: Partial<AIConfig> = {};
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") saved = parsed as Partial<AIConfig>;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  const config = normalizeAIConfig(saved);
  // Write a migrated choice back once, so every reader sees the same model.
  if (
    Object.keys(saved).length > 0 &&
    (config.defaultModel !== saved.defaultModel || config.defaultProvider !== saved.defaultProvider)
  ) {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch {
      /* storage unavailable — the migrated config still applies in memory */
    }
  }
  return config;
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
