/**
 * Entry point for the database layer.
 *
 * Prefer importing operational functions and types from here:
 *
 *   import { initDb, applyMigrations, getDb, getDrizzle, ScopedDB } from '../lib/db';
 *   import * as schema from '../lib/db/schema';   // or from here if you prefer
 *
 * The schema tables are also re-exported as `schema` for convenience.
 */

// Operational DB lifecycle (used by server, tests, and scripts/db/*)
export { initDb, applyMigrations, getDb, getDrizzle } from './init';

// Tenant-scoped query helper (Fail-Closed security model)
export { ScopedDB, type DrizzleDB } from './scoped';

// Re-export the entire schema namespace for ergonomic imports
export * as schema from './schema';

// Convenience type alias for the raw better-sqlite3 instance
export type { SqliteDb } from '../../types/db';
