import DatabaseConstructor from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import type { SqliteDb } from '../../types/db';
import { logger } from '../logger';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let _db: SqliteDb | null = null;

/**
 * Resolve the migrations folder relative to this module.
 * Works under tsx (dev) and compiled dist (prod).
 */
function getMigrationsFolder(): string {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    // src/lib/db/init.ts -> project root is 3 levels up
    return resolve(__dirname, '../../../migrations');
}

/** Create the official Drizzle tracking table if it does not exist. */
function ensureDrizzleMigrationsTable(raw: SqliteDb): void {
    raw.exec(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL,
        created_at NUMERIC
    )`);
}

/** Return the highest created_at timestamp recorded, or 0 if table empty/missing. */
function getLastAppliedTimestamp(raw: SqliteDb): number {
    try {
        const row = raw
            .prepare('SELECT MAX(created_at) as ts FROM __drizzle_migrations')
            .get() as { ts?: number } | undefined;
        return row?.ts ?? 0;
    } catch {
        return 0;
    }
}

/** Record that a migration has been applied (idempotent insert). */
function recordAppliedMigration(raw: SqliteDb, hash: string, when: number): void {
    const exists = raw.prepare('SELECT 1 FROM __drizzle_migrations WHERE hash = ?').get(hash);
    if (!exists) {
        raw.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(hash, when);
    }
}

/** Heuristic: does this DB already contain the core application tables? */
function hasExistingCoreSchema(raw: SqliteDb): boolean {
    try {
        const row = raw
            .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tenants'")
            .get();
        return !!row;
    } catch {
        return false;
    }
}

/**
 * Apply the full migration set to a *raw* better-sqlite3 Database instance.
 *
 * Uses the official Drizzle journal (`migrations/meta/_journal.json`) for
 * discovery + ordering and the project's tolerant executor (raw.exec per
 * file) so that the historical pre-`--> statement-breakpoint` migration files
 * continue to work.
 *
 * This is the single source of truth for bringing any DB (file or :memory:)
 * to the current schema. Both production (`initDb`) and the test helper
 * go through this path.
 */
export function applyMigrations(raw: SqliteDb): void {
    const migrationsFolder = getMigrationsFolder();

    try {
        const migrations = readMigrationFiles({ migrationsFolder });

        ensureDrizzleMigrationsTable(raw);
        const lastApplied = getLastAppliedTimestamp(raw);

        let appliedCount = 0;
        const hasCore = hasExistingCoreSchema(raw);
        const isLegacy = hasCore && lastApplied === 0;

        if (isLegacy) {
            // Fast adoption path for on-disk DBs that were created by the
            // old custom runner before we switched to the official Drizzle
            // __drizzle_migrations table. We just seed the tracking rows
            // without re-executing any DDL.
            for (const mig of migrations) {
                recordAppliedMigration(raw, mig.hash, mig.folderMillis);
            }
            logger.info('[db] Adopted existing database into official Drizzle migration tracking (no statements re-executed)');
        } else {
            // Normal path – apply anything newer than the last recorded row.
            for (const mig of migrations) {
                if (mig.folderMillis <= lastApplied) {
                    continue;
                }

                const sqlText = mig.sql.join('\n');

                try {
                    raw.exec(sqlText);
                    recordAppliedMigration(raw, mig.hash, mig.folderMillis);
                    appliedCount++;
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    const isNonFatal =
                        msg.includes('duplicate column') ||
                        msg.includes('already exists') ||
                        /table .+ already exists/i.test(msg);

                    if (isNonFatal && isLegacy) {
                        logger.warn(`[db] Skipping non-fatal statement(s) while adopting legacy DB`, {
                            migration: mig.hash.slice(0, 12),
                            error: msg.slice(0, 160),
                        });
                        recordAppliedMigration(raw, mig.hash, mig.folderMillis);
                        continue;
                    }

                    logger.error(`[db] Fatal error applying migration ${mig.hash.slice(0, 12)}`, {}, err instanceof Error ? err : undefined);
                    throw err;
                }
            }

            if (appliedCount > 0) {
                logger.info(`[db] Applied ${appliedCount} pending migration(s) from ${migrationsFolder}`);
            }
        }
    } catch (err: unknown) {
        logger.error('[db] Migration bootstrap failed', { folder: migrationsFolder }, err instanceof Error ? err : undefined);
        throw err;
    }
}

/**
 * Initialize (or return cached) better-sqlite3 connection and ensure the full
 * schema is present by running any pending migrations discovered via the
 * official Drizzle journal (meta/_journal.json + numbered .sql files).
 *
 * This replaces the previous hand-rolled _migrations table logic with
 * Drizzle's standard discovery mechanism while remaining compatible with
 * the project's historical SQL migration files (which pre-date the
 * statement-breakpoint generator format).
 */
export function initDb(dbPath: string = ':memory:'): SqliteDb {
    if (_db) {
        return _db;
    }

    const isMemory = !dbPath || dbPath === ':memory:';

    if (!isMemory) {
        const dir = dirname(dbPath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
    }

    const raw: SqliteDb = new DatabaseConstructor(dbPath);
    raw.pragma('journal_mode = WAL');
    raw.pragma('foreign_keys = ON');

    applyMigrations(raw);

    _db = raw;
    return raw;
}

export function getDb(): SqliteDb {
    if (!_db) {
        throw new Error('Database not initialized. Call initDb(dbPath) first.');
    }
    return _db;
}

export function getDrizzle() {
    return drizzle(getDb(), { schema });
}
