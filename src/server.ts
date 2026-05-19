import 'dotenv/config';
import { serve } from '@hono/node-server';
import { DatabaseConstructor } from './types/db';
import type { SqliteDb } from './types/db';
import { app } from './index';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = parseInt(process.env.PORT || '8788', 10);
const DB_PATH = process.env.DB_PATH || ':memory:';
const __dirname = fileURLToPath(new URL('.', import.meta.url));

function initDatabase(): SqliteDb {
    const sqlite = new DatabaseConstructor(DB_PATH);
    sqlite.pragma('journal_mode = WAL');
    sqlite.exec(`CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    const migrationsDir = resolve(__dirname, '../migrations');
    if (existsSync(migrationsDir)) {
        const files = readdirSync(migrationsDir).sort();
        for (const file of files) {
            if (file.endsWith('.sql')) {
                const already = sqlite.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(file);
                if (already) continue;
                const migration = readFileSync(resolve(migrationsDir, file), 'utf8');
                sqlite.exec(migration);
                sqlite.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
            }
        }
    }
    return sqlite;
}

const db = initDatabase();
const env = {
    ...process.env,
    DB: db,
} as Record<string, unknown>;

const executionCtx = {
    waitUntil: (_promise: Promise<unknown>) => { /* no-op */ },
    passThroughOnException: () => { /* no-op */ },
} as any;

serve(
    {
        fetch: (req) => app.fetch(req, env, executionCtx),
        port: PORT,
    },
    (info) => {
        console.log(`OpenInspection server running on http://localhost:${info.port}`);
    },
);
