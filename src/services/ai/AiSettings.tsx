import { useCallback, useEffect, useState } from "react";
import { Check, Eye, EyeOff, Loader2, ShieldAlert, Trash2, ExternalLink } from "lucide-react";
import { PROVIDER_LIST, getProvider } from "./registry";
import { getKey, setKey, removeKey, storageMode, listConfigured } from "./keys";
import { loadAIConfig, saveAIConfig, type AIConfig } from "./config";
import { Section, Group, IconButton } from "@/components/docs/pages/settings/primitives";
import type { ProviderId } from "./types";

// Self-contained AI settings: reads/writes keys.ts + config.ts directly so the
// Settings page needs no new prop plumbing.
export function AiSettings() {
  const [config, setConfig] = useState<AIConfig>(() => loadAIConfig());
  const [connected, setConnected] = useState<ProviderId[]>([]);
  const mode = storageMode();

  // Keep the default model pointed at a provider the user actually has a key
  // for. Any single key is enough — this makes a newly-added key immediately
  // usable without touching the model dropdown.
  const reconcile = useCallback(async () => {
    const ids = await listConfigured();
    setConnected(ids);
    setConfig((prev) => {
      const currentProvider = getProvider(prev.defaultProvider);
      const currentProviderKeyed = ids.includes(prev.defaultProvider);
      const modelBelongs = currentProvider?.models.some((m) => m.id === prev.defaultModel);
      if (currentProviderKeyed && modelBelongs) return prev;
      // Point the default at the first connected provider's first model.
      const target = ids.length ? getProvider(ids[0]) : undefined;
      if (!target) return prev;
      return saveAIConfig({ defaultProvider: target.id, defaultModel: target.models[0].id });
    });
  }, []);

  useEffect(() => {
    void reconcile();
  }, [reconcile]);

  const patchConfig = (patch: Partial<AIConfig>) => setConfig(saveAIConfig(patch));

  return (
    <div className="space-y-10">
      {/* The encrypted-storage case is the norm, so it stays silent. Only the
          degraded case earns a banner. */}
      {mode !== "encrypted" && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Encrypted storage unavailable.</span> Keys
            are kept obfuscated in localStorage instead. Avoid entering keys on a shared device.
          </p>
        </div>
      )}

      <Section
        title="API keys"
        description="Localdox provides no AI credits. Requests go straight from your browser to the provider using your key. One key is enough; a second becomes an automatic fallback."
      >
        <Group>
          {PROVIDER_LIST.map((provider) => (
            <ProviderKeyRow key={provider.id} provider={provider} onChanged={reconcile} />
          ))}
        </Group>
        {mode === "encrypted" && (
          <p className="px-1 text-xs text-muted-foreground">
            Keys are encrypted on this device with WebCrypto (AES-GCM) and decrypted only in memory.
          </p>
        )}
      </Section>

      <DefaultModel config={config} connected={connected} onChange={patchConfig} />
    </div>
  );
}

function ProviderKeyRow({
  provider,
  onChanged,
}: {
  provider: (typeof PROVIDER_LIST)[number];
  onChanged: () => void | Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [status, setStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");

  useEffect(() => {
    let alive = true;
    void getKey(provider.id).then((k) => {
      if (alive && k) {
        setSaved(true);
        setValue(k);
      }
    });
    return () => {
      alive = false;
    };
  }, [provider.id]);

  const onSave = async () => {
    setStatus("checking");
    const ok = await provider.validateKey(value.trim());
    if (ok) {
      await setKey(provider.id, value.trim());
      setSaved(true);
      setStatus("valid");
      await onChanged();
    } else {
      setStatus("invalid");
    }
  };

  const onRemove = async () => {
    await removeKey(provider.id);
    setSaved(false);
    setValue("");
    setStatus("idle");
    await onChanged();
  };

  const dirty = value.trim().length > 0 && status !== "valid";

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{provider.label}</span>
          {saved && (
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          )}
        </div>
        <a
          href={provider.keyUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground coarse:min-h-11"
        >
          Get a key <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            type={reveal ? "text" : "password"}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setStatus("idle");
            }}
            placeholder={saved ? "Key saved" : "Paste API key"}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-border bg-background py-1.5 pl-2.5 pr-8 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 coarse:min-h-11 coarse:pr-12"
          />
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="absolute right-1.5 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:text-foreground coarse:size-11"
            aria-label={reveal ? "Hide key" : "Show key"}
          >
            {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
        {/* Save only appears once there's something to save — a saved, untouched
            row shows just the field and its delete control. */}
        {dirty && (
          <button
            onClick={onSave}
            disabled={status === "checking"}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50 coarse:min-h-11 coarse:px-4"
          >
            {status === "checking" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saved ? "Update" : "Save"}
          </button>
        )}
        {saved && (
          <IconButton onClick={onRemove} label={`Remove ${provider.label} key`} danger>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        )}
      </div>

      {status === "invalid" && (
        <p className="mt-1.5 text-xs text-destructive">
          That key didn&apos;t validate. Check it and try again.
        </p>
      )}
    </div>
  );
}

function DefaultModel({
  config,
  connected,
  onChange,
}: {
  config: AIConfig;
  connected: ProviderId[];
  onChange: (patch: Partial<AIConfig>) => void;
}) {
  const allOptions = PROVIDER_LIST.flatMap((provider) =>
    provider.models.map((model) => ({ provider, model })),
  );
  const anyConnected = connected.length > 0;

  return (
    <Section
      title="Default model"
      description="Used first for every Ask AI request. Falls back to another connected provider if its key runs out."
    >
      <Group>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="shrink-0 text-sm text-foreground">Model</span>
          <select
            value={config.defaultModel}
            onChange={(e) => {
              const model = e.target.value;
              const provider = allOptions.find((o) => o.model.id === model)?.provider.id as
                ProviderId | undefined;
              onChange({ defaultModel: model, ...(provider ? { defaultProvider: provider } : {}) });
            }}
            className="min-w-0 max-w-[60%] rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 coarse:min-h-11"
          >
            {PROVIDER_LIST.map((provider) => {
              const isConnected = connected.includes(provider.id);
              return (
                <optgroup
                  key={provider.id}
                  label={`${provider.label}${isConnected ? " — connected" : " — no key"}`}
                >
                  {provider.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                      {isConnected ? "" : " (add key)"}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </div>
      </Group>
      {!anyConnected && (
        <p className="px-1 text-xs text-amber-600 dark:text-amber-400">
          No key connected yet — add one above to start using Ask AI.
        </p>
      )}
    </Section>
  );
}
