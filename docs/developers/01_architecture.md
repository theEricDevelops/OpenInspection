# Architecture Overview

OpenInspection is a standalone Node.js server (Hono + @hono/node-server) that serves both a web UI and a JSON API. HTML is server-rendered from TypeScript/JSX template functions using hono/jsx. There is no separate frontend framework.

## Runtime Model (Standalone / Open Source)

| Concern | Technology |
|---|---|
| Runtime | Node.js 18+ (`@hono/node-server`) |
| Framework | Hono v4 |
| Database | SQLite via `better-sqlite3` + Drizzle ORM |
| Storage | Local filesystem (`STORAGE_DIR`) or any S3-compatible bucket |
| Cache | In-memory (default) or Redis (optional) |
| Background jobs | `node-cron` (in-process) |
| Email | Resend API (optional) |
| AI | Google Gemini 1.5 Flash (optional) |
| Styling | Tailwind CSS v3 (built to `public/styles.css`) |
| Frontend JS | Alpine.js 3.x (progressive enhancement only) |

## Request Lifecycle

Every request passes through the middleware stack defined in `src/index.ts` (or `src/server.ts` for the dev entry):

```
Request
  │
  ├─ Security headers / CSP
  │
  ├─ Branding resolver (cache → DB)
  │
  ├─ Tenant router (subdomain or SINGLE_TENANT_ID → tenantId)
  │
  ├─ JWT auth (HttpOnly __Host-inspector_token cookie or Bearer header)
  │    Skipped for: /api/auth/*, /api/public/*, /api/setup, /api/book, etc.
  │
  ├─ Bot protection (Turnstile on public booking)
  │
  ├─ DI layer (lazy service instantiation with tenant-scoped DB)
  │
  ├─ Tier guard (subscription checks — no-op in standalone free tier)
  │
  └─ Route handler → validated input → service call → response (JSON or JSX HTML)
```

The `ScopedDB` wrapper (`src/lib/db/scoped.ts`) automatically injects `WHERE tenant_id = ?` on every query, enforcing physical tenant isolation.

## Multi-Tenancy & Deployment Modes

- **Standalone (default for self-hosters)**: Set `SINGLE_TENANT_ID` (any stable UUID). All data is pinned to that tenant; subdomain routing is bypassed. This is the mode documented in `CLAUDE.md`.
- **Shared SaaS**: One database, many tenants, each on its own subdomain. The `tenant-router` middleware resolves `Host` → tenant record.
- **Silo SaaS**: Each tenant gets its own database connection (advanced; usually requires a control plane).

Tenant isolation is **mandatory** in the schema (every table has `tenant_id NOT NULL`) and **fail-closed** in the data layer.

## RBAC

Roles live in the `users` table and are also carried in the JWT (`role` and `custom:userRole`). The `requireRole()` middleware returns 403 when the caller's role is insufficient.

| Role | Capabilities |
|---|---|
| `owner` | Everything, including workspace deletion and billing |
| `admin` | Team management, all inspection operations |
| `inspector` | Create/submit inspections, upload media |
| `agent` | View referred reports, export agent data |

## Tenant Tier / Status (mostly SaaS concern)

Standalone deployments run in the `free` tier with `active` status. The tier-guard middleware is a no-op for `free` tenants. SaaS control planes push tier/status updates via the M2M `POST /api/admin/tenant-status` endpoint (Bearer `JWT_SECRET`).

## Template Rendering

All UI is produced by hono/jsx template functions. No React/Vue runtime. Pages are HTML + Tailwind + small Alpine.js snippets for interactivity (modals, photo upload, signature canvas, etc.).

## Directory Structure (key paths)

```
src/
  index.ts                 # Hono app + route registration
  server.ts                # Node entry (tsx / production)
  api/                     # One file per resource (auth, inspections, booking, …)
  services/                # Business logic + DB access (tenant-scoped via DI)
  lib/
    middleware/            # auth, rbac, tenant-router, branding, di, …
    db/                    # schema/*.ts, init.ts, scoped.ts, utils
    validations/           # Zod schemas (never inline validation)
    logger.ts              # Structured JSON logger (use this, not console)
  templates/               # hono/jsx layouts + pages + components
public/
  styles.css               # Compiled Tailwind (built by css:build)
  js/                      # Page-specific Alpine handlers
migrations/                # 00xx_*.sql + meta/_journal.json (Drizzle)
scripts/db/                # db:build, db:delete, db:reset helpers
```

## Environment Variables (no wrangler.toml)

All configuration comes from `process.env`. See the complete table in `CLAUDE.md`. The only hard requirement is `JWT_SECRET`.

Non-secret vars can live in a `.env` file or your process manager config. Secrets (API keys) should be injected by your deployment platform or a secrets manager.

## JWT Details (HS256 + iat + pwchanged cache)

- Every `sign()` call **must** use `'HS256'` and include `iat`.
- Tokens live in the `__Host-inspector_token` HttpOnly, Secure, SameSite=Strict cookie.
- On password change / user delete, a `pwchanged:{userId}` entry is written to the cache; tokens with `iat < changedAt` are rejected.
- Never put the token in a response body or localStorage.

## Logging & Security Rules

- Server code **must** use `import { logger } from '../lib/logger'`.
- English only in source, comments, docs, and user strings.
- Every new table **must** include `tenantId`.
- All input is validated with Zod schemas located in `src/lib/validations/`.

This architecture document is intentionally high-level. For the exact current middleware order and service DI pattern, read `src/index.ts` and `src/lib/middleware/`.
