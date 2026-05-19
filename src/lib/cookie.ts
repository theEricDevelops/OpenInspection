import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';

const PROD_COOKIE = '__Host-inspector_token';
const DEV_COOKIE = 'inspector_token';

function isHttps(c: Context<HonoConfig>): boolean {
    const proto = c.req.header('x-forwarded-proto') || '';
    return proto === 'https' || c.req.url.startsWith('https');
}

export function authCookieName(c: Context<HonoConfig>): string {
    return isHttps(c) ? PROD_COOKIE : DEV_COOKIE;
}

export function authCookieOptions(c: Context<HonoConfig>) {
    const secure = isHttps(c);
    return {
        httpOnly: true,
        secure,
        sameSite: 'Strict' as const,
        path: '/',
        maxAge: 60 * 60 * 24,
    };
}

export function deleteAuthCookieOptions(c: Context<HonoConfig>) {
    const secure = isHttps(c);
    return {
        path: '/' as const,
        secure,
        sameSite: 'Strict' as const,
    };
}
