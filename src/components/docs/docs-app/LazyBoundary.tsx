import { Component, Suspense, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { handleChunkError } from "@/lib/app/install-chunk-recovery";
import { reloadSafely } from "@/lib/app/safe-reload";
import { isChunkLoadError } from "@/lib/app/stale-chunk";

/**
 * A lazily loaded feature whose download failed stays contained here.
 *
 * Without it, a failed chunk reaches the root error screen, which unmounts the
 * whole app, and with it everything the reader hadn't saved yet. Only chunk
 * failures are caught; other errors carry on to the next boundary up.
 *
 * `React.lazy` remembers a failed import, so there is no in-place retry: the
 * way back is a reload, offered by `handleChunkError` (and by `fallback`).
 * `resetKey` clears the error when the reader moves on, since the next thing
 * they open may not need the missing chunk.
 */
class ChunkBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; resetKey?: unknown },
  { error: Error | null; key: unknown }
> {
  state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(
    props: { resetKey?: unknown },
    state: { error: Error | null; key: unknown },
  ) {
    return props.resetKey === state.key ? null : { error: null, key: props.resetKey };
  }

  componentDidCatch(error: Error) {
    if (isChunkLoadError(error)) handleChunkError(error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (!isChunkLoadError(error)) throw error;
    return this.props.fallback;
  }
}

export function LazyBoundary({
  children,
  loading = null,
  failed = null,
  resetKey,
}: {
  children: ReactNode;
  /** Shown while the chunk downloads. */
  loading?: ReactNode;
  /** Shown if it can't be downloaded. */
  failed?: ReactNode;
  resetKey?: unknown;
}) {
  return (
    <ChunkBoundary fallback={failed} resetKey={resetKey}>
      <Suspense fallback={loading}>{children}</Suspense>
    </ChunkBoundary>
  );
}

/** In-place notice for a main-area feature that didn't download. */
export function ChunkFailedNotice() {
  const [reloading, setReloading] = useState(false);
  return (
    <main className="flex min-w-0 flex-1 items-center justify-center px-6 py-16">
      <div role="alert" className="max-w-sm space-y-3 text-center">
        <p className="text-sm font-semibold text-foreground">This part of Localdox didn't load</p>
        <p className="text-sm text-muted-foreground">
          It may have been updated, or you may be offline. Your documents are safe on this device.
        </p>
        <Button
          size="sm"
          disabled={reloading}
          onClick={() => {
            setReloading(true);
            void reloadSafely().then((reloaded) => {
              if (!reloaded) setReloading(false);
            });
          }}
        >
          {reloading ? "Saving…" : "Reload"}
        </Button>
      </div>
    </main>
  );
}
