export interface BoundedPromiseCacheOptions<K, V> {
  maxEntries: number;
  /** Upper bound on the summed `weigh()` of resolved entries. */
  maxWeight?: number;
  weigh?: (value: V) => number;
  /** Called with each evicted entry's value, once it has resolved. */
  onEvict?: (value: V, key: K) => void;
}

/**
 * A least-recently-used cache of promises, bounded by entry count and,
 * optionally, by a weight measured once each value resolves.
 *
 * The PDF reader's page-proxy and text-content caches used to be plain Maps
 * that lived as long as the document: every page ever viewed, thumbnailed or
 * searched stayed resident. A rejected promise also stayed cached, so one
 * transient failure made that page fail forever. Here a rejection evicts its
 * own entry (only if it hasn't been replaced since), and `onEvict` lets the
 * owner release resources held by the evicted value.
 *
 * The diagram caches use it too, weighted by bytes: Mermaid's SVG strings
 * (mermaid-render-cache.ts) and the GPU engine's scenes (engine/engine.ts).
 */
export class BoundedPromiseCache<K, V> {
  private readonly entries = new Map<K, { promise: Promise<V>; weight: number }>();
  private totalWeight = 0;

  private readonly options: BoundedPromiseCacheOptions<K, V>;

  constructor(options: BoundedPromiseCacheOptions<K, V>) {
    this.options = options;
  }

  get size(): number {
    return this.entries.size;
  }

  get weight(): number {
    return this.totalWeight;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  get(key: K, create: (key: K) => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (hit) {
      // Map iteration order is insertion order: re-inserting marks it newest.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit.promise;
    }

    const promise = create(key);
    const entry = { promise, weight: 0 };
    this.entries.set(key, entry);
    promise.then(
      (value) => {
        if (this.entries.get(key) !== entry) return;
        entry.weight = this.options.weigh?.(value) ?? 0;
        this.totalWeight += entry.weight;
        this.trim(key);
      },
      () => {
        if (this.entries.get(key) !== entry) return;
        this.entries.delete(key);
        this.totalWeight -= entry.weight;
      },
    );
    this.trim(key);
    return promise;
  }

  clear(): void {
    const evicted = [...this.entries];
    this.entries.clear();
    this.totalWeight = 0;
    for (const [key, entry] of evicted) this.release(key, entry.promise);
  }

  /** Drops oldest entries until within bounds, never the one just touched. */
  private trim(keep: K): void {
    const { maxEntries, maxWeight = Infinity } = this.options;
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= maxEntries && this.totalWeight <= maxWeight) return;
      if (key === keep) continue;
      this.entries.delete(key);
      this.totalWeight -= entry.weight;
      this.release(key, entry.promise);
    }
  }

  private release(key: K, promise: Promise<V>): void {
    const onEvict = this.options.onEvict;
    if (!onEvict) return;
    promise.then(
      (value) => onEvict(value, key),
      () => {},
    );
  }
}
