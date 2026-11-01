# Authentication (hardened, single owner)

The app has one owner account. Login is email + password, then a mandatory
TOTP second factor. There is no public sign-up and no master password.

## Login flow

`POST /auth/login` answers one of:

| step | meaning | next call |
|---|---|---|
| `change-password` | account has a temporary password (`mustChangePassword`) | `POST /auth/login/password { challenge, newPassword }` |
| `enroll-totp` | 2FA not set up yet | `POST /auth/login/totp-setup { challenge }` → QR, then `POST /auth/login/totp-enable { challenge, code, trustDevice }` |
| `totp` | untrusted browser | `POST /auth/login/totp { challenge, code, trustDevice }` (code = 6 digits or a backup code) |
| `done` | session cookie set (trusted browser) | — |

- `challenge` is an opaque token kept **in API memory** for 10 minutes and good
  for 5 wrong codes. An API restart drops it → the user re-enters the password.
- Enabling 2FA returns 10 backup codes once (`done.backupCodes`); only sha256
  hashes are stored (`auth_backup_codes`), each code works once.
- The TOTP secret is stored AES-256-GCM encrypted (`users.totpSecretEnc`, key
  from `AUTH_ENC_KEY`). Changing/losing that key invalidates every 2FA setup —
  recover with `auth:cli reset-2fa`.
- A TOTP code is accepted for the current step ±1 (30 s) and never twice
  (`users.totpLastStep`).
- New password: 10–128 chars, not the old one, not `super-admin`.

## Sessions and trusted devices

- Session cookie `market_analysis_session` (HttpOnly, SameSite=Lax). Expiry
  slides to 7 days after last use, capped at 30 days after login.
- "Tin thiết bị này 30 ngày" sets `market_analysis_device`; that browser then
  skips the code (`trusted_devices`). It also exempts the browser from the
  per-email lock, so someone hammering the email cannot lock the owner out of
  a trusted browser.
- `/profile` → Bảo mật: 2FA status, regenerate backup codes (needs a TOTP
  code), change password (current password + code; logs out other sessions),
  list/revoke sessions and trusted devices, "Đăng xuất các thiết bị khác", logout.

## Rate limiting and alerts

- 5 failed passwords/codes within 15 minutes lock that IP and that email for
  the rest of the window (HTTP 429). Counters live in API memory.
- Client IP = last `X-Forwarded-For` entry (added by the Next.js `/api-proxy`
  rewrite), falling back to the socket address.
- Telegram (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`): login from a new device,
  lockouts, backup-code logins, 2FA enabled, password changed, backup codes
  regenerated, other devices logged out.

## Exposure

- The API binds to `API_HOST` (default `127.0.0.1`); browsers reach it only via
  `http://<host>:3001/api-proxy/*`. `API_BASE_URL` for the web must be
  `http://127.0.0.1:3000` (not `localhost`, which can resolve to `::1`).
- Swagger `/api/docs` is mounted only with `SWAGGER_ENABLED=true`.
- Still plain HTTP: cookies can be sniffed on untrusted networks. Adding a
  domain + Caddy (HTTPS) and `SECURE_COOKIE=true` needs no code change.

## Account admin CLI (on the server)

```bash
pnpm --filter api auth:cli list
pnpm --filter api auth:cli set-password <email> [--temp]   # hidden prompt, or stdin; logs out all sessions
pnpm --filter api auth:cli reset-2fa <email>               # lost phone + no backup codes
pnpm --filter api auth:cli logout-all <email>              # sessions + trusted devices
pnpm --filter api auth:cli create-user <email> <name>      # first login forces a new password
```

Built JS (`dist/`), so run after a build.
