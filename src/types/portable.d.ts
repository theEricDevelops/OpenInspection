export interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void;
    passThroughOnException(): void;
    /**
     * For compatibility with Wrangler 4.x / Hono.
     */
    props: any;
    /**
     * For compatibility with Wrangler 4.x / Hono.
     */
    exports?: any;
}

export interface ScheduledEvent {
    cron: string;
}
