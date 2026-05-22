# Database Schema

The database is SQLite, accessed via the `better-sqlite3` Node.js driver (file-based at `DB_PATH` or `:memory:` for tests). The schema is defined in TypeScript using Drizzle ORM. Table definitions live in `src/lib/db/schema/` (one `.ts` file per domain, re-exported from `index.ts`). Migrations are plain SQL files stored in `migrations/`.

## Database Management

```bash
npm run db:generate   # Create a new migration after editing src/lib/db/schema/**/*.ts
npm run db:delete     # Remove the local SQLite DB files (data/openinspection.db*)
npm run db:build      # Create/repair the DB file by applying all migrations (no data loss on existing DB)
npm run db:reset      # Full reset: delete DB + db:build (fresh DB with all migrations applied)
```

Migrations are applied automatically on `npm run dev` / `npm start` (and in tests) via `src/lib/db/init.ts` (`initDb` / `applyMigrations`). The loader uses Drizzle's official journal (`migrations/meta/_journal.json`) for ordering + a tolerant raw executor so historical migration files continue to work.

`DB_PATH` environment variable (or default `data/openinspection.db`) controls the database file location. See `scripts/db/build.ts` and `scripts/db/delete.ts` for implementation details.

---

## Tables

> **Note**: The schema has evolved significantly. The tables below are the original core set with updated notes for the standalone era. Dozens of additional tables now exist (contacts, invoices, marketplace_*, recommendations, automations, qbo_*, esign_*, report_pdfs, notifications, tags, etc.). Always refer to the source files in `src/lib/db/schema/` for the current column definitions, defaults, and relationships. Every table includes `tenant_id` (except global agent accounts in some cases) for isolation.

### `tenants`

One row per deployed workspace.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text (PK) | Random ID |
| `name` | text | Company display name |
| `subdomain` | text (unique) | Used for subdomain routing |
| `tier` | text | `'free'` (default) · `'pro'` · `'enterprise'` |
| `status` | text | `'pending'` · `'trialing'` · `'active'` (default) · `'past_due'` · `'suspended'` |
| `stripe_connect_account_id` | text | Stripe Connect Express account ID (optional, for payments) |
| `created_at` | integer (timestamp) | |

---

### `users`

Inspectors, owners, admins, and (global) agents who log in to the dashboard or booking portal.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text (PK) | Random ID |
| `tenant_id` | text (FK → tenants) | Scopes the user (nullable for global `agent` role accounts that can link to multiple tenants via `agent_tenant_links`) |
| `email` | text (unique) | Login credential |
| `password_hash` | text | PBKDF2-SHA256 hash (100k iterations, 16-byte salt). Legacy SHA-256 hashes are auto-rehashed on login. |
| `name`, `phone`, `license_number` | text | Profile fields |
| `role` | text | `'owner'`, `'admin'`, `'inspector'`, or `'agent'` |
| `slug` | text | Per-tenant unique inspector slug for public booking URLs (`/book/<slug>`) |
| `google_refresh_token`, `google_calendar_id`, etc. | text | Google Calendar OAuth fields |
| `totp_*` | various | Optional TOTP 2FA fields (secret, enabled flag, recovery codes) |
| `notify_on_*` | boolean | Per-user notification preferences |
| `created_at` | integer (timestamp) | |

---

### `templates`

Defines the checklist structure for inspections. The `schema` column holds a JSON object describing sections, items, and fields.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text (PK) | Random ID |
| `tenant_id` | text (FK → tenants) | |
| `name` | text | e.g., `'Standard Home Inspection'` |
| `version` | integer | Incremented on update, default `1` |
| `schema` | text (JSON) | See schema structure below |
| `created_at` | integer | Unix timestamp |

**Template schema structure:**

```json
{
  "sections": [
    {
      "title": "Roof & Structure",
      "items": [
        {
          "id": "roof_1",
          "label": "Shingles Condition",
          "fields": ["status", "notes", "photos"]
        }
      ]
    }
  ]
}
```

Each item has a unique `id` used as the key in `inspection_results.data`.

---

### `inspections`

One row per inspection job.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text (PK) | Random ID |
| `tenant_id` | text (FK → tenants) | |
| `inspector_id` | text (FK → users) | Assigned inspector |
| `property_address` | text | Full street address |
| `client_name` | text | |
| `client_email` | text | Used for report email delivery |
| `template_id` | text (FK → templates) | Checklist used for this job |
| `date` | text | ISO 8601 datetime string |
| `status` | text | `'draft'`, `'completed'`, or `'delivered'` |
| `payment_status` | text | `'unpaid'` or `'paid'` |
| `referred_by_agent_id` | text | Optional — ID of referring agent |
| `price` | integer | Price in cents (e.g., `45000` = $450.00) |
| `created_at` | integer | Unix timestamp |

---

### `inspection_results`

Stores the field data collected by the inspector. One row per inspection.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text (PK) | |
| `inspection_id` | text (FK → inspections) | |
| `data` | text (JSON) | Map of item ID → field values |
| `last_synced_at` | integer | Timestamp of last update to the result data |

**`data` structure:**

```json
{
  "roof_1": {
    "status": "Monitor",
    "notes": "Slight wear on north face",
    "photos": ["tenant-id/insp-id/roof_1_abc123_photo.jpg"]
  },
  "foundation_1": {
    "status": "OK",
    "notes": ""
  }
}
```

Inspection result data is stored as a JSON blob keyed by the template item IDs. The web UI performs upserts on this row.

---

### `agreements`

Inspection service agreement templates. One per tenant (typically).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text (PK) | |
| `tenant_id` | text (FK → tenants) | |
| `name` | text | e.g., `'Standard Terms'` |
| `content` | text | Markdown-formatted agreement body |
| `version` | integer | Default `1` |
| `created_at` | integer | Unix timestamp |

---

### `inspection_agreements`

Records a client's e-signature on the agreement for a specific inspection.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text (PK) | |
| `inspection_id` | text (FK → inspections) | |
| `signature_base64` | text | PNG data URI of the signature canvas |
| `signed_at` | integer | Timestamp |
| `ip_address` | text | Connecting IP address (from request headers) |
| `user_agent` | text | Browser user agent |

---

### `availability`

Recurring weekly availability for each inspector.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text (PK) | |
| `tenant_id` | text (FK → tenants) | |
| `inspector_id` | text (FK → users) | |
| `day_of_week` | integer | `0` = Sunday, `6` = Saturday |
| `start_time` | text | `'HH:MM'` 24-hour format |
| `end_time` | text | `'HH:MM'` 24-hour format |
| `created_at` | integer | Unix timestamp |

---

### `availability_overrides`

Date-specific overrides that take precedence over recurring availability.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text (PK) | |
| `tenant_id` | text (FK → tenants) | |
| `inspector_id` | text (FK → users) | |
| `date` | text | `'YYYY-MM-DD'` |
| `is_available` | integer (boolean) | `0` = blocked, `1` = custom hours |
| `start_time` | text | Only relevant when `is_available = 1` |
| `end_time` | text | Only relevant when `is_available = 1` |
| `created_at` | integer | Unix timestamp |

---

## Migration Files

Migrations are numbered sequentially in `migrations/NNNN_*.sql`. The complete ordered list and hashes are tracked in `migrations/meta/_journal.json` (Drizzle standard).

Early foundational migrations established the core tables (`tenants`, `users`, `inspections`, etc.). Later migrations added marketplace, notifications, 2FA, property facts, tags, e-sign audit, QBO sync, and many other features. There are 50+ migrations as of 2026.

When adding a new table or column:

1. Edit the relevant file in `src/lib/db/schema/`.
2. Run `npm run db:generate`.
3. Review the generated `migrations/00xx_*.sql` (it will contain `--> statement-breakpoint` markers).
4. Commit the new `.sql` file + updated `_journal.json` + snapshot.

See `CLAUDE.md` (Database Migrations section) and `src/lib/db/init.ts` for the full workflow and legacy compatibility notes.

## Indexes

Indexes are defined alongside table schemas in the TypeScript files (Drizzle) and appear in the generated migration SQL. Example from early agent CRM work:

```sql
-- 0003_agent_crm.sql
CREATE INDEX IF NOT EXISTS idx_inspections_agent
    ON inspections(referred_by_agent_id);
```

---

## Drizzle ORM Usage

Schema definitions live in `src/lib/db/schema/`. The project provides a convenience wrapper:

```typescript
import { getDrizzle } from '../lib/db';
import { inspections } from '../lib/db/schema';
import { eq } from 'drizzle-orm';

const db = getDrizzle();
const results = await db.select()
    .from(inspections)
    .where(eq(inspections.tenantId, tenantId));
```

For most application code, use the `ScopedDB` (injected as `c.get('sdb')` or `this.sdb` in services) which automatically enforces tenant isolation on every query:

```typescript
// Inside a route handler or service
const sdb = c.get('sdb'); // or this.sdb
const row = await sdb.getById(inspections, inspectionId);
```

See `src/lib/db/scoped.ts` and `src/lib/db/init.ts` for implementation. All new tables must include a `tenantId` column.

All schema is re-exported from `src/lib/db/schema/index.ts` for convenience.
