import { generatePdfFromUrl, type PdfRenderer } from '../lib/pdf';
import type { SqliteDb } from '../types/db';

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

export async function runSignCompletion(
    params: SignCompletionParams,
    env: EnvLike,
    pdfRenderer?: PdfRenderer,
): Promise<void> {
    const { requestId, token } = params;
    const renderer = pdfRenderer ?? env.PDF_RENDERER;

    const baseUrl = env.APP_BASE_URL || 'http://localhost:8788';

    // Step 1: Render signed PDF
    const signedMeta = await withRetry(async () => {
        if (!renderer) throw new Error('No PDF renderer');
        const buffer = await generatePdfFromUrl(renderer, `${baseUrl}/m2m/agreement-render/${token}`);
        // In a real impl we would store to storage here. For now we just generate.
        return { sha256: 'placeholder', size: buffer.byteLength };
    }, 'render-signed-pdf');

    // Step 2: Render certificate PDF (placeholder for now)
    const certMeta = await withRetry(async () => {
        if (!renderer) throw new Error('No PDF renderer');
        const buffer = await generatePdfFromUrl(renderer, `${baseUrl}/m2m/certificate/${token}`);
        return { sha256: 'placeholder', size: buffer.byteLength };
    }, 'render-certificate-pdf');

    // Step 3: Append workflow.complete audit row (best effort)
    // Note: Full AuditLogService requires SigningKeyService; simplified logging for now
    console.info('[sign-completion] workflow.complete', { requestId, signedMeta, certMeta });
}
