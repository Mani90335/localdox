// API-key management. Keys are encrypted at rest (crypto-store) when possible,
// otherwise obfuscated in localStorage with a visible "less secure" warning.
// Decrypted values live only in the in-memory cache for the session and are
// never passed to console/logging.

import type { ProviderId } from "./types";
import {
  encryptedStorageAvailable,
  encryptSecret,
  decryptSecret,
  deleteSecret,
  listSecretIds,
} from "./crypto-store";

export type StorageMode = "encrypted" | "insecure-fallback";

const LS_PREFIX = "localdox:ai-key:";
const secretId = (provider: ProviderId) => `key:${provider}`;

// Session cache of decrypted keys. Cleared on reload — never persisted plaintext.
const cache = new Map<ProviderId, string>();

// Obfuscation for the localStorage fallback. NOT encryption — just keeps keys
// from sitting in plaintext where a casual glance would read them. The UI warns
// the user when this path is active.
function scramble(text: string): string {
  const salted = text
    .split("")
    .map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ ((i % 7) + 1)))
    .join("");
  return btoa(unescape(encodeURIComponent(salted)));
}
function unscramble(encoded: string): string {
  const salted = decodeURIComponent(escape(atob(encoded)));
  return salted
    .split("")
    .map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ ((i % 7) + 1)))
    .join("");
}

export function storageMode(): StorageMode {
  return encryptedStorageAvailable() ? "encrypted" : "insecure-fallback";
}

export async function setKey(provider: ProviderId, key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) return removeKey(provider);
  cache.set(provider, trimmed);
  if (storageMode() === "encrypted") {
    await encryptSecret(secretId(provider), trimmed);
  } else if (typeof localStorage !== "undefined") {
    localStorage.setItem(LS_PREFIX + provider, scramble(trimmed));
  }
}

export async function getKey(provider: ProviderId): Promise<string | null> {
  const cached = cache.get(provider);
  if (cached) return cached;
  if (storageMode() === "encrypted") {
    try {
      const value = await decryptSecret(secretId(provider));
      if (value) cache.set(provider, value);
      return value;
    } catch {
      return null;
    }
  }
  if (typeof localStorage !== "undefined") {
    const raw = localStorage.getItem(LS_PREFIX + provider);
    if (!raw) return null;
    try {
      const value = unscramble(raw);
      cache.set(provider, value);
      return value;
    } catch {
      return null;
    }
  }
  return null;
}

export async function removeKey(provider: ProviderId): Promise<void> {
  cache.delete(provider);
  if (storageMode() === "encrypted") {
    await deleteSecret(secretId(provider));
  } else if (typeof localStorage !== "undefined") {
    localStorage.removeItem(LS_PREFIX + provider);
  }
}

/** Provider ids that currently have a stored key. */
export async function listConfigured(): Promise<ProviderId[]> {
  if (storageMode() === "encrypted") {
    const ids = await listSecretIds();
    return ids
      .filter((id) => id.startsWith("key:"))
      .map((id) => id.slice("key:".length) as ProviderId);
  }
  if (typeof localStorage !== "undefined") {
    const out: ProviderId[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LS_PREFIX)) out.push(k.slice(LS_PREFIX.length) as ProviderId);
    }
    return out;
  }
  return [];
}

export async function hasKey(provider: ProviderId): Promise<boolean> {
  return (await getKey(provider)) != null;
}
