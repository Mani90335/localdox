// React binding for the AI layer. Owns streaming state, abort, and config, and
// exposes a single ask() that drives runAgent. Components stay declarative.

import { useCallback, useEffect, useRef, useState } from "react";
import { runAgent, type AgentInput, type AgentResult } from "./agent";
import { loadAIConfig, saveAIConfig, type AIConfig } from "./config";
import { listConfigured } from "./keys";

export interface AskArgs {
  actionId?: string;
  freeform?: string;
  userInput?: string;
  rawContext: AgentInput["rawContext"];
  contextPreference?: AgentInput["contextPreference"];
}

export function useAI() {
  const [config, setConfig] = useState<AIConfig>(() => loadAIConfig());
  const [configured, setConfigured] = useState(false);
  const [text, setText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeLabel, setScopeLabel] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refreshConfigured = useCallback(async () => {
    try {
      const ids = await listConfigured();
      setConfigured(ids.length > 0);
    } catch {
      setConfigured(false);
    }
  }, []);

  useEffect(() => {
    void refreshConfigured();
  }, [refreshConfigured]);

  const updateConfig = useCallback((patch: Partial<AIConfig>) => {
    setConfig(saveAIConfig(patch));
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const reset = useCallback(() => {
    abort();
    setText("");
    setError(null);
    setScopeLabel(null);
  }, [abort]);

  const ask = useCallback(async (args: AskArgs): Promise<AgentResult | null> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setText("");
    setError(null);
    setScopeLabel(null);
    setIsStreaming(true);
    try {
      const result = await runAgent({
        ...args,
        signal: controller.signal,
        onToken: (chunk) => setText((prev) => prev + chunk),
      });
      setScopeLabel(result.scopeLabel);
      return result;
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return null;
      setError((err as Error)?.message ?? "Something went wrong.");
      return null;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsStreaming(false);
    }
  }, []);

  return {
    config,
    updateConfig,
    configured,
    refreshConfigured,
    text,
    isStreaming,
    error,
    scopeLabel,
    ask,
    abort,
    reset,
  };
}
