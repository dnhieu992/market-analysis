# Strategy Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain table on `/strategy` with a responsive split layout (desktop) and card grid + detail page (mobile).

**Architecture:** `StrategiesList` (client orchestrator) renders both `StrategiesSplit` (desktop, CSS-hidden on mobile) and `StrategiesCardGrid` (mobile, CSS-hidden on desktop) — toggled purely with CSS media queries. Selected strategy on desktop is tracked via `?id` query param read by the server component. Mobile navigates to `/strategy/[id]` for full detail. `StrategyDetailPanel` is a shared client component handling edit/delete dialogs, used in both desktop panel and mobile detail page.

**Tech Stack:** Next.js 14 App Router, TypeScript, plain CSS (globals.css), `useRouter` from `next/navigation`, `@web/shared/api/client`, `@web/shared/auth/api-auth`.

---

### Task 1: Add `fetchTradingStrategyById` to API client

**Files:**
- Modify: `apps/web/src/shared/api/client.ts`

- [ ] Open `apps/web/src/shared/api/client.ts`. Find the `fetchTradingStrategies` method (search for `fetchTradingStrategies`). Add the new method **after** it:

```ts
async fetchTradingStrategyById(id: string): Promise<TradingStrategy> {
  const row = await fetchJson<JsonRecord>(fetchImpl, `${baseUrl}/strategies/${id}`, withDefaults());
  return mapTradingStrategy(row);
},
```

- [ ] Run typecheck to verify no errors:

```bash
cd /Users/dnhieu92/Documents/personal/new-account/market-analysis
pnpm --filter web typecheck
```

Expected: no errors.

- [ ] Commit:

```bash
git add apps/web/src/shared/api/client.ts
git commit -m "feat(web): add fetchTradingStrategyById to API client"
```

---

### Task 2: Add CSS classes to globals.css

**Files:**
- Modify: `apps/web/src/app/globals.css`

- [ ] Append the following CSS at the **end** of `apps/web/src/app/globals.css`:

```css
/* ── Strategy page — split layout (desktop) ─────────────────────────────────── */

.strat-page {
  padding: 24px 28px;
}

.strat-page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.strat-page-title {
  font-size: 1.35rem;
  font-weight: 800;
  margin: 0;
}

.strat-split {
  display: none;
}

@media (min-width: 768px) {
  .strat-split {
    display: grid;
    grid-template-columns: 220px 1fr;
    gap: 16px;
    min-height: 480px;
  }
}

.strat-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.strat-list-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 9px;
  border: 1px solid transparent;
  cursor: pointer;
  background: none;
  text-align: left;
  width: 100%;
  transition: background 0.12s, border-color 0.12s;
}

.strat-list-item:hover {
  background: rgba(31, 111, 91, 0.06);
}

.strat-list-item--active {
  background: var(--accent-soft);
  border-color: rgba(31, 111, 91, 0.25);
}

.strat-list-item-name {
  font-weight: 700;
  font-size: 0.82rem;
  color: var(--foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.strat-list-item-meta {
  font-size: 0.72rem;
  color: var(--muted);
}

.strat-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 220px;
  color: var(--muted);
  font-size: 0.88rem;
}

/* ── Strategy detail panel ───────────────────────────────────────────────────── */

.strat-detail {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06);
}

.strat-detail-name {
  font-size: 1.15rem;
  font-weight: 800;
  margin: 0;
}

.strat-detail-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.strat-ver-badge {
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.72rem;
  font-weight: 700;
  border-radius: 5px;
  padding: 2px 8px;
}

.strat-detail-date {
  font-size: 0.78rem;
  color: var(--muted);
}

.strat-detail-content {
  font-size: 0.88rem;
  color: var(--foreground);
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-word;
  flex: 1;
}

.strat-detail-actions {
  display: flex;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.strat-detail-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 220px;
  background: var(--surface);
  border: 1px dashed var(--border);
  border-radius: 14px;
  color: var(--muted);
  font-size: 0.88rem;
}

/* ── Strategy page — card grid (mobile) ─────────────────────────────────────── */

.sgrid-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

@media (min-width: 768px) {
  .sgrid-grid {
    display: none;
  }
}

.sgrid-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-decoration: none;
  color: inherit;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  transition: box-shadow 0.14s, border-color 0.14s;
}

.sgrid-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  border-color: rgba(31, 111, 91, 0.3);
}

.sgrid-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
}

.sgrid-card-name {
  font-weight: 700;
  font-size: 0.82rem;
  line-height: 1.3;
}

.sgrid-card-preview {
  font-size: 0.78rem;
  color: var(--muted);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
}

.sgrid-card-date {
  font-size: 0.72rem;
  color: var(--muted);
  margin-top: auto;
}

/* ── Strategy detail page (mobile /strategy/[id]) ───────────────────────────── */

.strat-detail-page {
  padding: 16px 18px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.strat-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--accent);
  text-decoration: none;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

.strat-back-btn:hover {
  text-decoration: underline;
}
```

- [ ] Commit:

```bash
git add apps/web/src/app/globals.css
git commit -m "feat(web): add strategy page CSS classes (split, card grid, detail panel)"
```

---

### Task 3: Create `StrategyDetailPanel` shared component

**Files:**
- Create: `apps/web/src/widgets/strategies-list/strategy-detail-panel.tsx`

- [ ] Create `apps/web/src/widgets/strategies-list/strategy-detail-panel.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { EditStrategyForm } from '@web/features/edit-strategy/edit-strategy-form';
import { createApiClient } from '@web/shared/api/client';
import type { TradingStrategy } from '@web/shared/api/types';

type StrategyDetailPanelProps = Readonly<{
  strategy: TradingStrategy;
}>;

export function StrategyDetailPanel({ strategy }: StrategyDetailPanelProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function handleConfirmDelete() {
    try {
      await createApiClient().deleteTradingStrategy(strategy.id);
      setDeleteOpen(false);
      startTransition(() => {
        router.push('/strategy');
        router.refresh();
      });
    } catch {
      // stay open so user can retry
    }
  }

  return (
    <>
      <div className="strat-detail">
        <h2 className="strat-detail-name">{strategy.name}</h2>

        <div className="strat-detail-meta">
          <span className="strat-ver-badge">{strategy.version}</span>
          <span className="strat-detail-date">
            Created {new Date(strategy.createdAt).toLocaleDateString()}
          </span>
        </div>

        <p className="strat-detail-content">{strategy.content}</p>

        <div className="strat-detail-actions">
          <button className="btn btn--secondary" onClick={() => setEditOpen(true)}>
            Edit
          </button>
          <button className="btn btn--danger" onClick={() => setDeleteOpen(true)}>
            Delete
          </button>
        </div>
      </div>

      {editOpen && (
        <div className="dialog-backdrop" onClick={() => setEditOpen(false)}>
          <div className="dialog dialog--wide" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Edit Strategy — {strategy.name}</span>
              <button className="dialog-close" onClick={() => setEditOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <EditStrategyForm
                strategy={strategy}
                onSubmitted={() => {
                  setEditOpen(false);
                  router.refresh();
                }}
              />
            </div>
          </div>
        </div>
      )}

      {deleteOpen && (
        <div className="dialog-backdrop" onClick={() => setDeleteOpen(false)}>
          <div className="dialog dialog--compact" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Delete Strategy</span>
              <button className="dialog-close" onClick={() => setDeleteOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <p className="dialog-confirm-text">
                Are you sure you want to delete <strong>{strategy.name}</strong>? This action cannot be undone.
              </p>
              <div className="dialog-confirm-actions">
                <button className="btn btn--secondary" onClick={() => setDeleteOpen(false)}>Cancel</button>
                <button className="btn btn--danger" onClick={handleConfirmDelete} disabled={isPending}>
                  {isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] Run typecheck:

```bash
pnpm --filter web typecheck
```

Expected: no errors.

- [ ] Commit:

```bash
git add apps/web/src/widgets/strategies-list/strategy-detail-panel.tsx
git commit -m "feat(web): add StrategyDetailPanel shared component"
```

---

### Task 4: Create `StrategiesCardGrid` mobile component

**Files:**
- Create: `apps/web/src/widgets/strategies-list/strategies-card-grid.tsx`

- [ ] Create `apps/web/src/widgets/strategies-list/strategies-card-grid.tsx`:

```tsx
import Link from 'next/link';

import type { TradingStrategy } from '@web/shared/api/types';

type StrategiesCardGridProps = Readonly<{
  strategies: TradingStrategy[];
  onCreateClick: () => void;
}>;

export function StrategiesCardGrid({ strategies, onCreateClick }: StrategiesCardGridProps) {
  return (
    <div className="strat-page">
      <div className="strat-page-header">
        <h1 className="strat-page-title">Strategies</h1>
        <button className="btn btn--primary" onClick={onCreateClick}>+ Add Strategy</button>
      </div>

      {strategies.length === 0 ? (
        <div className="strat-empty">No strategies yet. Add one to get started.</div>
      ) : (
        <div className="sgrid-grid">
          {strategies.map((strategy) => (
            <Link key={strategy.id} href={`/strategy/${strategy.id}`} className="sgrid-card">
              <div className="sgrid-card-top">
                <span className="sgrid-card-name">{strategy.name}</span>
                <span className="strat-ver-badge">{strategy.version}</span>
              </div>
              <p className="sgrid-card-preview">{strategy.content}</p>
              <span className="sgrid-card-date">
                {new Date(strategy.createdAt).toLocaleDateString()}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] Run typecheck:

```bash
pnpm --filter web typecheck
```

Expected: no errors.

- [ ] Commit:

```bash
git add apps/web/src/widgets/strategies-list/strategies-card-grid.tsx
git commit -m "feat(web): add StrategiesCardGrid mobile component"
```

---

### Task 5: Create `StrategiesSplit` desktop component

**Files:**
- Create: `apps/web/src/widgets/strategies-list/strategies-split.tsx`

- [ ] Create `apps/web/src/widgets/strategies-list/strategies-split.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';

import type { TradingStrategy } from '@web/shared/api/types';

import { StrategyDetailPanel } from './strategy-detail-panel';

type StrategiesSplitProps = Readonly<{
  strategies: TradingStrategy[];
  selectedId: string | null;
  onCreateClick: () => void;
}>;

export function StrategiesSplit({ strategies, selectedId, onCreateClick }: StrategiesSplitProps) {
  const router = useRouter();
  const selected = strategies.find((s) => s.id === selectedId) ?? null;

  function selectStrategy(id: string) {
    router.push(`/strategy?id=${id}`);
  }

  return (
    <div className="strat-page">
      <div className="strat-page-header">
        <h1 className="strat-page-title">Strategies</h1>
        <button className="btn btn--primary" onClick={onCreateClick}>+ Add Strategy</button>
      </div>

      <div className="strat-split">
        {/* Left: list */}
        <div className="strat-list">
          {strategies.length === 0 ? (
            <div className="strat-empty">No strategies yet.</div>
          ) : (
            strategies.map((strategy) => (
              <button
                key={strategy.id}
                className={`strat-list-item${strategy.id === selectedId ? ' strat-list-item--active' : ''}`}
                onClick={() => selectStrategy(strategy.id)}
              >
                <span className="strat-list-item-name">{strategy.name}</span>
                <span className="strat-list-item-meta">v{strategy.version}</span>
              </button>
            ))
          )}
        </div>

        {/* Right: detail panel */}
        {selected ? (
          <StrategyDetailPanel key={selected.id} strategy={selected} />
        ) : (
          <div className="strat-detail-placeholder">
            Select a strategy to view details
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] Run typecheck:

```bash
pnpm --filter web typecheck
```

Expected: no errors.

- [ ] Commit:

```bash
git add apps/web/src/widgets/strategies-list/strategies-split.tsx
git commit -m "feat(web): add StrategiesSplit desktop component"
```

---

### Task 6: Update `StrategiesList` orchestrator

**Files:**
- Modify: `apps/web/src/widgets/strategies-list/strategies-list.tsx`

- [ ] Replace the entire contents of `apps/web/src/widgets/strategies-list/strategies-list.tsx` with:

```tsx
'use client';

import { useState } from 'react';

import { CreateStrategyForm } from '@web/features/create-strategy/create-strategy-form';
import type { TradingStrategy } from '@web/shared/api/types';

import { StrategiesCardGrid } from './strategies-card-grid';
import { StrategiesSplit } from './strategies-split';

type StrategiesListProps = Readonly<{
  strategies: TradingStrategy[];
  selectedId: string | null;
}>;

export function StrategiesList({ strategies, selectedId }: StrategiesListProps) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <main className="dashboard-shell">
      {/* Desktop: split layout (hidden on mobile via CSS) */}
      <StrategiesSplit
        strategies={strategies}
        selectedId={selectedId}
        onCreateClick={() => setCreateOpen(true)}
      />

      {/* Mobile: card grid (hidden on desktop via CSS) */}
      <StrategiesCardGrid
        strategies={strategies}
        onCreateClick={() => setCreateOpen(true)}
      />

      {createOpen && (
        <div className="dialog-backdrop" onClick={() => setCreateOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Add Strategy</span>
              <button className="dialog-close" onClick={() => setCreateOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <CreateStrategyForm onSubmitted={() => setCreateOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
```

- [ ] Run typecheck:

```bash
pnpm --filter web typecheck
```

Expected: no errors.

- [ ] Commit:

```bash
git add apps/web/src/widgets/strategies-list/strategies-list.tsx
git commit -m "feat(web): update StrategiesList to use split + card grid layouts"
```

---

### Task 7: Update `StrategyPage` server component to read `searchParams`

**Files:**
- Modify: `apps/web/src/_pages/strategy-page/strategy-page.tsx`

- [ ] Replace the entire contents of `apps/web/src/_pages/strategy-page/strategy-page.tsx` with:

```tsx
import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { TradingStrategy } from '@web/shared/api/types';
import { StrategiesList } from '@web/widgets/strategies-list/strategies-list';

async function loadStrategies() {
  const client = createServerApiClient();

  try {
    return await client.fetchTradingStrategies();
  } catch {
    return [] as TradingStrategy[];
  }
}

type StrategyPageProps = {
  searchParams?: { id?: string };
};

export default async function StrategyPage({ searchParams }: StrategyPageProps) {
  const strategies = await loadStrategies();
  const selectedId = searchParams?.id ?? null;

  return <StrategiesList strategies={strategies} selectedId={selectedId} />;
}
```

- [ ] Run typecheck:

```bash
pnpm --filter web typecheck
```

Expected: no errors.

- [ ] Commit:

```bash
git add apps/web/src/_pages/strategy-page/strategy-page.tsx
git commit -m "feat(web): pass selectedId from searchParams to StrategiesList"
```

---

### Task 8: Create mobile detail route `/strategy/[id]`

**Files:**
- Create: `apps/web/src/app/strategy/[id]/page.tsx`

- [ ] Create the directory and file `apps/web/src/app/strategy/[id]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { createServerApiClient } from '@web/shared/auth/api-auth';
import { StrategyDetailPanel } from '@web/widgets/strategies-list/strategy-detail-panel';

type Props = {
  params: { id: string };
};

export default async function StrategyDetailRoute({ params }: Props) {
  const client = createServerApiClient();

  let strategy;
  try {
    strategy = await client.fetchTradingStrategyById(params.id);
  } catch {
    notFound();
  }

  return (
    <main className="dashboard-shell">
      <div className="strat-detail-page">
        <Link href="/strategy" className="strat-back-btn">
          ← Back to Strategies
        </Link>
        <StrategyDetailPanel strategy={strategy} />
      </div>
    </main>
  );
}
```

- [ ] Run typecheck:

```bash
pnpm --filter web typecheck
```

Expected: no errors.

- [ ] Commit:

```bash
git add apps/web/src/app/strategy/[id]/page.tsx
git commit -m "feat(web): add /strategy/[id] mobile detail route"
```

---

### Task 9: Delete `strategies-table.tsx` and final cleanup

**Files:**
- Delete: `apps/web/src/widgets/strategies-list/strategies-table.tsx`

- [ ] Delete the old table component:

```bash
rm apps/web/src/widgets/strategies-list/strategies-table.tsx
```

- [ ] Run typecheck to confirm no remaining imports:

```bash
pnpm --filter web typecheck
```

Expected: no errors. If there are import errors pointing to `strategies-table`, search for remaining references:

```bash
grep -r "strategies-table" apps/web/src/
```

Fix any remaining imports.

- [ ] Run full build to confirm everything compiles:

```bash
pnpm --filter web build
```

Expected: build succeeds with no TypeScript errors.

- [ ] Commit:

```bash
git add -A
git commit -m "feat(web): strategy page redesign — split layout desktop, card grid mobile"
```

- [ ] Push:

```bash
git push origin main
```

---

### Task 10: Add feature doc

**Files:**
- Create: `docs/features/strategy-page/strategy-page.md`

- [ ] Create `docs/features/strategy-page/strategy-page.md`:

```markdown
## Description
The `/strategy` page manages trading strategies. On desktop it shows a split layout: strategy list on the left, full content panel on the right. On mobile it shows a 2-column card grid; tapping a card navigates to `/strategy/[id]` for the full detail view.

## Main Flow
1. Server Component (`_pages/strategy-page/strategy-page.tsx`) fetches all strategies and reads `searchParams.id`.
2. Passes `strategies` + `selectedId` to `StrategiesList` (client).
3. **Desktop**: `StrategiesSplit` renders list + detail panel. Clicking a list item pushes `?id=xxx` to the router. `StrategyDetailPanel` handles edit/delete dialogs.
4. **Mobile**: `StrategiesCardGrid` renders cards as `<Link href="/strategy/[id]">`. Tapping navigates to the detail route.
5. `/strategy/[id]` (Server Component) fetches the strategy by id and renders `StrategyDetailPanel` with a back button.

## Edge Cases
- No strategies: both layouts show an empty state message.
- Invalid `?id` on desktop: detail panel shows placeholder ("Select a strategy to view details").
- Strategy not found on `/strategy/[id]`: Next.js `notFound()` renders the 404 page.
- After delete: `router.push('/strategy')` clears the selection and returns to list root.

## Related Files (FE)
- `apps/web/src/_pages/strategy-page/strategy-page.tsx` — server component, data fetching
- `apps/web/src/widgets/strategies-list/strategies-list.tsx` — client orchestrator, create dialog
- `apps/web/src/widgets/strategies-list/strategies-split.tsx` — desktop split layout
- `apps/web/src/widgets/strategies-list/strategies-card-grid.tsx` — mobile card grid
- `apps/web/src/widgets/strategies-list/strategy-detail-panel.tsx` — shared detail view, edit/delete dialogs
- `apps/web/src/app/strategy/[id]/page.tsx` — mobile detail route
- `apps/web/src/shared/api/client.ts` — `fetchTradingStrategyById` added
- `apps/web/src/app/globals.css` — `strat-*`, `sgrid-*` CSS classes
```

- [ ] Commit:

```bash
git add docs/features/strategy-page/strategy-page.md
git commit -m "docs: add strategy page feature documentation"
```

- [ ] Push:

```bash
git push origin main
```
