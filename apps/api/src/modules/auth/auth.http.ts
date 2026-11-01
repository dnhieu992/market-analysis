import type { RequestContext } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';

export function readCookie(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const segment of cookieHeader.split(';')) {
    const [name, ...valueParts] = segment.trim().split('=');
    if (name === cookieName) {
      return valueParts.join('=');
    }
  }

  return null;
}

/**
 * Client address. The API only listens on localhost behind the Next.js
 * /api-proxy rewrite, which appends the real peer to X-Forwarded-For — so the
 * LAST entry is the one the proxy saw (earlier entries are client-supplied).
 */
export function clientIp(request: AuthenticatedRequest): string | null {
  const header = request.headers?.['x-forwarded-for'];
  const raw = Array.isArray(header) ? header.join(',') : header;
  const forwarded = raw?.split(',').map((s) => s.trim()).filter(Boolean).pop();
  const ip = forwarded ?? request.ip ?? request.socket?.remoteAddress ?? null;
  return ip ? ip.replace(/^::ffff:/, '') : null;
}

export function requestContext(request: AuthenticatedRequest, deviceCookieName: string): RequestContext {
  return {
    ip: clientIp(request),
    userAgent: request.headers?.['user-agent'] ?? null,
    deviceToken: readCookie(request.headers?.cookie, deviceCookieName)
  };
}

const isSecureCookie = process.env.SECURE_COOKIE === 'true';

export function buildCookie(name: string, value: string, expiresAt: Date): string {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Expires=${expiresAt.toUTCString()}`];
  if (isSecureCookie) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string): string {
  const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT'];
  if (isSecureCookie) parts.push('Secure');
  return parts.join('; ');
}
