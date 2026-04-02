# Web FSD Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor `apps/web` into a pragmatic Feature-Sliced Design structure while preserving the current dashboard behavior and keeping verification green throughout.

**Architecture:** Keep Next App Router entrypoints under `app`, move route composition into `pages`, move large page sections into `widgets`, isolate user actions into `features`, place domain-focused display logic into `entities`, and centralize reusable infrastructure under `shared`. Execute the refactor incrementally by screen so every step stays buildable and testable.

**Tech Stack:** Next.js, React, TypeScript, Jest, ESLint, current web dashboard routes and API client layer

---

### Task 1: Create the FSD folder skeleton and shared foundations

**Files:**
- Create: `apps/web/src/pages/.gitkeep` or first real page folders
- Create: `apps/web/src/widgets/.gitkeep` or first real widget folders
- Create: `apps/web/src/features/.gitkeep` or first real feature folders
- Create: `apps/web/src/entities/.gitkeep` or first real entity folders
- Create: `apps/web/src/shared/api`
- Create: `apps/web/src/shared/lib`
- Modify: `apps/web/tsconfig.json`
- Modify: `apps/web/package.json` if import paths or scripts need small support

**Step 1: Write the failing check**

Add or plan import-path usage that expects the new folders to exist.

**Step 2: Run check to verify it fails**

Run: `pnpm --filter web typecheck`
Expected: FAIL or remain incomplete because the new FSD paths are not yet in place.

**Step 3: Write minimal implementation**

Add:

- pragmatic FSD folder skeleton
- path aliases if needed for sane imports
- shared location for API and generic libs

**Step 4: Run check to verify it passes**

Run: `pnpm --filter web typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src apps/web/tsconfig.json apps/web/package.json
git commit -m "refactor: add pragmatic fsd foundation"
```

### Task 2: Move shared API and utility code into `shared`

**Files:**
- Move/Create: `apps/web/src/shared/api/client.ts`
- Move/Create: `apps/web/src/shared/api/types.ts`
- Move/Create: `apps/web/src/shared/lib/format.ts`
- Modify: affected imports across `apps/web`
- Test: migrated API helper tests

**Step 1: Write the failing test**

Update tests to import from the new `shared` locations first.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- --runInBand api.spec.ts`
Expected: FAIL because imports still point at old locations.

**Step 3: Write minimal implementation**

Move the API and formatting layer into `shared` and keep behavior unchanged.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- --runInBand api.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/shared apps/web/src/lib
git commit -m "refactor: move web shared helpers into fsd shared layer"
```

### Task 3: Refactor overview screen into `pages` and `widgets`

**Files:**
- Create/Move: `apps/web/src/pages/overview-page`
- Create/Move: `apps/web/src/widgets/dashboard-overview`
- Modify: `apps/web/src/app/page.tsx`
- Test: `apps/web/src/app/page.spec.tsx`

**Step 1: Write the failing test**

Adjust the overview test to the new composition entrypoints.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- --runInBand page.spec.tsx`
Expected: FAIL because the old imports/layout no longer match.

**Step 3: Write minimal implementation**

Move overview composition into `pages` and its visible sections into `widgets`, keeping route output unchanged.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- --runInBand page.spec.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/app/page.tsx apps/web/src/pages apps/web/src/widgets
git commit -m "refactor: move overview into fsd pages and widgets"
```

### Task 4: Refactor trades screen into `pages`, `widgets`, `features`, and `entities`

**Files:**
- Create/Move: `apps/web/src/pages/trades-page`
- Create/Move: `apps/web/src/widgets/trades-history`
- Create/Move: `apps/web/src/features/create-trade`
- Create/Move: `apps/web/src/features/close-trade`
- Create/Move: `apps/web/src/entities/order`
- Modify: `apps/web/src/app/trades/page.tsx`
- Modify: current trades tests

**Step 1: Write the failing tests**

Repoint trade tests to the new layer boundaries first.

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- --runInBand trade-form.spec.tsx close-trade-form.spec.tsx trades/page.spec.tsx`
Expected: FAIL because files/imports still use the old structure.

**Step 3: Write minimal implementation**

Refactor trades code by responsibility:

- page composition in `pages`
- larger screen block in `widgets`
- create/close actions in `features`
- order-specific display logic in `entities`

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test -- --runInBand trade-form.spec.tsx close-trade-form.spec.tsx trades/page.spec.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/app/trades apps/web/src/pages apps/web/src/widgets apps/web/src/features apps/web/src/entities
git commit -m "refactor: move trades flow into fsd layers"
```

### Task 5: Refactor analysis feed into `pages`, `widgets`, `features`, and `entities`

**Files:**
- Create/Move: `apps/web/src/pages/analysis-page`
- Create/Move: `apps/web/src/widgets/analysis-feed`
- Create/Move: `apps/web/src/features/select-analysis`
- Create/Move: `apps/web/src/entities/signal`
- Create/Move: `apps/web/src/entities/analysis-run`
- Modify: `apps/web/src/app/analysis/page.tsx`
- Test: `apps/web/src/app/analysis/page.spec.tsx`

**Step 1: Write the failing test**

Update the analysis page test to the new structure.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- --runInBand analysis/page.spec.tsx`
Expected: FAIL because imports/composition still point to the old structure.

**Step 3: Write minimal implementation**

Refactor analysis feed code into the target FSD layers while preserving behavior.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- --runInBand analysis/page.spec.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/app/analysis apps/web/src/pages apps/web/src/widgets apps/web/src/features apps/web/src/entities
git commit -m "refactor: move analysis feed into fsd layers"
```

### Task 6: Refactor shell and layout into `widgets`

**Files:**
- Move/Create: `apps/web/src/widgets/app-shell`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: shell tests

**Step 1: Write the failing test**

Update the shell test to the new FSD location first.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- --runInBand app-shell.spec.tsx`
Expected: FAIL because shell files moved.

**Step 3: Write minimal implementation**

Move the shell into `widgets` and keep layout behavior unchanged.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- --runInBand app-shell.spec.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/app/layout.tsx apps/web/src/widgets
git commit -m "refactor: move app shell into fsd widgets"
```

### Task 7: Remove old folders and normalize imports

**Files:**
- Delete or empty: old `apps/web/src/components`
- Delete or empty: old `apps/web/src/lib`
- Modify: all remaining imports

**Step 1: Write the failing check**

Search for old import paths before cleanup.

**Step 2: Run check to verify it fails**

Run: `rg "src/components|src/lib|../components|../lib" apps/web/src`
Expected: finds old references.

**Step 3: Write minimal implementation**

Normalize imports to the new FSD structure and remove obsolete folders.

**Step 4: Run check to verify it passes**

Run: `rg "src/components|src/lib|../components|../lib" apps/web/src`
Expected: no results for obsolete patterns.

**Step 5: Commit**

```bash
git add apps/web/src
git commit -m "refactor: remove legacy web structure"
```

### Task 8: Final verification and docs update

**Files:**
- Modify: `README.md`
- Modify: `apps/web/README.md`
- Review: `apps/web/src`

**Step 1: Update docs**

Document the new pragmatic FSD layout briefly for future contributors.

**Step 2: Run final verification**

Run: `pnpm --filter web test`
Expected: PASS

Run: `pnpm --filter web build`
Expected: PASS

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm lint`
Expected: PASS

**Step 3: Commit**

```bash
git add README.md apps/web/README.md apps/web/src
git commit -m "docs: document pragmatic fsd web structure"
```
