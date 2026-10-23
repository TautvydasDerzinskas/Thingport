// Plenty for one household's devices, searches and feeds; the oldest entries go first.
const CACHE_LIMIT = 500;

/** A small in-memory cache whose entries expire after `ttlMs`, for answers from outside services. */
export class TtlCache<T> {
  private entries = new Map<string, { at: number; value: T }>();
  constructor(private ttlMs: number) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || Date.now() - entry.at > this.ttlMs) return undefined;
    return entry.value;
  }
  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { at: Date.now(), value });
    if (this.entries.size > CACHE_LIMIT) this.entries.delete(this.entries.keys().next().value!);
  }
  clear(): void {
    this.entries.clear();
  }
}
