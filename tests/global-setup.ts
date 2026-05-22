import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Playwright globalSetup — runs once before the test suite.
 *
 * Clears all rows from every table in the local SQLite database so that
 * POST /setup always returns 200 (fresh workspace) and every test
 * that requires a real token runs instead of being skipped.
 *
 * Uses better-sqlite3 directly.
 */
export default function globalSetup() {
    const appDir = path.resolve(__dirname, '..');
    const dbPath = path.resolve(appDir, 'test-e2e.db');

    // Delete in FK-safe order (child tables first)
    const tables = [
        'audit_logs',
        'inspection_agreements',
        'inspection_results',
        'inspections',
        'availability_overrides',
        'availability',
        'tenant_invites',
        'agreements',
        'templates',
        'users',
        'tenant_configs',
        'tenants',
    ];

    try {
        const db = new Database(dbPath);

        // Clear all data rows one table at a time (schema stays intact)
        for (const table of tables) {
            try {
                db.exec(`DELETE FROM ${table}`);
            } catch {
                // Table may not exist in older migrations — skip
            }
        }

        db.close();

        // MemoryCache is per-process, so nothing to clear for KV equivalent

        console.info('\n[globalSetup] Local SQLite cleared — all tests will run against a fresh workspace.\n');
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
            `\n[globalSetup] WARNING: Could not reset local SQLite (${msg.split('\n')[0]}).\n`,
        );
    }
}
