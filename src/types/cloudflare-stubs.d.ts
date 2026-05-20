/**
 * Minimal portable type stubs for Cloudflare-specific globals.
 * These allow the project to compile after removing @cloudflare/workers-types.
 * They will be replaced with proper portable implementations in Phase 3.
 */

declare global {
    // Execution context (no-op in portable server)
    type ExecutionContext = {
        waitUntil(promise: Promise<unknown>): void;
        passThroughOnException(): void;
    };

    // Scheduled event (cron triggers — replaced by node-cron or external scheduler)
    type ScheduledEvent = {
        scheduledTime: number;
        cron: string;
    };

    // D1 types (replaced by better-sqlite3)
    type D1Result<T = unknown> = { results: T[]; success: boolean; meta: D1Meta };
    type D1Meta = { duration: number; size_after: number; rows_read: number; rows_written: number };
    type D1PreparedStatement = {
        bind(...values: unknown[]): D1PreparedStatement;
        first<T = unknown>(colName?: string): Promise<T | null>;
        run(): Promise<D1Result>;
        all<T = unknown>(): Promise<D1Result<T>>;
    };
    type D1ExecResult = { count: number; duration: number };

    // Fetcher (Cloudflare Browser Rendering / Service Bindings)
    // Portable replacement will be added in Phase 3. Use any for transitional compatibility.
    type Fetcher = any;

    // Workflow types (Phase 3)
    type Workflow = any;
}

export {};
