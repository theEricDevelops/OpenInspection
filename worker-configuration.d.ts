/* eslint-disable */
// Placeholder types for Cloudflare-specific bindings.
// These are referenced by code that will be migrated in Phase 2/3.
// TODO: Replace with portable abstractions per docs/cloudflare-migration-plan.md

interface WorkflowEvent<P = unknown> {
  type: 'workflow';
  instanceId: string;
  payload: P;
  timestamp: Date;
}

interface WorkflowStep {
  do(name: string, handler: () => Promise<unknown>): Promise<unknown>;
}

interface Workflow<P = unknown> {
  create(params: { id?: string; params: P }): Promise<{ id: string }>;
}

declare module 'cloudflare:workers' {
  export class WorkflowEntrypoint<E = unknown, P = unknown> {
    protected env: E;
    constructor(ctx: unknown, env: E);
    run(event: { type: 'workflow'; instanceId: string; payload: P; timestamp: Date }, steps: { do<T = unknown>(...args: unknown[]): Promise<T> }): Promise<unknown>;
  }
  export type WorkflowStep = { do<T = unknown>(...args: unknown[]): Promise<T> };
  export type WorkflowEvent<P = unknown> = { type: 'workflow'; instanceId: string; payload: P; timestamp: Date };
}

interface R2Objects {
  objects: { key: string; uploaded: Date; size: number; etag: string }[];
  truncated: boolean;
  cursor?: string;
}

type R2ListResult = R2Objects;

interface R2ObjectBody {
  body: ReadableStream;
  httpEtag?: string;
  writeHttpMetadata(headers: Headers): void;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: unknown, opts?: unknown): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  delete(keys: string[]): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<R2ListResult>;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  get<T = unknown>(key: string, type: 'text'): Promise<string | null>;
  get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
  get<T = unknown>(key: string, opts: { type: 'text' }): Promise<string | null>;
  get<T = unknown>(key: string, opts: { type: 'json' }): Promise<T | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface D1Meta {
  duration: number;
  changes: number;
  last_row_id: number;
  served_by: string;
  size_after: number;
  rows_read: number;
  rows_written: number;
}

interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta?: D1Meta;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(col?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[][]>;
}

interface D1ExecResult {
  count: number;
  duration: number;
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  dump(): Promise<ArrayBuffer>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(sql: string): Promise<D1ExecResult>;
}

interface ScheduledEvent {
  type: 'scheduled';
  scheduledTime: number;
  cron: string;
}
