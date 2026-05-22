# Deploying OpenInspection

OpenInspection is a standalone Node.js application. This guide covers self-hosting for your own inspection business and notes about the public sandbox (run internally by the project maintainers).

If you only want to run OpenInspection for yourself, follow the self-hosted section.

---

## Self-hosted production

### Prerequisites

- Node.js 18+
- SQLite (included via `better-sqlite3`)
- A reverse proxy (Caddy, Nginx, Traefik) or a PaaS / container platform if you want HTTPS + custom domain

### Quick start (local / VM)

```bash
git clone <repo> && cd OpenInspection
npm install

# 1. Create your environment file or export vars
export JWT_SECRET="$(openssl rand -hex 32)"
export DB_PATH="data/openinspection.db"
export STORAGE_DIR="data/storage"
# Optional but recommended
export TURNSTILE_SECRET_KEY="1x0000000000000000000000000000000AA"   # test key for now
export RESEND_API_KEY=...
export SENDER_EMAIL=...

# 2. Initialize / repair the database (applies all migrations)
npm run db:reset

# 3. Start the server
npm run dev          # development (tsx watch + Tailwind)
# or for production
npm run build
npm start            # or: node --import tsx src/server.ts
```

Visit `http://localhost:8788/setup` and enter the `SETUP_CODE` (or the one printed in logs if you set one) to create the first admin account.

### Docker

A `Dockerfile` and `docker-compose.yml` are provided:

```bash
npm run docker:build
npm run docker:up
```

See `docker-compose.yml` for volume mounts (`data/`) and environment variable examples. The production compose target runs the compiled app.

### Environment variables

See the full table in `CLAUDE.md`. The only **required** variable is `JWT_SECRET` (≥ 32 chars). All other services (email, AI, payments, Turnstile, Google Places, etc.) are optional and gracefully degrade when their keys are absent.

### Production considerations

- Run behind a reverse proxy that terminates TLS and sets `X-Forwarded-*` headers.
- Use a process manager (PM2, systemd, or your container orchestrator) for restarts and zero-downtime deploys.
- Back up `data/openinspection.db` (and the `data/storage/` directory if you use local file storage).
- For horizontal scaling you will need to move the SQLite file to a network volume or switch the storage layer to S3-compatible object storage (see `src/lib/storage.ts`).
- Scheduled jobs (nightly report cleanup, etc.) use `node-cron` inside the single process.

### Post-deploy first-run

After the server is reachable, open `/setup` in a browser and create your admin account using the `SETUP_CODE` you configured (or the one shown in the startup log when the database was empty).

---

## Public sandbox demo

The public sandbox at `sandbox.inspectorhub.io` is operated by the project maintainers as a separate deployment of the same codebase. It uses `SANDBOX_MODE=true` (which renders a warning banner) and is reset nightly via an internal cron + `scripts/sandbox-seed.js`.

Self-hosters do **not** need to run a sandbox. If you are contributing and want to test the reset flow locally, use:

```bash
npm run db:reset
npm run seed:comments
# ... other seed scripts as needed
```

Do not leave `SANDBOX_MODE` enabled on a production business installation.

---

## Further reading

- [`docs/developers/06_deployment.md`](./developers/06_deployment.md) — detailed standalone deployment architecture and first-run wizard.
- `CLAUDE.md` — canonical command reference and environment variable table.
- `Dockerfile` + `docker-compose.yml` for containerized deploys.
