---
domain: "Storage & DB Abstraction"
related_code_paths: ["src/lib/storage/", "src/lib/db/"]
core_rule: "Never use cloud-specific SDKs directly in business logic. Use the `IStorageProvider` and Drizzle ORM abstractions."
---
# 08. Storage & Database Abstraction (Standalone-First)

The open-source edition is designed as a **standalone Node.js application** that runs anywhere with a filesystem and SQLite (or Postgres). Cloud-vendor lock-in is avoided by keeping all storage and DB access behind clean interfaces.

## Current Implementation (v1 – Standalone)

- **Database**: Drizzle ORM + `better-sqlite3` (file-based SQLite at `DB_PATH`). Postgres support is available via the standard Drizzle Postgres driver when `DATABASE_URL` is provided.
- **Object Storage**: `LocalStorageProvider` writes to `STORAGE_DIR` on disk by default. An optional `S3StorageProvider` (or compatible) can be swapped in via environment configuration for S3, MinIO, or Cloudflare R2.
- **No direct SDK usage** in route handlers or services — all file operations go through the storage port.

## Ports & Adapters Pattern (Future-Proofing)

The architecture follows the same hexagonal principle even though the first release targets self-hosted Node.js:

1. **Domain / Services** — pure business logic, no storage or DB details.
2. **Ports** — `IStorageProvider`, `IDatabase` (via Drizzle), `IEmailProvider`, etc.
3. **Adapters** — concrete implementations:
   - `LocalStorageProvider` (default)
   - `S3StorageProvider` (optional, for S3/MinIO/R2)
   - `SqliteDb` / `PostgresDb` (selected by connection string)

Switching from local disk to S3 (or SQLite to Postgres) is a configuration change, not a code change.

## HTTP Framework: Hono (Web Standards)

All HTTP handling uses the Hono framework built on the WinterCG Web Request/Response standard. The same route definitions run on:

- Node.js (`@hono/node-server`)
- Bun
- Any future edge runtime that supports the WinterCG spec

## Adding a New Storage Backend

1. Implement the `IStorageProvider` interface in `src/lib/storage/`.
2. Register the adapter in the DI container based on `STORAGE_PROVIDER` env var.
3. Update `docs/deploy.md` with the new provider's configuration steps.

This keeps the core inspection engine portable while allowing operators to choose the storage tier that fits their deployment.
