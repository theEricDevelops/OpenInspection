import DatabaseConstructor from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import type { SqliteDb } from '../../types/db';

let _db: SqliteDb | null = null;

export function initDb(dbPath?: string): SqliteDb {
    _db = new DatabaseConstructor(dbPath ?? ':memory:');
    _db.pragma('journal_mode = WAL');
    return _db;
}

export function getDb(): SqliteDb {
    if (!_db) {
        throw new Error('Database not initialized. Call initDb() first.');
    }
    return _db;
}

export function getDrizzle() {
    return drizzle(getDb(), { schema });
}
