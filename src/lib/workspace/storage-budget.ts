import type { FileData } from "./binary.ts";
// The documents limit (storage-limits.ts), enforced. Every import path asks
// here before it writes: the bytes every workspace already holds, plus room
// held for imports this tab has started but not yet written, plus the new
// content, must fit under the cap.
//
// Reservations are per tab. Two tabs importing at the same moment can each
// pass; the browser's own quota (QuotaExceededError) is the backstop there.

import { persistence } from "./persistence.ts";
import { StorageLimitError, getMaxStorageBytes, storedBytes } from "./storage-limits.ts";

type Stored = { content: string; data?: FileData };

/**
 * The open workspace as this tab holds it, unsaved edits and all. It stands
 * in for that workspace's saved total, and is read after the saved totals so
 * it is never older than them.
 */
export type OpenWorkspace = () => { id: string | null; files: readonly Stored[] };

/** Bytes every workspace holds, with `open` counted from memory. */
export async function measureStoredBytes(open?: OpenWorkspace): Promise<number> {
  const totals = await persistence.storedBytesByWorkspace();
  const current = open?.();
  if (current?.id) totals.delete(current.id);
  let used = current ? storedBytes(current.files) : 0;
  for (const bytes of totals.values()) used += bytes;
  return used;
}

interface Claim {
  bytes: number;
}

const held = new Set<Claim>();
// Bumped whenever a claim ends. Its bytes have just moved from "held" into
// storage or the open workspace, so a measurement that straddled the move may
// have counted them in neither place and is taken again.
let released = 0;

export interface StorageReservation {
  /**
   * Swap the estimate for the real size once the import is parsed. Growing
   * re-checks the cap and throws StorageLimitError (releasing the claim).
   */
  resize(bytes: number): Promise<void>;
  /** The bytes are now stored, or abandoned. Safe to call more than once. */
  release(): void;
}

async function claim(entry: Claim, bytes: number, open?: OpenWorkspace) {
  const cap = await getMaxStorageBytes();
  if (cap !== null && bytes > 0) {
    let used = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const seen = released;
      used = await measureStoredBytes(open);
      if (seen === released) break;
    }
    for (const other of held) if (other !== entry) used += other.bytes;
    if (used + bytes > cap) throw new StorageLimitError(bytes, used, cap);
  }
  entry.bytes = bytes;
  held.add(entry);
}

/**
 * Hold `bytes` of the cap for an import about to be written. Throws
 * StorageLimitError when it doesn't fit. Release once the content is in
 * storage or in the open workspace's files, whichever is counted first.
 */
export async function reserveStorage(
  bytes: number,
  open?: OpenWorkspace,
): Promise<StorageReservation> {
  const entry: Claim = { bytes: 0 };
  let active = true;
  const release = () => {
    if (!active) return;
    active = false;
    held.delete(entry);
    released++;
  };
  await claim(entry, bytes, open);
  return {
    async resize(next) {
      if (!active) throw new Error("Storage reservation already released");
      if (next <= entry.bytes) {
        entry.bytes = next;
        return;
      }
      try {
        await claim(entry, next, open);
      } catch (error) {
        release();
        throw error;
      }
    },
    release,
  };
}
