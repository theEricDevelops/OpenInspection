import { generatePdfFromUrl, type PdfRenderer } from '../lib/pdf';
import type { SqliteDb } from '../types/db';
import { ObjectStorage } from '../lib/storage';
import { SigningKeyService } from '../services/signing-key.service';
import { AuditLogService } from '../services/audit-log.service';

/**
 * Portable replacement for the Cloudflare Workflow.
 * Performs the same three steps with simple retry logic.
 */

export interface SignCompletionParams {
    requestId: string;
    tenantId: string;
    token: string;
}

interface EnvLike {
    DB: SqliteDb;
    PDF_RENDERER?: PdfRenderer;
    APP_BASE_URL?: string;
    PHOTOS?: ObjectStorage;
    REPORTS?: ObjectStorage;
    JWT_SECRET?: string;
    KEY_ENCRYPTION_SECRET?: string;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function withRetry<T>(
    fn: () => Promise<T>,
    label: string,
    retries = 2,
): Promise<T | null> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (e) {
            console.warn(`[sign-completion] ${label} failed (attempt ${attempt + 1})`, (e as Error).message);
            if (attempt === retries) return null;
            await sleep(1000 * Math.pow(2, attempt)); // exponential backoff
        }
    }
    return null;
}

async function renderPdfToStorage(env: EnvLike, opts: { renderUrl: string; storageKey: string }): Promise<{ sha256: string; sizeBytes: number }> {
    const storage = env.REPORTS || env.PHOTOS;
    if (!storage) throw new Error('No object storage configured for PDF reports');

    const buffer = await generatePdfFromUrl(env.PDF_RENDERER!, opts.renderUrl);
    const bytes = new Uint8Array(buffer);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer));
    const sha256 = Array.from(hash).map((b) => b.toString(16).padStart(2, '0')).join('');

    await storage.put(opts.storageKey, bytes, {
        httpMetadata: { contentType: 'application/pdf' },
        customMetadata: { sha256 },
    });

    return { sha256, sizeBytes: bytes.byteLength };
}

export async function runSignCompletion(
    params: SignCompletionParams,
    env: EnvLike,
    pdfRenderer?: PdfRenderer,
): Promise<void> {
    const { requestId, tenantId, token } = params;
    const renderer = pdfRenderer ?? env.PDF_RENDERER;
    if (!renderer) {
        console.warn('[sign-completion] No PDF renderer available; skipping PDF generation');
        return;
    }

    const baseUrl = env.APP_BASE_URL || 'http://localhost:8788';

    // Step 1: Render signed PDF
    const signedMeta = await withRetry(async () => {
        return await renderPdfToStorage(env, {
            renderUrl: `${baseUrl}/m2m/agreement-render/${token}`,
            storageKey: `tenants/${tenantId}/agreements/${requestId}/signed.pdf`,
        });
    }, 'render-signed-pdf');

    // Step 2: Render certificate PDF
    const certMeta = await withRetry(async () => {
        return await renderPdfToStorage(env, {
            renderUrl: `${baseUrl}/m2m/cert-render/${token}`,
            storageKey: `tenants/${tenantId}/agreements/${requestId}/certificate.pdf`,
        });
    }, 'render-certificate-pdf');

    // Step 3: Append workflow.complete audit row
    try {
        const signing = new SigningKeyService(env.DB, env.KEY_ENCRYPTION_SECRET || env.JWT_SECRET || '');
        const auditLog = new AuditLogService(env.DB, signing);
        await auditLog.append(tenantId, requestId, 'workflow.complete', {
            certPdfHash: certMeta ? `sha256:${certMeta.sha256}` : null,
            envelopeId: requestId,
            evidenceZipHash: null,
            pdfRenderStatus: signedMeta && certMeta ? 'ok' : 'failed_pdf_render',
            signedPdfHash: signedMeta ? `sha256:${signedMeta.sha256}` : null,
            tsMs: Date.now(),
        });
    } catch (e) {
        console.error('[sign-completion] Failed to append workflow.complete audit row', (e as Error).message);
    }
}
