import { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { HonoConfig } from '../../types/hono';
import { Errors } from '../errors';
import { timingSafeEqual } from '../password';

const CSRF_HEADER = 'x-csrf-token';
const CSRF_TTL_SECONDS = 60 * 60 * 24;

const DEV_CSRF_COOKIE = 'csrf_token';
const PROD_CSRF_COOKIE = '__Host-csrf_token';

export function csrfCookieName(c: Parameters<MiddlewareHandler<HonoConfig>>[0]): string {
    const proto = c.req.header('x-forwarded-proto') || c.req.header('cf-visibility') || '';
    const isHttps = proto === 'https' || c.req.url.startsWith('https');
    return isHttps ? PROD_CSRF_COOKIE : DEV_CSRF_COOKIE;
}

/** Random 128-bit token, hex-encoded. */
function generateCsrfToken(): string {
    const buf = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Issue (or refresh) the CSRF token cookie. Call this on any HTML page that renders a form
 * posting to a state-changing endpoint — the page's JS will read the cookie and echo it as
 * a header on the submit.
 *
 * On HTTPS the cookie uses the `__Host-` prefix (Secure, Path=/, no Domain) for defense
 * in depth. On HTTP (dev) it uses a non-prefixed name so the browser accepts it.
 */
export function issueCsrfCookie(c: Parameters<MiddlewareHandler<HonoConfig>>[0]) {
    const name = csrfCookieName(c);
    const existing = getCookie(c, name);
    if (existing) return existing;
    const token = generateCsrfToken();
    setCookie(c, name, token, {
        httpOnly: false,
        secure: name === PROD_CSRF_COOKIE,
        sameSite: 'Strict',
        path: '/',
        maxAge: CSRF_TTL_SECONDS,
    });
    return token;
}

/**
 * Double-submit CSRF check. Apply to state-changing endpoints that can be called from a
 * browser *without* a prior session — notably the login endpoint, which is otherwise a
 * pathway for login-CSRF / session fixation.
 */
export const requireCsrfToken: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const name = csrfCookieName(c);
    const cookieToken = getCookie(c, name);
    const headerToken = c.req.header(CSRF_HEADER);
    if (!cookieToken || !headerToken || !timingSafeEqual(cookieToken, headerToken)) {
        throw Errors.Forbidden('CSRF token missing or invalid');
    }
    return next();
};
