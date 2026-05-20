export interface Cache {
    get(key: string): Promise<string | null>;
    get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
    get<T = unknown>(key: string, opts: { type: 'json' }): Promise<T | null>;
    put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
}

interface CacheEntry {
    value: string;
    expiresAt: number;
}

export class MemoryCache implements Cache {
    private store = new Map<string, CacheEntry>();

    private sweep() {
        const now = Date.now();
        for (const [key, entry] of this.store) {
            if (entry.expiresAt > 0 && now >= entry.expiresAt) {
                this.store.delete(key);
            }
        }
    }

    async get(key: string): Promise<string | null>;
    async get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
    async get<T = unknown>(key: string, opts: { type: 'json' }): Promise<T | null>;
    async get<T = unknown>(key: string, _typeOrOpts?: unknown): Promise<T | string | null> {
        this.sweep();
        const entry = this.store.get(key);
        if (!entry) return null;
        if (entry.expiresAt > 0 && Date.now() >= entry.expiresAt) {
            this.store.delete(key);
            return null;
        }
        if (_typeOrOpts) {
            try { return JSON.parse(entry.value) as T; } catch { return null; }
        }
        return entry.value;
    }

    async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
        const expiresAt = opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : 0;
        this.store.set(key, { value, expiresAt });
    }

    async delete(key: string): Promise<void> {
        this.store.delete(key);
    }
}

export class RedisCache implements Cache {
    private defaultTtl: number;

    constructor(url: string, opts?: { defaultTtl?: number }) {
        this.redisUrl = url;
        this.defaultTtl = opts?.defaultTtl ?? 3600;
    }
    private redisUrl: string;
    private redisPromise: Promise<import('ioredis').Redis> | undefined;

    private async getRedis(): Promise<import('ioredis').Redis> {
        if (!this.redisPromise) {
            const { Redis } = await import('ioredis');
            const r = new Redis(this.redisUrl);
            this.redisPromise = Promise.resolve(r);
        }
        return this.redisPromise;
    }

    async get(key: string): Promise<string | null>;
    async get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
    async get<T = unknown>(key: string, opts: { type: 'json' }): Promise<T | null>;
    async get<T = unknown>(key: string, _typeOrOpts?: unknown): Promise<T | string | null> {
        const r = await this.getRedis();
        const val = await r.get(key);
        if (val === null) return null;
        if (_typeOrOpts) {
            try { return JSON.parse(val) as T; } catch { return null; }
        }
        return val;
    }

    async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
        const r = await this.getRedis();
        const ttl = opts?.expirationTtl ?? this.defaultTtl;
        await r.setex(key, ttl, value);
    }

    async delete(key: string): Promise<void> {
        const r = await this.getRedis();
        await r.del(key);
    }

    async quit(): Promise<void> {
        const r = await this.getRedis();
        await r.quit();
    }
}
