/**
 * Bot protection verification (portable).
 *
 * Supports multiple providers via the verify URL.
 * Default: Cloudflare Turnstile
 * Others: reCAPTCHA, hCaptcha
 */
export async function verifyBotProtection(
    token: string,
    secretKey: string,
    verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
): Promise<boolean> {
    if (!secretKey) throw new Error('Bot protection secret key is not configured');

    const body = new FormData();
    body.append('secret', secretKey);
    body.append('response', token);

    const res = await fetch(verifyUrl, {
        method: 'POST',
        body,
    });

    if (!res.ok) return false;

    const data = await res.json() as { success: boolean };
    return data.success;
}

/** Backward-compatible alias for Turnstile */
export const verifyTurnstile = verifyBotProtection;


