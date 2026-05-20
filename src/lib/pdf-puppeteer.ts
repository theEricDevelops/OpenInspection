import type { PdfRenderer } from './pdf';
import puppeteer, { Browser, Page } from 'puppeteer';

/**
 * Puppeteer-based PDF renderer (portable replacement for Cloudflare Browser Rendering).
 *
 * Usage in server.ts:
 *   import { PuppeteerPdfRenderer } from './lib/pdf-puppeteer';
 *   const pdfRenderer = process.env.PUPPETEER_ENABLED === 'true'
 *       ? new PuppeteerPdfRenderer()
 *       : undefined;
 */
export class PuppeteerPdfRenderer implements PdfRenderer {
    private browser: Browser | null = null;

    private async getBrowser(): Promise<Browser> {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu',
                ],
            });
        }
        return this.browser;
    }

    async generatePdfFromUrl(url: string): Promise<ArrayBuffer> {
        const browser = await this.getBrowser();
        const page: Page = await browser.newPage();

        try {
            // Append print-mode hint
            const renderUrl = url.includes('?') ? `${url}&print=1` : `${url}?print=1`;

            await page.goto(renderUrl, {
                waitUntil: 'networkidle0',
                timeout: 30_000,
            });

            const pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: true,
                margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
            });

            // Convert Uint8Array to ArrayBuffer
            return pdfBuffer.buffer.slice(
                pdfBuffer.byteOffset,
                pdfBuffer.byteOffset + pdfBuffer.byteLength,
            ) as ArrayBuffer;
        } finally {
            await page.close();
        }
    }

    async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}
