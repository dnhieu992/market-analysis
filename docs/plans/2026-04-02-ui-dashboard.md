# UI Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a new Next.js dashboard app in the monorepo for overview metrics, structured analysis browsing, and manual trade management without authentication.

**Architecture:** Add `apps/web` as a separate Next.js app that fetches data from the existing NestJS API. Use server-first rendering for overview and analysis pages, keep client components focused on forms and interactive controls, and avoid introducing a new API layer unless the current endpoints prove insufficient.

**Tech Stack:** Next.js, React, TypeScript, App Router, Fetch API, CSS Modules or global CSS, existing NestJS API, existing orders/signals/analysis-runs endpoints

---

### Task 1: Scaffold the web app workspace

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.js`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/app/favicon.ico` or placeholder asset if needed
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`

**Step 1: Write the failing check**

Define a new root script target for the web app in `package.json` before the app exists.

**Step 2: Run check to verify it fails**

Run: `pnpm --filter web build`
Expected: FAIL because `apps/web` does not exist yet.

**Step 3: Write minimal implementation**

Add:

- `apps/web` as a Next.js app workspace
- root script `dev:web`
- a minimal App Router shell with a placeholder dashboard page
- shared global CSS variables for the dashboard visual direction

**Step 4: Run check to verify it passes**

Run: `pnpm --filter web build`
Expected: PASS

**Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml apps/web
git commit -m "feat: scaffold web dashboard app"
```

### Task 2: Add typed API clients and shared dashboard data loaders

**Files:**
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/types.ts`
- Create: `apps/web/src/lib/format.ts`
- Test: `apps/web/src/lib/api.spec.ts`

**Step 1: Write the failing test**

Add tests for:

- API URL composition using the configured backend base URL
- parsing `orders`, `signals`, and `analysis-runs` into typed frontend shapes
- confidence, date, and price formatting helpers

**Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- --runInBand api.spec.ts`
Expected: FAIL because the helpers do not exist yet.

**Step 3: Write minimal implementation**

Implement:

- environment-aware API base URL handling
- typed fetch helpers for orders, signals, analysis runs, and health
- small formatting helpers for dashboard display

**Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- --runInBand api.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/lib
git commit -m "feat: add dashboard api clients"
```

### Task 3: Build the overview dashboard page

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/components/dashboard/overview-cards.tsx`
- Create: `apps/web/src/components/dashboard/recent-analysis-panel.tsx`
- Create: `apps/web/src/components/dashboard/recent-orders-panel.tsx`
- Create: `apps/web/src/components/dashboard/quick-actions.tsx`
- Test: `apps/web/src/app/page.spec.tsx`

**Step 1: Write the failing test**

Add tests verifying the overview page:

- renders KPI cards
- shows recent analysis content
- shows order activity content
- links to trading history and analysis feed

**Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- --runInBand page.spec.tsx`
Expected: FAIL because the overview UI is still placeholder content.

**Step 3: Write minimal implementation**

Implement:

- server-rendered overview page
- summary calculations from orders and signals
- responsive dashboard sections
- clear quick actions

**Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- --runInBand page.spec.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/app apps/web/src/components/dashboard
git commit -m "feat: add overview dashboard"
```

### Task 4: Build the trading history page with manual trade creation

**Files:**
- Create: `apps/web/src/app/trades/page.tsx`
- Create: `apps/web/src/components/trades/trade-form.tsx`
- Create: `apps/web/src/components/trades/trades-table.tsx`
- Create: `apps/web/src/components/trades/trade-status-pill.tsx`
- Create: `apps/web/src/app/trades/actions.ts`
- Test: `apps/web/src/components/trades/trade-form.spec.tsx`
- Test: `apps/web/src/app/trades/page.spec.tsx`

**Step 1: Write the failing tests**

Add tests for:

- rendering existing orders
- submitting a manual order
- validation for required order fields

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- --runInBand trade-form.spec.tsx page.spec.tsx`
Expected: FAIL because the page and form do not exist.

**Step 3: Write minimal implementation**

Implement:

- trading history route
- manual trade form
- order list/table
- mutation path to create orders through the API

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test -- --runInBand trade-form.spec.tsx page.spec.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/app/trades apps/web/src/components/trades
git commit -m "feat: add trading history page"
```

### Task 5: Add close-trade interaction to the trading history page

**Files:**
- Modify: `apps/web/src/components/trades/trades-table.tsx`
- Modify: `apps/web/src/app/trades/actions.ts`
- Create: `apps/web/src/components/trades/close-trade-form.tsx`
- Test: `apps/web/src/components/trades/close-trade-form.spec.tsx`

**Step 1: Write the failing test**

Add tests for:

- closing an open trade
- hiding the close action for already-closed trades
- refreshing the UI state after a close operation

**Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- --runInBand close-trade-form.spec.tsx`
Expected: FAIL because close-trade UI does not exist.

**Step 3: Write minimal implementation**

Implement:

- close-trade action button/form
- API mutation for `PATCH /orders/:id/close`
- UI refresh after close

**Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- --runInBand close-trade-form.spec.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/components/trades apps/web/src/app/trades/actions.ts
git commit -m "feat: add close trade flow"
```

### Task 6: Build the structured analysis feed

**Files:**
- Create: `apps/web/src/app/analysis/page.tsx`
- Create: `apps/web/src/components/analysis/analysis-card.tsx`
- Create: `apps/web/src/components/analysis/analysis-detail-panel.tsx`
- Create: `apps/web/src/components/analysis/confidence-badge.tsx`
- Test: `apps/web/src/app/analysis/page.spec.tsx`

**Step 1: Write the failing test**

Add tests for:

- rendering signal cards
- showing trend, bias, confidence, support, and resistance
- opening detail state for analysis-run-backed content

**Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- --runInBand analysis/page.spec.tsx`
Expected: FAIL because the analysis feed route does not exist.

**Step 3: Write minimal implementation**

Implement:

- analysis feed page
- structured analysis cards
- detail view that joins signal and analysis-run data

**Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- --runInBand analysis/page.spec.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/app/analysis apps/web/src/components/analysis
git commit -m "feat: add analysis feed page"
```

### Task 7: Add navigation, polish, and dashboard responsiveness

**Files:**
- Modify: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/components/layout/app-shell.tsx`
- Create: `apps/web/src/components/layout/sidebar-nav.tsx`
- Create: `apps/web/src/components/layout/topbar.tsx`
- Modify: `apps/web/src/app/globals.css`
- Test: `apps/web/src/components/layout/app-shell.spec.tsx`

**Step 1: Write the failing test**

Add tests for:

- navigation links across overview, trades, and analysis pages
- active navigation state
- mobile-friendly shell rendering

**Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- --runInBand app-shell.spec.tsx`
Expected: FAIL because the layout shell does not exist yet.

**Step 3: Write minimal implementation**

Implement:

- shared app shell
- responsive navigation
- consistent spacing, typography, and status styling
- visual polish aligned with the approved dashboard direction

**Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- --runInBand app-shell.spec.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/components/layout apps/web/src/app/layout.tsx apps/web/src/app/globals.css
git commit -m "feat: add dashboard shell and responsive layout"
```

### Task 8: Add web app docs and final verification

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Create: `apps/web/README.md` if needed

**Step 1: Write the failing checks**

Verify the docs are missing:

- how to run the new web app
- any required web environment variables
- dashboard route overview

**Step 2: Run checks to verify they fail**

Run: `rg "dev:web|apps/web|Overview Dashboard" README.md .env.example`
Expected: FAIL or incomplete output.

**Step 3: Write minimal implementation**

Update:

- root README with dashboard setup and routes
- `.env.example` with web-facing API base URL if needed
- optional web app README if project structure benefits from it

**Step 4: Run final verification**

Run: `pnpm --filter web test`
Expected: PASS

Run: `pnpm --filter web build`
Expected: PASS

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm test`
Expected: PASS

**Step 5: Commit**

```bash
git add README.md .env.example apps/web
git commit -m "docs: finalize dashboard app setup"
```
