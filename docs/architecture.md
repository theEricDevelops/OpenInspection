# Architecture

OpenInspection is a multi-tenant home inspection app. This doc covers the high-level architecture for self-hosters, contributors, and reviewers.

## Stack at a glance

| Layer | Tech |
|---|---|
| Runtime | Node.js |
| Routing + JSX | [Hono](https://hono.dev) + hono/jsx (server-rendered HTML) |
| ORM + DB | [Drizzle](https://orm.drizzle.team) + SQLite |
| Object storage | Local File System / S3-compatible storage |
| Cache | Memory / Redis |
| Background jobs | node-cron |
| Frontend runtime | Alpine.js 3.x (no React/Vue runtime) + Tailwind CSS v3 |
| AI | Google Gemini API (optional) |
| Email | Resend |
| Payments | Stripe Connect (optional) |
| Auth | HS256 JWT in HttpOnly cookie + PBKDF2-SHA256 password hashing |

## Module map

```
apps/core/
├── src/
│   ├── index.ts               # Hono app entry, middleware order, route registration
│   ├── api/                   # Route handlers (one file per resource)
│   │   ├── auth.ts            # /api/auth/{login,register,reset-password,...}
│   │   ├── inspections.ts     # /api/inspections/* + share/print
│   │   ├── ai.ts              # /api/ai/{suggest-comment,comment/edit}
│   │   ├── booking.ts         # /api/public/* (no auth) + /api/book
│   │   ├── ...
│   ├── services/              # Business logic, DB queries (Drizzle)
│   │   ├── inspection.service.ts
│   │   ├── ai.service.ts
│   │   ├── email.service.ts
│   │   ├── ...
│   ├── lib/
│   │   ├── middleware/        # Hono middleware (auth, RBAC, branding, tenant-router, DI)
│   │   ├── db/                # Drizzle schema + utils
│   │   ├── validations/       # Zod schemas per module
│   │   ├── errors.ts          # AppError + ErrorCode + Errors factory
│   │   ├── logger.ts          # Structured JSON logger (use this, not console)
│   │   ├── ics.ts             # iCalendar string builder
│   ├── templates/             # hono/jsx templates (server-rendered)
│   │   ├── layouts/           # MainLayout (auth) + BareLayout (public)
│   │   ├── components/        # Reusable UI: PageHeader, Modal, etc.
│   │   ├── pages/             # One file per page (dashboard.tsx, ...)
│   ├── workflows/             # Asynchronous business logic flows
│   ├── styles/input.css       # Tailwind input + canonical v3 :root tokens
├── public/                    # Static assets (compiled CSS, fonts, JS)
│   ├── js/                    # Alpine handlers (one file per page typically)
│   ├── fonts/                 # Self-hosted fonts (Inter, JetBrains Mono)
├── migrations/                # SQLite migrations (00xx_<name>.sql)
├── scripts/                   # Setup, seed, codemod, deploy helpers
├── tests/
│   ├── unit/                  # Vitest
│   ├── e2e/                   # Playwright
```

## Request flow

```
Client request
   ↓
Node.js Server → Hono fetch handler
   ↓
Hono middleware stack (in order):
   1. CSP / security headers
   2. Branding resolver (Cache → DB fallback)
   3. Tenant router (subdomain → tenant ID)
   4. JWT auth (skip on /api/auth, /api/public, /api/setup)
   5. Bot protection (Turnstile)
   6. Tier guard (subscription check, no-op in standalone)
   7. DI proxy (lazy-instantiates services)
   ↓
Route handler reads validated input via c.req.valid('json')
   ↓
Handler calls c.var.services.xxx (auto-tenant-scoped)
   ↓
Service queries SQLite (Drizzle) / Storage / Cache / external API
   ↓
Response via sendSuccess() / sendError() (canonical envelope)
   ↓
JSX rendered via hono/jsx, returned as HTML
```

## Multi-tenancy model

Every table includes `tenant_id` (NOT NULL). Three deployment modes:

- **Standalone** (default for self-hosters): single tenant. `SINGLE_TENANT_ID` env var pins all data to one tenant. The tenant subdomain is irrelevant.
- **Shared SaaS**: one instance, many tenants, each on a subdomain (`acme.app.com`, `xyz.app.com`).
- **Silo SaaS**: per-tenant dedicated database.

Subdomain → tenant resolution lives in `lib/middleware/tenant-router.ts`:

1. Cache check first (5-minute TTL)
2. DB fallback `SELECT id FROM tenants WHERE subdomain = ?`
3. Cache the result back to Cache

## Authentication

- Login → server signs JWT (HS256, includes `iat` claim) → sets `__Host-inspector_token` HttpOnly cookie
- Each request: middleware verifies JWT signature + checks `iat ≥ Cache[pwchanged:userId]`
- Password change: writes `pwchanged:userId = now()` to Cache → invalidates all prior tokens server-side
- Browser JS never sees the token (HttpOnly enforced); same-origin `fetch()` sends the cookie automatically.

## Service layer

Each domain has a service class with:

- Constructor receiving `db` (or `ScopedDB`) + `tenantId`
- Methods that filter by `tenant_id` automatically (via `ScopedDB` wrapper)
- No direct DB calls in route handlers — always via service

Example:

```typescript
// In a route handler:
const inspections = await c.var.services.inspection.list({ status: 'in_progress' });
// c.var.services.inspection is auto-instantiated with c.get('tenantId')
```

The DI proxy in `lib/middleware/di.ts` lazy-instantiates each service on first access per request.

## Frontend layer

- **No build step for runtime JS**: Alpine.js loads from `/vendor/alpinejs.min.js` (self-hosted), page-specific handlers in `/js/<page>.js`, all globals.
- **Tailwind**: `src/styles/input.css` is the source; `npm run css:build` outputs `public/styles.css`. Watch via `npm run css:watch`.
- **JSX server-side only**: `hono/jsx` renders to HTML on the server — no React or Vue runtime, no SSR-then-hydrate. Alpine handles interactivity client-side.
- **Component primitives**: `src/templates/components/{page-header,modal,inline-text-popover,...}.tsx` are reusable JSX components.
- **Design tokens**: defined in `src/styles/input.css` `:root` block. The full design system reference (typography scale, color tokens, motion patterns, accessibility standards) is in `docs/superpowers/plans/2026-05-08-sprint1-design-system-reference.md`.

## Storage

- **SQLite**: structured data (tenants, users, inspections, templates, comments, agreements, audit logs, ...)
- **Object Storage**: blobs (photos, logos, future PDFs). Bindings: `PHOTOS`. Photos accessed via signed URL or pass-through endpoint.
- **Cache**: short-lived signed tokens (agent share, password reset, magic link), tenant config cache, rate-limit counters.

## Background work

- **Business Workflows**: Asynchronous processes (e.g. sign-completion) that handle PDF rendering and audit chain extensions.
- **Cron jobs**: sandbox reset (daily 00:00 UTC), notification reminder sweeps (hourly), report-ready automations.

## Extending OpenInspection

See [`docs/extending.md`](extending.md) for cookbook recipes: new templates, payment providers, automation rules, comment libraries, SSO providers, languages, report themes, server-side PDFs, webhook receivers, and individual page overrides.
