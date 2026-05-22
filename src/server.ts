import 'dotenv/config';
import { serve } from '@hono/node-server';
import { app } from './index';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { LocalStorage } from './lib/storage';
import { MemoryCache } from './lib/cache';
import { PuppeteerPdfRenderer } from './lib/pdf-puppeteer';
import cron from 'node-cron';
import { logger } from './lib/logger';
import type { ExecutionContext, ScheduledEvent } from './types/portable';
import type { AppEnv } from './types/hono';
import { initDb } from './lib/db';

const PORT = parseInt(process.env.PORT || '8788', 10);
const DB_PATH = process.env.DB_PATH || resolve(process.cwd(), 'data/openinspection.db');
const STORAGE_DIR = process.env.STORAGE_DIR || resolve(process.cwd(), 'data/storage');

const db = initDb(DB_PATH);
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

const executionCtx: ExecutionContext = {
    waitUntil: (_promise: Promise<unknown>) => { /* no-op */ },
    passThroughOnException: () => { /* no-op */ },
    props: {},
};

serve(
    {
        fetch: (req) => app.fetch(req, env, executionCtx),
        port: PORT,
    },
    (info) => {
        logger.info(`OpenInspection server running on http://localhost:${info.port}`);

        // Phase 4d — Portable cron jobs using node-cron
        // QBO CDC sync (hourly)
        cron.schedule('0 * * * *', async () => {
            try {
                const { scheduled } = await import('./scheduled');
                await scheduled({} as ScheduledEvent, env as unknown as AppEnv, executionCtx);
            } catch (e) {
                logger.error('[cron] scheduled job failed', {}, e instanceof Error ? e : new Error(String(e)));
            }
        });

        logger.info('[cron] Scheduled jobs initialized (node-cron)');
    },
);
