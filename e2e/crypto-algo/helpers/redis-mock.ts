import { EventEmitter } from 'node:events';

export class MockRedis extends EventEmitter {
  private readonly store = new Map<string, { value: string; expiresAt: number | null }>();
  private readonly lists = new Map<string, string[]>();
  private readonly subscriptions = new Set<string>();

  duplicate(): MockRedis {
    return new MockRedis();
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt != null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async exists(key: string): Promise<number> {
    const value = await this.get(key);
    return value === null ? 0 : 1;
  }

  async set(key: string, value: string, ...args: (string | number)[]): Promise<'OK' | null> {
    let nx = false;
    let expiresAt: number | null = null;
    for (let i = 0; i < args.length; i++) {
      const arg = String(args[i]).toUpperCase();
      if (arg === 'NX') {
        nx = true;
      }
      if (arg === 'EX' || arg === 'PX') {
        const next = args[i + 1];
        const ms = arg === 'EX' ? Number(next) * 1000 : Number(next);
        expiresAt = Date.now() + ms;
      }
    }
    if (nx) {
      const existing = await this.get(key);
      if (existing !== null) return null;
    }
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async incr(key: string): Promise<number> {
    const entry = this.store.get(key);
    let current = 0;
    let expiresAt: number | null = null;
    if (entry) {
      if (entry.expiresAt != null && Date.now() > entry.expiresAt) {
        this.store.delete(key);
      } else {
        current = Number(entry.value) || 0;
        expiresAt = entry.expiresAt;
      }
    }
    const next = current + 1;
    this.store.set(key, { value: String(next), expiresAt });
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + Math.max(1, seconds) * 1000;
    return 1;
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) removed++;
    }
    return removed;
  }

  async llen(key: string): Promise<number> {
    return this.lists.get(key)?.length ?? 0;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) ?? [];
    const end = stop < 0 ? list.length + stop + 1 : stop + 1;
    return list.slice(start, end);
  }

  async scan(
    cursor: string,
    _matchKeyword: 'MATCH',
    pattern: string,
    _countKeyword: 'COUNT',
    _count: number,
  ): Promise<[string, string[]]> {
    const regex = new RegExp(
      `^${pattern.replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
    );
    const keys = [...this.store.keys()].filter((k) => regex.test(k));
    return cursor === '0' ? ['0', keys] : ['0', []];
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    const list = this.lists.get(key) ?? [];
    list.push(...values);
    this.lists.set(key, list);
    return list.length;
  }

  async lpop(key: string): Promise<string | null> {
    const list = this.lists.get(key);
    if (!list || list.length === 0) return null;
    const value = list.shift()!;
    if (list.length === 0) this.lists.delete(key);
    return value;
  }

  async rpoplpush(source: string, destination: string): Promise<string | null> {
    const src = this.lists.get(source);
    if (!src || src.length === 0) return null;
    const value = src.pop()!;
    if (src.length === 0) this.lists.delete(source);
    const dest = this.lists.get(destination) ?? [];
    dest.unshift(value);
    this.lists.set(destination, dest);
    return value;
  }

  async brpoplpush(source: string, destination: string, _timeout: number): Promise<string | null> {
    return this.rpoplpush(source, destination);
  }

  async lrem(key: string, count: number, value: string): Promise<number> {
    const list = this.lists.get(key);
    if (!list) return 0;
    let removed = 0;
    if (count === 0) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i] === value) {
          list.splice(i, 1);
          removed++;
        }
      }
    } else {
      const direction = count > 0 ? 1 : -1;
      let remaining = Math.abs(count);
      for (
        let i = direction > 0 ? 0 : list.length - 1;
        i >= 0 && i < list.length && remaining > 0;
        i += direction
      ) {
        if (list[i] === value) {
          list.splice(i, 1);
          removed++;
          remaining--;
          if (direction > 0) i--;
        }
      }
    }
    if (list.length === 0) this.lists.delete(key);
    return removed;
  }

  async subscribe(channel: string, callback?: (err: Error | null) => void): Promise<void> {
    this.subscriptions.add(channel);
    this.emit('subscribe', channel);
    callback?.(null);
  }

  async unsubscribe(channel: string): Promise<void> {
    this.subscriptions.delete(channel);
  }

  async publish(channel: string, message: string): Promise<number> {
    this.emit('message', channel, message);
    return 1;
  }

  async quit(): Promise<'OK'> {
    this.subscriptions.clear();
    return 'OK';
  }

  getQueue(key: string): string[] {
    return [...(this.lists.get(key) ?? [])];
  }

  clear(): void {
    this.store.clear();
    this.lists.clear();
    this.subscriptions.clear();
  }
}
