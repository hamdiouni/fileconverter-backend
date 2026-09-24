/**
 * Simple in-memory Redis mock for testing.
 * Supports: get, set, setex, del, quit
 */
export class InMemoryRedis {
  private store: Map<string, { value: string; expiresAt: number | null }> = new Map();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, { value, expiresAt: null });
    return 'OK';
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<'OK'> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existed = this.store.has(key);
    this.store.delete(key);
    return existed ? 1 : 0;
  }

  async quit(): Promise<'OK'> {
    return 'OK';
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  /** Reset all data (call between tests) */
  reset() {
    this.store.clear();
  }
}
