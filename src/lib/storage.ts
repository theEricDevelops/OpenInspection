import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { S3ClientConfig } from '@aws-sdk/client-s3';

export interface StorageObject {
    body: ReadableStream;
    httpEtag?: string;
    writeHttpMetadata(headers: Headers): void;
}

export interface StorageListResult {
    objects: { key: string; uploaded: Date; size: number; etag: string }[];
    truncated: boolean;
    cursor?: string;
}

export interface ObjectStorage {
    get(key: string): Promise<StorageObject | null>;
    put(key: string, data: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<void>;
    delete(key: string): Promise<void>;
    delete(keys: string[]): Promise<void>;
    list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<StorageListResult>;
}

export class LocalStorage implements ObjectStorage {
    private baseDir: string;

    constructor(baseDir: string) {
        this.baseDir = resolve(baseDir);
        mkdirSync(this.baseDir, { recursive: true });
    }

    private filePath(key: string): string {
        const safe = join(this.baseDir, ...key.split('/').filter(Boolean));
        const dir = safe.substring(0, safe.lastIndexOf(sep));
        mkdirSync(dir, { recursive: true });
        return safe;
    }

    async get(key: string): Promise<StorageObject | null> {
        try {
            const path = this.filePath(key);
            if (!existsSync(path)) return null;
            const stat = statSync(path);
            const etag = `"${stat.mtimeMs.toString(16)}-${stat.size.toString(16)}"`;
            const body = createReadStream(path) as unknown as ReadableStream;
            const contentType = key.endsWith('.pdf') ? 'application/pdf'
                : key.endsWith('.png') ? 'image/png'
                : key.endsWith('.jpg') || key.endsWith('.jpeg') ? 'image/jpeg'
                : key.endsWith('.gif') ? 'image/gif'
                : key.endsWith('.webp') ? 'image/webp'
                : key.endsWith('.svg') ? 'image/svg+xml'
                : 'application/octet-stream';
            const cnt = contentType;
            return {
                body,
                httpEtag: etag,
                writeHttpMetadata(headers: Headers) {
                    headers.set('content-type', cnt);
                    headers.set('content-length', String(stat.size));
                    headers.set('etag', etag);
                },
            };
        } catch {
            return null;
        }
    }

    async put(key: string, data: ArrayBuffer | Uint8Array, _opts?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<void> {
        const path = this.filePath(key);
        writeFileSync(path, Buffer.from(data as ArrayBuffer));
    }

    async delete(keyOrKeys: string | string[]): Promise<void> {
        const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
        for (const key of keys) {
            try {
                const path = this.filePath(key);
                if (existsSync(path)) unlinkSync(path);
            } catch {
                // non-critical
            }
        }
    }

    async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<StorageListResult> {
        const prefix = options?.prefix ?? '';
        const limit = options?.limit ?? 1000;
        const startDir = prefix ? join(this.baseDir, ...prefix.split('/').filter(Boolean)) : this.baseDir;
        const objects: StorageListResult['objects'] = [];
        let count = 0;

        const walk = (dir: string, basePath: string) => {
            if (count >= limit) return;
            let entries: string[];
            try {
                entries = readdirSync(dir, { withFileTypes: true }).map(d => d.name);
            } catch {
                return;
            }
            for (const entry of entries.sort()) {
                if (count >= limit) return;
                const full = join(dir, entry);
                const rel = join(basePath, entry);
                try {
                    const st = statSync(full);
                    if (st.isDirectory()) {
                        walk(full, rel);
                    } else {
                        objects.push({
                            key: rel.replace(/\\/g, '/'),
                            uploaded: st.mtime,
                            size: st.size,
                            etag: `"${st.mtimeMs.toString(16)}-${st.size.toString(16)}"`,
                        });
                        count++;
                    }
                } catch {
                    // skip inaccessible
                }
            }
        };

        walk(startDir, prefix);
        return { objects, truncated: count >= limit, cursor: undefined } as unknown as StorageListResult;
    }
}

export class S3Storage implements ObjectStorage {
    private s3Client: unknown;
    private bucket: string;
    private region: string;
    private endpoint: string | undefined;
    private credentials: { accessKeyId: string; secretAccessKey: string } | undefined;

    constructor(bucket: string, region: string, opts?: { endpoint?: string; accessKeyId?: string; secretAccessKey?: string }) {
        this.bucket = bucket;
        this.region = region;
        this.endpoint = opts?.endpoint;
        if (opts?.accessKeyId) {
            this.credentials = { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey ?? '' };
        }
    }

    private async client(): Promise<import('@aws-sdk/client-s3').S3Client> {
        if (!this.s3Client) {
            const { S3Client } = await import('@aws-sdk/client-s3');
            const config: S3ClientConfig = { region: this.region };
            if (this.endpoint) config.endpoint = this.endpoint;
            if (this.credentials) config.credentials = this.credentials;
            this.s3Client = new S3Client(config);
        }
        return this.s3Client as import('@aws-sdk/client-s3').S3Client;
    }

    async get(key: string): Promise<StorageObject | null> {
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        try {
            const s3 = await this.client();
            const result = await s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
            if (!result.Body) return null;
            const body = result.Body.transformToWebStream() as ReadableStream;
            const etag = result.ETag;
            const contentType = result.ContentType ?? 'application/octet-stream';
            const contentLength = result.ContentLength;
            return {
                body,
                httpEtag: etag ?? undefined,
                writeHttpMetadata(headers: Headers) {
                    headers.set('content-type', contentType);
                    if (contentLength !== undefined) headers.set('content-length', String(contentLength));
                    if (etag) headers.set('etag', etag);
                },
            };
        } catch {
            return null;
        }
    }

    async put(key: string, data: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<void> {
        const { PutObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = await this.client();
        await s3.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: Buffer.from(data as ArrayBuffer),
            ContentType: opts?.httpMetadata?.contentType,
            Metadata: opts?.customMetadata,
        }));
    }

    async delete(keyOrKeys: string | string[]): Promise<void> {
        const { DeleteObjectCommand, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
        const s3 = await this.client();
        const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
        if (keys.length === 1) {
            await s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: keys[0] })).catch(() => {});
        } else {
            await s3.send(new DeleteObjectsCommand({
                Bucket: this.bucket,
                Delete: { Objects: keys.map(k => ({ Key: k })) },
            })).catch(() => {});
        }
    }

    async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<StorageListResult> {
        const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
        const s3 = await this.client();
        const result = await s3.send(new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: options?.prefix,
            MaxKeys: options?.limit ?? 1000,
            ContinuationToken: options?.cursor,
        }));
        return {
            objects: (result.Contents ?? []).map((o) => ({
                key: o.Key ?? '',
                uploaded: o.LastModified ?? new Date(0),
                size: o.Size ?? 0,
                etag: o.ETag ?? '',
            })),
            truncated: result.IsTruncated ?? false,
            cursor: undefined,
        } as unknown as StorageListResult;
    }
}
