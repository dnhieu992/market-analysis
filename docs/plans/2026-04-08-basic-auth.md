# Basic Auth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add database-backed authentication with login/logout/session support for both the NestJS API and the Next.js dashboard.

**Architecture:** Prisma will store `User` and `Session` records. The NestJS API will own password verification, session issuance, cookie management, and a global auth guard. The Next.js app will provide a login page, middleware-based route protection, and authenticated server-side API calls by forwarding cookies.

**Tech Stack:** Prisma, MySQL, NestJS, Next.js App Router, TypeScript, Jest, Node `crypto`

---

### Task 1: Add auth persistence models and repository factories

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/repositories/user.repository.ts`
- Create: `packages/db/src/repositories/session.repository.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/api/test/stubs/app-db.ts`

**Step 1: Write the failing test**

Add a repository-level API expectation in `apps/api/test/stubs/app-db.ts` usage tests or auth service tests showing users and sessions can be created and looked up.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- --runInBand auth.service.spec.ts`
Expected: FAIL because the auth repositories and stubbed DB APIs do not exist.

**Step 3: Write minimal implementation**

- Add `User` and `Session` Prisma models.
- Export repository factories for users and sessions.
- Extend the API test DB stub to support auth flows.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- --runInBand auth.service.spec.ts`
Expected: PASS

### Task 2: Add password and session-token utilities

**Files:**
- Create: `apps/api/src/modules/auth/auth.crypto.ts`
- Create: `apps/api/test/auth.crypto.spec.ts`

**Step 1: Write the failing test**

Add tests for:
- hashing and verifying passwords
- generating a raw session token plus hashed persisted token
- rejecting incorrect passwords

**Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- --runInBand auth.crypto.spec.ts`
Expected: FAIL because auth crypto helpers do not exist.

**Step 3: Write minimal implementation**

- Use Node `crypto.scrypt` for passwords.
- Use secure random bytes for session tokens.
- Hash session tokens before persistence.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- --runInBand auth.crypto.spec.ts`
Expected: PASS

### Task 3: Add Nest auth module, service, controller, and request types

**Files:**
- Create: `apps/api/src/modules/auth/auth.module.ts`
- Create: `apps/api/src/modules/auth/auth.service.ts`
- Create: `apps/api/src/modules/auth/auth.controller.ts`
- Create: `apps/api/src/modules/auth/auth.constants.ts`
- Create: `apps/api/src/modules/auth/auth.types.ts`
- Create: `apps/api/src/modules/auth/dto/login.dto.ts`
- Create: `apps/api/src/modules/auth/dto/register.dto.ts`
- Create: `apps/api/test/auth.service.spec.ts`

**Step 1: Write the failing test**

Add service tests covering:
- registering a user
- rejecting duplicate email
- logging in with valid credentials
- rejecting invalid credentials
- returning the authenticated user from session
- deleting a session on logout

**Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- --runInBand auth.service.spec.ts`
Expected: FAIL because the auth service module does not exist.

**Step 3: Write minimal implementation**

- Create auth DTOs and response shapes.
- Implement register/login/logout/me logic.
- Store only hashed session tokens in the database.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- --runInBand auth.service.spec.ts`
Expected: PASS

### Task 4: Add global API protection with public-route escape hatches

**Files:**
- Create: `apps/api/src/modules/auth/public.decorator.ts`
- Create: `apps/api/src/modules/auth/auth.guard.ts`
- Modify: `apps/api/src/modules/database/database.providers.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/modules/health/health.controller.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`
- Create: `apps/api/test/auth.guard.e2e-spec.ts`

**Step 1: Write the failing test**

Add tests proving:
- protected routes return `401` without a valid session cookie
- `/health` stays public
- `/auth/login` stays public

**Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- --runInBand auth.guard.e2e-spec.ts`
Expected: FAIL because no global auth guard is active.

**Step 3: Write minimal implementation**

- Add `@Public()` metadata.
- Register a global auth guard.
- Update CORS to allow credentials and the configured web origin.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- --runInBand auth.guard.e2e-spec.ts`
Expected: PASS

### Task 5: Add frontend login UX and authenticated API client support

**Files:**
- Modify: `apps/web/src/shared/api/client.ts`
- Modify: `apps/web/src/shared/api/client.spec.ts`
- Create: `apps/web/src/app/login/page.tsx`
- Create: `apps/web/src/app/login/page.spec.tsx`
- Create: `apps/web/src/features/auth/login-form.tsx`

**Step 1: Write the failing test**

Add tests showing:
- the login page renders an email/password form
- the API client can forward cookies/credentials for protected requests

**Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- --runInBand src/app/login/page.spec.tsx src/shared/api/client.spec.ts`
Expected: FAIL because no login route or auth-aware API client behavior exists.

**Step 3: Write minimal implementation**

- Add a login page outside the main app shell.
- Add a small client form that posts to the API login endpoint with credentials.
- Extend the API client with optional request headers and browser credential support.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- --runInBand src/app/login/page.spec.tsx src/shared/api/client.spec.ts`
Expected: PASS

### Task 6: Protect dashboard routes and forward cookies during SSR

**Files:**
- Create: `apps/web/src/shared/auth/api-auth.ts`
- Create: `apps/web/src/middleware.ts`
- Create: `apps/web/src/middleware.spec.ts`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/_pages/overview-page/overview-page.tsx`
- Modify: `apps/web/src/app/page.spec.tsx`
- Modify: similar dashboard pages under `apps/web/src/app/**/page.tsx` and `apps/web/src/_pages/**`

**Step 1: Write the failing test**

Add tests covering:
- middleware redirects unauthenticated requests to `/login`
- middleware redirects authenticated requests away from `/login`
- dashboard page loaders forward the cookie header to the API client

**Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- --runInBand src/middleware.spec.ts src/app/page.spec.tsx`
Expected: FAIL because there is no route protection or cookie forwarding.

**Step 3: Write minimal implementation**

- Add Next middleware for login protection.
- Skip the app shell on the login route.
- Read incoming cookies in server components and forward them to API requests.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- --runInBand src/middleware.spec.ts src/app/page.spec.tsx`
Expected: PASS

### Task 7: Update environment examples and run end-to-end verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

**Step 1: Add the new environment contract**

Document:
- `CORS_ORIGIN`
- `SESSION_COOKIE_NAME`
- `SESSION_TTL_DAYS`

**Step 2: Run targeted API tests**

Run: `pnpm --filter api test -- --runInBand auth.crypto.spec.ts auth.service.spec.ts auth.guard.e2e-spec.ts`
Expected: PASS

**Step 3: Run targeted web tests**

Run: `pnpm --filter web test -- --runInBand src/app/login/page.spec.tsx src/shared/api/client.spec.ts src/middleware.spec.ts src/app/page.spec.tsx`
Expected: PASS

**Step 4: Run typechecks**

Run: `pnpm --filter api typecheck`
Expected: PASS

Run: `pnpm --filter web typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add docs/plans/2026-04-08-basic-auth-design.md docs/plans/2026-04-08-basic-auth.md packages/db/prisma/schema.prisma packages/db/src/index.ts packages/db/src/repositories/user.repository.ts packages/db/src/repositories/session.repository.ts apps/api/src apps/api/test apps/web/src .env.example README.md
git commit -m "feat: add basic authentication"
```
