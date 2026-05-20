/**
 * PDF generation helper for inspection reports (portable).
 *
 * Uses an injected PdfRenderer (Puppeteer/Playwright in Docker, or undefined
 * for local dev). When no renderer is configured, callers must fall back to
 * client-side window.print() or text-only email.
 */

export interface PdfRenderer {
    generatePdfFromUrl(url: string): Promise<ArrayBuffer>;
}



/**
 * Default no-op renderer that always throws.
 * Used when BROWSER / Puppeteer is not configured.
 */
export class NoopPdfRenderer implements PdfRenderer {
    async generatePdfFromUrl(_url: string): Promise<ArrayBuffer> {
        throw new Error('PDF generation unavailable: no PdfRenderer configured (Puppeteer/Playwright not available)');
    }
}

/**
 * Generates a PDF from a public report URL using the provided renderer.
 * Throws a clear error if the renderer is not available.
 */
export async function generatePdfFromUrl(
    renderer: PdfRenderer | undefined,
    url: string,
): Promise<ArrayBuffer> {
    const r = renderer ?? new NoopPdfRenderer();
    return r.generatePdfFromUrl(url);
}
