import { existsSync, rmSync } from 'fs';
import { resolve } from 'path';

/**
 * db:delete
 * Removes the local SQLite database files (the main .db file plus the
 * associated -wal and -shm files used by WAL mode).
 *
 * Respects the DB_PATH environment variable, falling back to the same
 * default used by the server and db:build.
 *
 * This is intentionally a separate command so that `db:reset` can be
 * composed cleanly as `db:delete && db:build`.
 */
const base = process.env.DB_PATH || resolve(process.cwd(), 'data/openinspection.db');

console.log(`[db:delete] Removing database files for ${base} ...`);

let deleted = 0;
['', '-wal', '-shm'].forEach(ext => {
    const f = base + ext;
    if (existsSync(f)) {
        rmSync(f);
        console.log(`  Deleted ${f}`);
        deleted++;
    }
});

if (deleted === 0) {
    console.log('  (no database files found)');
} else {
    console.log(`✅ Removed ${deleted} database file(s).`);
}
