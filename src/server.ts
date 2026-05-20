import 'dotenv/config';
import { serve } from '@hono/node-server';
import { DatabaseConstructor } from './types/db';
import type { SqliteDb } from './types/db';
import { app } from './index';
import { readdirSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalStorage } from './lib/storage';
import { MemoryCache } from './lib/cache';
import { PuppeteerPdfRenderer } from './lib/pdf-puppeteer';
import cron from 'node-cron';

const PORT = parseInt(process.env.PORT || '8788', 10);
const DB_PATH = process.env.DB_PATH || resolve(process.cwd(), 'data/openinspection.db');
const STORAGE_DIR = process.env.STORAGE_DIR || resolve(process.cwd(), 'data/storage');
const __dirname = fileURLToPath(new URL('.', import.meta.url));

function initDatabase(): SqliteDb {
    const dbDir = resolve(dirname(DB_PATH));
    if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true });
    }
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
if (!existsSync(STORAGE_DIR)) {
    mkdirSync(STORAGE_DIR, { recursive: true });
}
const storage = new LocalStorage(STORAGE_DIR);
const tenantCache = new MemoryCache();
const env = {
    ...process.env,
    DB: db,
    PHOTOS: storage,
    REPORTS: storage,
    PHOTO_BUCKET: storage,
    TENANT_CACHE: tenantCache,
    PDF_RENDERER: process.env.PUPPETEER_ENABLED === 'true' ? new PuppeteerPdfRenderer() : undefined,
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

        // Phase 4d — Portable cron jobs using node-cron
        // QBO CDC sync (hourly)
        cron.schedule('0 * * * *', async () => {
            try {
                const { scheduled } = await import('./scheduled');
                await scheduled({} as any, env as any, {} as any);
            } catch (e) {
                console.error('[cron] scheduled job failed', e);
            }
        });

        console.log('[cron] Scheduled jobs initialized (node-cron)');
    },
);
