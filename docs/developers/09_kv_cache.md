---
domain: "In-Memory / Redis Cache"
related_code_paths: ["src/lib/cache.ts", "src/lib/middleware/tenant.ts", "src/lib/auth.ts"]
---

# Cache Layer — Why and How

The standalone edition uses a lightweight, pluggable cache (in-memory by default, Redis optional) for two purposes:

1. **Password-change invalidation** (`pwchanged:{userId}`) — forces immediate logout of all sessions when a user changes or resets their password.
2. **One-time tokens** (password reset, email verification) — short-lived signed tokens with server-side TTL.

No Cloudflare KV, no global edge distribution, and no per-request tenant lookups are required because the open-source build is **single-tenant** (`SINGLE_TENANT_ID`).

---

## Password-Change Invalidation

When a user changes their password (or an admin resets it), the server writes a marker:

```ts
await cache.set(`pwchanged:${userId}`, Date.now(), 60 * 60 * 24); // 24 h
```

On every authenticated request the auth middleware reads this key. If the token's `iat` claim is older than the marker, the request is rejected with 401. This guarantees that a stolen token becomes useless the moment the legitimate owner changes the password.

- Default: in-memory `Map` (fast, zero-config, sufficient for a single Node process).
- Optional: Redis-backed implementation for multi-process / multi-host deployments.
- TTL is intentionally long (24 h) because the marker only needs to outlive the longest-lived JWT.

## One-Time Action Tokens

Password-reset and email-verification flows create a signed JWT that is also recorded in the cache under a random `jti`. The token is valid for 1 hour. On first use the server deletes the `jti` entry, making the token single-use even if the signature is still valid.

```ts
// creation
const jti = randomUUID();
await cache.set(`token:${jti}`, "1", 3600);
const token = sign({ sub: userId, jti, purpose: "reset" }, JWT_SECRET, "HS256");

// verification
const payload = verify(token, JWT_SECRET);
if (await cache.get(`token:${payload.jti}`)) {
    await cache.delete(`token:${payload.jti}`);
    // proceed with reset
}
```

## Configuration

| Env Var | Effect |
| ---------------------- | -------- |
| (none) | In-memory cache (default, single-process) |
| `REDIS_URL` | Switches to the Redis adapter automatically |
| `CACHE_TTL_PWCHANGE` | Override the 24 h TTL for password-change markers |

## Why Not the Old Alternatives?

| Old Idea | Why it was replaced |
| --------------------------- | --------------------- |
| Cloudflare KV | Requires Workers runtime; not available in plain Node |
| Module-level `Map` only | Works for one process; lost on restart or multi-instance deploys |
| Writing to SQLite on every auth check | Unnecessary write amplification; cache is faster and ephemeral |

The current design keeps the security guarantee (password change instantly invalidates tokens) while staying lightweight and self-contained for standalone deployments.
