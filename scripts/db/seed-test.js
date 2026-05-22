#!/usr/bin/env node
/**
 * db:seed:test
 *
 * Produces a fully migrated + seeded SQLite database suitable for
 * `docker build --target test` (or local "batteries-included" testing).
 * The clean production image is built with `--target prod`.
 *
 * It starts a temporary server (via tsx on src/server.ts when available,
 * falling back to the compiled dist/... entry) so that the *real*
 * /api/auth/setup handler runs. This guarantees the seeded data exactly
 * matches what a real first-run user receives via the setup wizard:
 *   - Initial tenant + admin user (PBKDF2 hashed password)
 *   - Auto-seeded recommendation library
 *   - Auto-seeded event types (Spec 4D)
 *   - 6 default inspection templates (Spec 4F)
 *
 * Requirements:
 *   - Dev dependencies must be present (tsx) so we can boot the real server.ts.
 *     A prior `npm run build` is no longer strictly required for seeding.
 *
 * Usage:
 *   DB_PATH=data/test.db npm run db:seed:test
 *   node scripts/db/seed-test.js
 *
 * Override credentials / tenant via env vars:
 *   TEST_COMPANY_NAME, TEST_ADMIN_NAME, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD
 *
 * Default login after seeding:
 *   email:    admin@test.local
 *   password: TestPass123!
 *
 * The script is idempotent: if the DB already contains tenant users, the
 * setup call returns 409 and we still perform the WAL checkpoint + shutdown.
 */

import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { setTimeout as sleep } from 'timers/promises';

const PORT = Number(process.env.TEST_PORT || process.env.PORT || 9876);
const DB_PATH = process.env.DB_PATH || resolve(process.cwd(), 'data/test.db');
const DATA_DIR = dirname(DB_PATH);

const PAYLOAD = {
  companyName: process.env.TEST_COMPANY_NAME || 'Docker Test Co',
  adminName: process.env.TEST_ADMIN_NAME || 'Test Admin',
  email: process.env.TEST_ADMIN_EMAIL || 'admin@test.local',
  password: process.env.TEST_ADMIN_PASSWORD || 'TestPass123!',
};

async function waitForServer(maxSeconds = 90) {
  for (let i = 1; i <= maxSeconds; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/status`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        console.log(`[seed-test] Server ready after ${i}s`);
        return true;
      }
    } catch {
      // connection refused, timeout, or other transient error — keep polling
    }
    await sleep(1000);
  }
  return false;
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  // Prefer tsx + the real TypeScript source for the temporary server.
  // This avoids ESM extension-resolution problems in the current tsc output
  // and guarantees we run the exact same code as `npm run dev`.
  const tsxBin = resolve(process.cwd(), 'node_modules/.bin/tsx');
  const useTsx = existsSync(tsxBin);

  const cmd = useTsx ? tsxBin : 'node';
  const args = useTsx
    ? ['src/server.ts']
    : (existsSync('dist/server.js')
        ? ['dist/server.js']
        : existsSync('dist/src/server.js')
          ? ['dist/src/server.js']
          : null);

  if (!args) {
    console.error('[seed-test] ERROR: no runnable server entry found (need tsx or a built dist/).');
    console.error('            Run `npm ci` (for tsx) or `npm run build`, then retry.');
    process.exit(1);
  }

  console.log(`[seed-test] Launching temporary server (port=${PORT}, db=${DB_PATH}, via=${useTsx ? 'tsx' : 'node ' + args[0]}) ...`);

  const env = {
    ...process.env,
    PORT: String(PORT),
    DB_PATH,
    JWT_SECRET:
      process.env.JWT_SECRET ||
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    APP_MODE: process.env.APP_MODE || 'standalone',
    STORAGE_DIR: process.env.STORAGE_DIR || resolve(DATA_DIR, 'storage'),
    // Ensure verification is skipped (no SETUP_CODE means the handler does not require it)
    SETUP_CODE: '',
  };

  const server = spawn(cmd, args, {
    env,
    stdio: 'pipe',
    cwd: process.cwd(),
  });

  // Forward server stdout/stderr so that `docker build` (and local runs) show
  // any startup errors, migration logs, or structured output from the app.
  server.stdout.on('data', (chunk) => process.stdout.write(`[srv] ${chunk}`));
  server.stderr.on('data', (chunk) => process.stderr.write(`[srv] ${chunk}`));

  server.on('error', (err) => {
    console.error('[seed-test] Failed to spawn server process:', err);
    process.exit(1);
  });

  let serverExitedEarly = false;
  server.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.warn(`[seed-test] Server process exited early (code=${code}, signal=${signal})`);
      serverExitedEarly = true;
    }
  });

  const ready = await waitForServer(90);
  if (!ready) {
    console.error('[seed-test] TIMEOUT: server never responded to /status within 90s');
    server.kill('SIGTERM');
    process.exit(1);
  }
  if (serverExitedEarly) {
    console.error('[seed-test] Server died before seeding could complete.');
    process.exit(1);
  }

  console.log('[seed-test] POST /api/auth/setup (creates tenant + admin + triggers auto-seed)...');
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(PAYLOAD),
      signal: AbortSignal.timeout(30000),
    });
    const bodyText = await res.text().catch(() => '');
    if (res.status === 200) {
      console.log('[seed-test] Setup completed successfully (new workspace initialized).');
    } else if (res.status === 409) {
      console.log('[seed-test] Setup skipped — database was already initialized (idempotent).');
    } else {
      console.warn(`[seed-test] Setup returned unexpected status ${res.status}: ${bodyText}`);
    }
  } catch (err) {
    console.warn(`[seed-test] Setup POST error (non-fatal, will still checkpoint): ${err.message}`);
  }

  // Checkpoint regardless of whether this was a fresh seed or a no-op.
  console.log('[seed-test] Checkpointing WAL for clean .db file...');
  try {
    // Use dynamic import so the script has zero static dependencies beyond Node core
    // (better-sqlite3 is already present in both dev and the Docker seeder image).
    const mod = await import('better-sqlite3');
    const Database = mod.default || mod;
    const db = new Database(DB_PATH);
    db.pragma('wal_checkpoint(FULL)');
    db.close();
    console.log('[seed-test] WAL checkpoint completed.');
  } catch (err) {
    console.warn(`[seed-test] WAL checkpoint warning (non-fatal): ${err.message}`);
  }

  console.log('[seed-test] Gracefully stopping temporary server...');
  server.kill('SIGTERM');

  // Allow a short grace period for the Hono server to close connections.
  await sleep(1500);
  if (!server.killed) {
    server.kill('SIGKILL');
  }

  console.log(`[seed-test] ✅ Seeded database is ready at ${DB_PATH}`);
  console.log(`[seed-test] Default credentials: ${PAYLOAD.email} / ${PAYLOAD.password}`);
  console.log('[seed-test] You can now run the app with DB_PATH pointed at this file.');
}

main().catch((err) => {
  console.error('[seed-test] Unhandled error:', err);
  process.exit(1);
});
