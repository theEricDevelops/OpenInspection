---
domain: "Standalone Deployment & Open Source"
related_code_paths: ["src/", "Dockerfile", "docker-compose.yml", "CLAUDE.md"]
---

# 06. Standalone Deployment Guide

OpenInspection (`apps/core` in the monorepo, published as the `OpenInspection` npm package / Docker image) is a fully self-contained Node.js application. It has no runtime dependency on any SaaS control plane. The only secret that must be shared between instances (if you run multiple) is `JWT_SECRET`.

## Architecture highlights for self-hosters

- **Single-tenant by default** — set `SINGLE_TENANT_ID` (any UUID) to pin every record to one tenant. Subdomain routing is bypassed.
- **Multi-tenant ready** — every table has a mandatory `tenant_id`. The `tenant-router` middleware (or `SINGLE_TENANT_ID`) supplies it to the `ScopedDB` layer.
- **No Workers / D1 / R2 / KV** — SQLite file (`better-sqlite3`) at `DB_PATH`, local filesystem or S3-compatible storage under `STORAGE_DIR`, in-memory or Redis cache.
- **First-run wizard** — `GET /setup` detects an empty database and guides you through creating the first admin account.
- **Graceful degradation** — every optional integration (Resend, Gemini, Stripe, Google Calendar, Turnstile, Estated, Google Places) simply disables its feature when the corresponding env var is missing.

## Deployment steps (VM / bare metal / VPS)

```bash
# 1. Clone
git clone <your-fork-or-repo> && cd OpenInspection

# 2. Install
npm install

# 3. Configure environment (minimum)
export JWT_SECRET="$(openssl rand -hex 32)"
export DB_PATH="data/openinspection.db"
export STORAGE_DIR="data/storage"
# Recommended for the public booking form
export TURNSTILE_SECRET_KEY="1x0000000000000000000000000000000AA"
# Optional services
export RESEND_API_KEY=...
export SENDER_EMAIL=...
export GEMINI_API_KEY=...
export STRIPE_SECRET_KEY=...
# ... see CLAUDE.md for the complete table

# 4. Initialize the database (creates file + applies 50+ migrations)
npm run db:reset

# 5. (Optional) Seed demo data for testing
npm run db:seed:test

# 6. Run
npm run dev     # hot-reload for development
# Production:
npm run build
npm start       # or use PM2 / systemd
```

The server listens on `PORT` (default 8788). Point your reverse proxy at it.

## Docker

```bash
# Build and start (uses docker-compose.yml)
npm run docker:build
npm run docker:up

# Or the production target
npm run docker:build:prod
```

Volumes are mounted under `./data` so your SQLite file and uploaded media survive container restarts. Edit `docker-compose.yml` to inject secrets via environment files or Docker secrets.

## Required & optional secrets

| Variable                    | Required | Purpose |
|-----------------------------|----------|---------|
| `JWT_SECRET`                | Yes      | HS256 signing key (≥ 32 chars). Never reuse across unrelated deployments. |
| `DB_PATH`                   | Yes      | Path to the SQLite file (e.g. `data/openinspection.db`). |
| `STORAGE_DIR`               | Yes      | Directory for local object storage (photos, PDFs, signatures). |
| `TURNSTILE_SECRET_KEY`      | Recommended | Server-side verification for `POST /api/book`. Use the public test key for local dev. |
| `RESEND_API_KEY` / `SENDER_EMAIL` | No | Outbound email (report delivery, booking confirmations). |
| `GEMINI_API_KEY`            | No       | AI-powered comment suggestions. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | No | Real-money checkout for paid reports (Connect). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | No | Google Calendar sync for inspectors. |
| `SINGLE_TENANT_ID`          | No       | Enables "Apex Mode" — single-tenant self-host on a primary domain. |
| `APP_NAME`, `PRIMARY_COLOR` | No       | White-label branding overrides. |
| `SETUP_CODE`                | No       | 6-digit code required on first `/setup` visit (printed in logs when DB is empty). |

All secrets are read from `process.env`. Use your process manager, a `.env` file (loaded by tsx or your own dotenv), or Docker secrets.

## First-run setup wizard

1. Start the server with an empty database (`npm run db:reset`).
2. Open `http://localhost:8788/setup` (or your public URL).
3. Enter the `SETUP_CODE` shown in the server log (or the one you set via env).
4. Create the first admin user — the account is immediately granted the `owner` role.

Subsequent visits to `/setup` while the database already contains users will return 404 (the route is intentionally disabled).

## Running in production

- Use a process manager (PM2, systemd, or your PaaS) so the Node process restarts on crash.
- The `start` script (`node --import tsx src/server.ts`) works without a separate compile step, but `npm run build` produces a `dist/` folder if you prefer a pure `node dist/server.js` launch.
- Schedule any maintenance tasks (report cleanup, etc.) via the same `node-cron` instance or an external cron that hits a private maintenance endpoint.
- Back up `data/openinspection.db` regularly. Point-in-time recovery is possible by copying the file while the server is stopped or by using SQLite's online backup API.

## Multi-inspector teams

A single standalone deployment happily supports multiple inspectors. The first admin creates additional users from **Settings → Team**. RBAC (`requireRole()`) protects sensitive actions.

## Data export & portability

`GET /api/admin/export` (owner role) produces a complete JSON dump of the tenant's data. This is the recommended way to migrate between hosts or to create a point-in-time archive.

## Screenshots

### First-Run Setup Wizard

![Setup Wizard](screenshots/core-setup.png)

### Login Page

![Login](screenshots/core-login.png)

See [`docs/screenshots.md`](../screenshots.md) for the full UI screenshot index.
