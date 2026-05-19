import DatabaseConstructor from 'better-sqlite3';
export type SqliteDb = InstanceType<typeof DatabaseConstructor>;
export { DatabaseConstructor }; // Re-export for creating instances
