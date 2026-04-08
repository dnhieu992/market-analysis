# Basic Auth Design

**Goal:** Add database-backed authentication to both the NestJS API and the Next.js dashboard, with a login UI, protected application routes, and a simple registration API for future use.

**Scope**

- Protect all dashboard routes except the login page.
- Protect all API routes except health and auth endpoints.
- Store users in MySQL through Prisma.
- Use password hashing and server-managed sessions.
- Support login, logout, session lookup, and registration.
- Do not add authorization roles or permissions yet.

**Chosen Approach**

Use database users plus database sessions with an `HttpOnly` cookie.

This fits the current architecture well:

- the API is the single source of truth for auth
- the web app already reads data from the API
- sessions can be revoked without extra token-version logic
- the implementation stays small and understandable for an internal dashboard

**Why Not JWT First**

JWT cookies would reduce database reads, but they complicate logout and revocation unless we add more machinery. That tradeoff is not worth it for this version.

**Data Model**

Add two new Prisma models:

- `User`
  - `id`
  - `email`
  - `passwordHash`
  - `name`
  - `createdAt`
  - `updatedAt`
- `Session`
  - `id`
  - `userId`
  - `tokenHash`
  - `expiresAt`
  - `createdAt`
  - `lastUsedAt`

Design notes:

- `email` is unique and used for login.
- Only a hash of the session token is stored in the database.
- Session expiration is enforced server-side.
- `Session` belongs to `User` and should be deleted automatically when a user is deleted.

**API Design**

Add a dedicated auth module with these endpoints:

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`

Behavior:

- `register` creates a user with a hashed password.
- `login` verifies credentials, creates a session, and sets the auth cookie.
- `logout` deletes the active session and clears the cookie.
- `me` returns the authenticated user profile.

All other API routes should require an authenticated session.

**Guarding Strategy**

Use a global NestJS auth guard driven by a small `@Public()` decorator.

Public endpoints:

- `/health`
- `/auth/register`
- `/auth/login`
- `/auth/logout`

Protected endpoints:

- orders
- signals
- analysis
- daily-analysis
- settings
- worker
- chat
- telegram logs

The guard will:

1. Read the cookie from the incoming request.
2. Hash the session token.
3. Load the matching session and user.
4. Reject missing, invalid, or expired sessions.
5. Attach the authenticated user to the request for controller/service access.

**Cookie Design**

Use one cookie managed by the API:

- name: `market_analysis_session`
- flags: `HttpOnly`, `SameSite=Lax`
- `Secure` only in production
- path `/`

The cookie will contain the raw session token. The database stores only its hash.

Because the dashboard runs on `localhost:3001` and the API on `localhost:3000`, browser requests must use credentials and API CORS must allow credentials with an explicit origin.

**Web App Design**

Add a dedicated `/login` route in Next.js.

The login page will:

- render without the main app shell
- post credentials to the API login endpoint
- include credentials so the browser stores the session cookie
- redirect to `/` after success
- show a simple inline error on failure

Route protection on the web side:

- add Next middleware that redirects unauthenticated users from app routes to `/login`
- keep `/login` public
- redirect authenticated users away from `/login` to `/`

For server-rendered dashboard pages, API requests must forward the incoming cookie to the backend so protected API endpoints still work during SSR.

**Testing Strategy**

API:

- password utility unit tests
- auth service tests for register, login, logout, and expired sessions
- auth controller/guard tests for public and protected routes

Web:

- API client tests for authenticated fetch options
- login page test for form rendering
- middleware tests for redirect behavior
- existing page tests updated to account for forwarded cookies where needed

**Non-Goals**

- roles
- permission checks
- forgot password
- email verification
- refresh-token flows
- OAuth providers

**Performance Notes**

- Keep the auth state server-owned instead of adding a large client auth library.
- Use middleware and server-side cookie forwarding to avoid unnecessary client-side bootstrapping.
- Continue using server components for data-heavy dashboard pages.
