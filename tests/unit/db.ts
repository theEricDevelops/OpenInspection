import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../src/lib/db/schema';
import { applyMigrations } from '../../src/lib/db';

/**
 * Create an isolated in-memory SQLite database for unit tests.
 * Uses the exact same migration applicator as production (`applyMigrations`)
 * so that the 60+ legacy migration files are executed with the tolerant
 * executor that understands the project's historical corpus.
 */
export function createTestDb() {
    const sqlite = new Database(':memory:');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');

    applyMigrations(sqlite);

    const db = drizzle(sqlite, { schema });
    return { sqlite, db };
}

/**
 * @deprecated Schema is now applied automatically inside `createTestDb()`
 * via the shared `applyMigrations()` logic. This function is kept only
 * for backward-compatibility with a few older test files that still
 * import it. Calling it is now a no-op.
 */
export function setupSchema(_db: ReturnType<typeof drizzle>) {
    // No-op: the real work happens in applyMigrations() which is called
    // by createTestDb() (and by the production initDb path).
}