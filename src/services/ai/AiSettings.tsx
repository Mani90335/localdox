import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Eye, EyeOff, Loader2, ShieldAlert, Trash2, ExternalLink } from "lucide-react";
import { PROVIDER_LIST, getProvider } from "./registry";
import { getKey, setKey, removeKey, storageMode, listConfigured } from "./keys";
import { loadAIConfig, saveAIConfig, type AIConfig } from "./config";
import { Section, Group, IconButton } from "@/components/docs/pages/settings/primitives";
import type { AIProvider, KeyCheck, ProviderId } from "./types";

/** Model ids each saved key can use; a provider is absent while unknown. */
type Availability = Partial<Record<ProviderId, string[]>>;

// What each key's model list said, for this session. Filled when a key is
// saved or Settings opens, and dropped when the key changes.
const checkedKeys = new Map<ProviderId, string[] | null>();

function remember(id: ProviderId, check: KeyCheck) {
  checkedKeys.set(id, check.ok && check.available ? check.available : null);
}

async function availabilityFor(ids: ProviderId[]): Promise<Availability> {
  await Promise.all(
    ids
      .filter((id) => !checkedKeys.has(id))
      .map(async (id) => {
        const provider = getProvider(id);
        const key = provider && (await getKey(id));
        // Offline or failing: leave it unknown and ask again next time.
        if (key) {
          const check = await provider.checkKey(key);
          if (check.ok) remember(id, check);
        }
      }),
  );
  const out: Availability = {};
  for (const id of ids) {
    const available = checkedKeys.get(id);
    if (available) out[id] = available;
  }
  return out;
}

const usable = (provider: AIProvider, availability: Availability) =>
  provider.models.filter((m) => availability[provider.id]?.includes(m.id) ?? true);

/**
 * The default to use, given which providers have keys and which models those
 * keys can use. Keeps the current choice when it works, then prefers another
 * model from the same provider, then the first connected provider's.
 */
function chooseDefault(
  prev: AIConfig,
  connected: ProviderId[],
  availability: Availability,
): AIConfig {
  const current = connected.includes(prev.defaultProvider)
    ? getProvider(prev.defaultProvider)
    : undefined;
  if (current && usable(current, availability).some((m) => m.id === prev.defaultModel)) {
    return prev;
  }
  const providers = [current, ...connected.map(getProvider)].filter((p): p is AIProvider => !!p);
  for (const provider of providers) {
    const model = usable(provider, availability)[0];
    if (model) return { defaultProvider: provider.id, defaultModel: model.id };
  }
  // No connected key can use any listed model (or none is connected): keep a
  // connected provider's default so the request's own error explains why.
  if (current) return prev;
  const first = connected.length ? getProvider(connected[0]) : undefined;
  return first ? { defaultProvider: first.id, defaultModel: first.models[0].id } : prev;
}

function modelLabel(id: string): string {
  for (const provider of PROVIDER_LIST) {
    const model = provider.models.find((m) => m.id === id);
    if (model) return model.label;
  }
  return id;
}

// Self-contained AI settings: reads/writes keys.ts + config.ts directly so the
// Settings page needs no new prop plumbing.
export function AiSettings() {
  const [config, setConfig] = useState<AIConfig>(() => loadAIConfig());
  const [connected, setConnected] = useState<ProviderId[]>([]);
  const [availability, setAvailability] = useState<Availability>({});
  // Why the default moved, when it moved because a key can't use a model.
  const [notice, setNotice] = useState<string | null>(null);
  const mode = storageMode();

  // Keep the default model pointed at a provider the user actually has a key
  // for, and at a model that key can use. Any single key is enough — this makes
  // a newly-added key immediately usable without touching the model dropdown.
  // A key saved or removed mid-check starts a newer pass; older ones stop.
  const pass = useRef(0);
  const reconcile = useCallback(async () => {
    const mine = ++pass.current;
    const ids = await listConfigured();
    if (mine !== pass.current) return;
    setConnected(ids);
    const apply = (known: Availability) => {
      const prev = loadAIConfig();
      const next = chooseDefault(prev, ids, known);
      if (
        next.defaultModel === prev.defaultModel &&
        next.defaultProvider === prev.defaultProvider
      ) {
        setConfig(prev);
        return;
      }
      const keyed = getProvider(prev.defaultProvider);
      if (keyed && ids.includes(keyed.id) && known[keyed.id]) {
        setNotice(
          `Your ${keyed.label} key can't use ${modelLabel(prev.defaultModel)}, so Ask AI now uses ${modelLabel(next.defaultModel)}.`,
        );
      }
      setConfig(saveAIConfig(next));
    };
    // Settle the provider now; refine once the keys' model lists arrive.
    apply({});
    const known = await availabilityFor(ids);
    if (mine !== pass.current) return;
    setAvailability(known);
    apply(known);
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
            <ProviderKeyRow
              key={provider.id}
              provider={provider}
              onChanged={(check) => {
                if (check) remember(provider.id, check);
                else checkedKeys.delete(provider.id);
                return reconcile();
              }}
            />
          ))}
        </Group>
        {mode === "encrypted" && (
          <p className="px-1 text-xs text-muted-foreground">
            Keys are encrypted on this device with WebCrypto (AES-GCM) and decrypted only in memory.
          </p>
        )}
      </Section>

      <DefaultModel
        config={config}
        connected={connected}
        availability={availability}
        notice={notice}
        onChange={(patch) => {
          setNotice(null);
          patchConfig(patch);
        }}
      />
    </div>
  );
}

function ProviderKeyRow({
  provider,
  onChanged,
}: {
  provider: (typeof PROVIDER_LIST)[number];
  /** A saved key passes its check; a removed key passes nothing. */
  onChanged: (check?: KeyCheck) => void | Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [status, setStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  // Why the last check failed: a bad key, a quota, or no connection.
  const [checkError, setCheckError] = useState<string | null>(null);
  // Storage failures stay on screen until the next attempt; a key is only
  // shown as saved once its write has committed.
  const [storageError, setStorageError] = useState<string | null>(null);

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
    setStorageError(null);
    const check = await provider.checkKey(value.trim());
    if (!check.ok) {
      setStatus("invalid");
      setCheckError(
        check.error.kind === "auth"
          ? "That key didn't validate. Check it and try again."
          : check.error.message,
      );
      return;
    }
    try {
      await setKey(provider.id, value.trim());
    } catch {
      setStatus("idle");
      setStorageError("Couldn't save the key on this device. Try again.");
      return;
    }
    setSaved(true);
    setStatus("valid");
    await onChanged(check);
  };

  const onRemove = async () => {
    setStorageError(null);
    try {
      await removeKey(provider.id);
    } catch {
      setStorageError("Couldn't remove the key from this device. Try again.");
      return;
    }
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
              setCheckError(null);
              setStorageError(null);
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

      {status === "invalid" && checkError && (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {checkError}
        </p>
      )}
      {storageError && (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {storageError}
        </p>
      )}
    </div>
  );
}

function DefaultModel({
  config,
  connected,
  availability,
  notice,
  onChange,
}: {
  config: AIConfig;
  connected: ProviderId[];
  availability: Availability;
  notice: string | null;
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
                  {provider.models.map((model) => {
                    // Only a connected key's own model list can rule a model out.
                    const unavailable =
                      isConnected && !usable(provider, availability).includes(model);
                    return (
                      <option key={model.id} value={model.id} disabled={unavailable}>
                        {model.label}
                        {!isConnected
                          ? " (add key)"
                          : unavailable
                            ? " (not available to your key)"
                            : ""}
                      </option>
                    );
                  })}
                </optgroup>
              );
            })}
          </select>
        </div>
      </Group>
      {notice && (
        <p role="status" className="px-1 text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      {!anyConnected && (
        <p className="px-1 text-xs text-amber-600 dark:text-amber-400">
          No key connected yet — add one above to start using Ask AI.
        </p>
      )}
    </Section>
  );
}
