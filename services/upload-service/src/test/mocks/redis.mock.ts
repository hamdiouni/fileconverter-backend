export class InMemoryRedis {
  private store: Map<string, { value: string; expiresAt: number | null }> = new Map();
  async get(key: string): Promise<string | null> {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.expiresAt !== null && e.expiresAt < Date.now()) { this.store.delete(key); return null; }
    return e.value;
  }
  async set(key: string, value: string): Promise<'OK'> { this.store.set(key, { value, expiresAt: null }); return 'OK'; }
  async setex(key: string, ttl: number, value: string): Promise<'OK'> { this.store.set(key, { value, expiresAt: Date.now() + ttl * 1000 }); return 'OK'; }
  async del(key: string): Promise<number> { const e = this.store.has(key); this.store.delete(key); return e ? 1 : 0; }
  async quit(): Promise<'OK'> { return 'OK'; }
  reset() { this.store.clear(); }
}
