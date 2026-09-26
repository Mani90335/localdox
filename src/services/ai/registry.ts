// Provider registry — the single edit point for adding a new AI provider.
// Implement AIProvider, import it here, and add it to PROVIDERS.

import type { AIProvider, ProviderId, AIModel } from "./types";
import { openaiProvider } from "./providers/openai";
import { geminiProvider } from "./providers/gemini";

export const PROVIDERS: Record<string, AIProvider> = {
  [openaiProvider.id]: openaiProvider,
  [geminiProvider.id]: geminiProvider,
};

export const PROVIDER_LIST: AIProvider[] = [openaiProvider, geminiProvider];

export function getProvider(id: ProviderId): AIProvider | undefined {
  return PROVIDERS[id];
}

/** Which provider owns a given model id — used to resolve config → provider. */
export function providerForModel(modelId: string): AIProvider | undefined {
  return PROVIDER_LIST.find((p) => p.models.some((m) => m.id === modelId));
}

export function allModels(): { provider: AIProvider; model: AIModel }[] {
  return PROVIDER_LIST.flatMap((provider) => provider.models.map((model) => ({ provider, model })));
}
