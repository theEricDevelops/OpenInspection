import { initDb } from '../../src/lib/db';
import { resolve } from 'path';

/**
 * db:build
 * Creates (or migrates) the SQLite database file at DB_PATH (or the default
 * data/openinspection.db) by calling the same initDb() path used by the
 * production server and the test helper.
 *
 * This is intentionally a separate step from "start the dev server" so that
 * `npm run db:reset` can produce a fully migrated, ready-to-use database file
 * without launching the HTTP server.
 */
const dbPath = process.env.DB_PATH || resolve(process.cwd(), 'data/openinspection.db');

console.log(`[db:build] Ensuring database exists and is up-to-date at ${dbPath} ...`);

initDb(dbPath);

console.log(`✅ Database built successfully at ${dbPath} (all migrations applied).`);
