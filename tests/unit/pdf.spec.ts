import { describe, it, expect, vi } from 'vitest';
import { generatePdfFromUrl } from '../../src/lib/pdf';

describe('generatePdfFromUrl', () => {
    it('returns ArrayBuffer when PdfRenderer renders successfully', async () => {
        const fakePdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer; // "%PDF" magic
        const renderer = {
            generatePdfFromUrl: vi.fn().mockResolvedValue(fakePdfBytes),
        };
        const url = 'https://example.com/report/abc';

        const result = await generatePdfFromUrl(renderer, url);

        expect(result).toBeInstanceOf(ArrayBuffer);
        expect(result.byteLength).toBe(4);
        expect(renderer.generatePdfFromUrl).toHaveBeenCalledWith(url);
    });

    it('throws when PdfRenderer is undefined', async () => {
        await expect(generatePdfFromUrl(undefined, 'https://example.com')).rejects.toThrow(/no PdfRenderer configured/i);
    });

    it('throws when PdfRenderer rejects', async () => {
        const renderer = {
            generatePdfFromUrl: vi.fn().mockRejectedValue(new Error('PDF rendering failed: quota exceeded')),
        };
        await expect(generatePdfFromUrl(renderer, 'https://example.com'))
            .rejects.toThrow(/PDF rendering failed/i);
    });
});
