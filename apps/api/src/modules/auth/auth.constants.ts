export const AUTH_COOKIE_NAME = 'market_analysis_session';
/** Long-lived cookie of a browser that passed 2FA with "trust this device". */
export const DEVICE_COOKIE_NAME = 'market_analysis_device';
/** A session expires after this many idle days… */
export const SESSION_TTL_DAYS = 7;
/** …and after this many days in total, however often it is used. */
export const SESSION_MAX_DAYS = 30;
export const TRUSTED_DEVICE_DAYS = 30;
/** How long a half-finished login (password ok, code pending) stays valid. */
export const LOGIN_CHALLENGE_TTL_MS = 10 * 60_000;
/** Wrong passwords/codes allowed per IP and per email inside the lock window. */
export const MAX_LOGIN_FAILURES = 5;
export const LOGIN_LOCK_MS = 15 * 60_000;
export const MIN_PASSWORD_LENGTH = 10;
export const BACKUP_CODE_COUNT = 10;
export const PUBLIC_ROUTE_KEY = 'isPublicRoute';
export const AUTH_OPTIONS = Symbol('AUTH_OPTIONS');
