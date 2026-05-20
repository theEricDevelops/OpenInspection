import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';
import { Errors } from './errors';

/**
 * Rate limiting helper using a portable IP header.
 * Prefers X-Forwarded-For (first value), falls back to X-Real-IP.
 */
export async function checkRateLimit(c: Context<HonoConfig>, prefix: string): Promise<void> {
    if (!c.env.RATE_LIMITER) return;

    const forwarded = c.req.header('X-Forwarded-For');
    const realIp = c.req.header('X-Real-IP');
    const ip = forwarded?.split(',')[0].trim() || realIp || 'unknown';

    const { success } = await c.env.RATE_LIMITER.limit({ key: `${prefix}:${ip}` });
    if (!success) throw Errors.RateLimited();
}
