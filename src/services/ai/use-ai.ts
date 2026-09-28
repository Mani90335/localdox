// React binding for the AI layer. Owns config and exposes a single ask() that
// drives runAgent. Streaming state, cancellation and request ordering live in
// AskSession; components stay declarative.

import { useCallback, useEffect, useState } from "react";
import { runAgent, type AgentInput, type AgentResult } from "./agent";
import { AskSession, IDLE, type AskState } from "./ask-session";
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
  const [state, setState] = useState<AskState>(IDLE);
  const [session] = useState(() => new AskSession(setState));

  // Closing the panel unmounts it: stop spending the user's quota on an answer
  // nobody will see. Re-activating covers StrictMode's remount.
  useEffect(() => {
    session.activate();
    return session.dispose;
  }, [session]);

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

  const ask = useCallback(
    (args: AskArgs): Promise<AgentResult | null> =>
      session.ask((signal, onToken) => runAgent({ ...args, signal, onToken })),
    [session],
  );

  return {
    config,
    updateConfig,
    configured,
    refreshConfigured,
    status: state.status,
    text: state.text,
    isStreaming: state.status === "streaming",
    error: state.error,
    scopeLabel: state.scopeLabel,
    notice: state.notice,
    ask,
    abort: session.stop,
    reset: session.reset,
  };
}
