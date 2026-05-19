# Cloudflare → Generic Infrastructure Migration Plan

**Repo**: theEricDevelops/OpenInspection (forked from InspectorHub/OpenInspection)

## Strategy

Replace 11 Cloudflare-specific subsystems with standard, portable equivalents. The
database layer is the highest-touch change (68 files); everything else is localized
to a small number of files.

---

## Phase 1 — Database Driver + Entry Point

### 1a. Swap D1 driver → better-sqlite3 (68 files)

Every `import { drizzle } from 'drizzle-orm/d1'` becomes
`import { drizzle } from 'drizzle-orm/better-sqlite3'`.

Service constructors change from `D1Database` param type to `BetterSqlite3Database`.
The `ScopedDB` and raw SQL calls (`db.prepare().bind().run()`) update accordingly.

The existing unit tests already use this driver (`tests/unit/db.ts`) — this brings
production code in line with test patterns.

### 1b. Rewrite entry point `src/index.ts`

Current: Workers ESM export `{ fetch, scheduled }`.
Target: `@hono/node-server` for a standard Node.js HTTP server.

Replace `serveStatic` from `hono/cloudflare-workers` with `@hono/node-server`'s
serve static (or Express middleware). The `c.env.BINDING` Hono pattern stays the
same — only the _values_ change from CF bindings to regular environment variables.

Remove: `hono/cloudflare-workers` import
Add: `@hono/node-server` and `serve-static` dependencies

### 1c. Update `AppEnv` type (`src/types/hono.ts`)

Replace `D1Database`, `R2Bucket`, `KVNamespace`, `Fetcher`, `Workflow` types with
portable interfaces or `any` (with proper types downstream).

### 1d. Add `@hono/node-server` dependency, remove CF dev deps

```json
"dependencies": {
  "@hono/node-server": "^1.x",
  "better-sqlite3": "^12.x",
  "@types/better-sqlite3": "^7.x"
}
```

Remove (after full migration):
- `wrangler`
- `miniflare`
- `@cloudflare/vitest-pool-workers`
- `worker-configuration.d.ts`

### 1e. Update Playwright E2E config

`playwright.config.ts`: replace `npx wrangler dev --port 8789` with
`node dist/server.js` (or equivalent server start command).

---

## Phase 2 — Storage + Cache Abstractions

### 2a. Object Storage: R2 → S3-compatible

Create `src/lib/storage.ts` with an `ObjectStorage` interface:

```typescript
interface ObjectStorage {
  get(key: string): Promise<{ body: ReadableStream; httpEtag?: string; writeHttpMetadata(h: Headers): void } | null>;
  put(key: string, body: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: ...; customMetadata?: ... }): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<{ objects: { key: string; uploaded: Date }[] }>;
}
```

Implement `S3Storage` using `@aws-sdk/client-s3`. Replace R2 calls in 15 files.

### 2b. KV Cache → In-memory / Redis

Create `src/lib/cache.ts` with a `Cache` interface:

```typescript
interface Cache {
  get(key: string): Promise<string | null>;
  get<T>(key: string, opts: { type: 'json' }): Promise<T | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}
```

Implement `MemoryCache` (for Docker/single-server) and optionally `RedisCache`.
Replace KV calls in all middleware, auth, branding, tenant-router, QBO, etc.

Remove `executionCtx.waitUntil()` patterns — just `await cache.put()` directly.

### 2c. Environment variable access pattern

Replace `c.env.DB`, `c.env.PHOTOS`, `c.env.TENANT_CACHE` with `process.env` or
an injected config object. Hono's `c.env` can still work if we bind env vars at
app creation time instead of relying on CF's binding injection.

---

## Phase 3 — PDF Generation + Workflows

### 3a. PDF: Browser Rendering → Puppeteer/Playwright

Create `src/lib/pdf.ts` replacement:

- Remove `Fetcher` usage (Cloudflare Browser Rendering)
- Use `puppeteer` or `playwright` core to render HTML pages to PDF
- Browser runs in headless mode inside Docker
- API stays the same: `generatePdfFromUrl(url) → ArrayBuffer`

Update `ReportPdfService` and `SignCompletionWorkflow`.

### 3b. Workflows → BullMQ / Simple Promise Chain

Cloudflare Workflows (`WorkflowEntrypoint`) provides retries, backoff, timeouts.
Replace with BullMQ (Redis-backed queue) or a simple async chain with
retry logic.

The existing workflow has 3 deterministic steps:
1. Render signed PDF → store in S3
2. Render certificate PDF → store in S3
3. Append `workflow.complete` audit row

This could also be a fire-and-forget promise with manual retry.

---

## Phase 4 — Bot Protection, Headers, Cron, Deployment

### 4a. Turnstile → reCAPTCHA / hCaptcha

Server-side: Change the verify URL from `challenges.cloudflare.com/turnstile`
to the chosen provider.

Client-side: Replace Turnstile widget `<script>` in templates with the new
provider's widget.

### 4b. CF Threat Score → Remove

The `blockHighThreatScore` middleware reads `cf.threat_score` (Cloudflare-only).
Remove it — there's no portable equivalent.

### 4c. CF-specific headers → Standard

Replace:
- `CF-Connecting-IP` → `X-Forwarded-For` / `X-Real-IP`
- `cf-ipcountry` → `X-Geo-Country` or `geoip-lite` lookup
- `CF-IPCountry` → same

Files affected: `audit.ts`, `rate-limit.ts`, `bot-protection.ts`, API routes.

### 4d. Cron → node-cron / External scheduler

Replace `[triggers] crons` in wrangler.toml with `node-cron` inside the app
process, or expose each handler as an HTTP endpoint for external cron
(AWS EventBridge, GCP Scheduler, etc.).

### 4e. Dockerfile + docker-compose.yml

```dockerfile
FROM node:22-slim
# or node:22-alpine + chromium for Puppeteer
WORKDIR /app
COPY . .
RUN npm ci --omit=dev
CMD ["node", "dist/server.js"]
```

```yaml
services:
  app:
    build: .
    ports: ["8788:8788"]
    env_file: .env
    volumes:
      - ./data:/app/data
```

### 4f. Build scripts

Replace `wrangler deploy`, `wrangler dev` with:
- `npm run build` → `tsc`
- `npm start` → `node dist/server.js`
- `npm run dev` → `tsx watch src/server.ts`

Remove: `wrangler.toml`, `wrangler.saas.toml`, `.dev.vars`
