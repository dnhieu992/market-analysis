# Strategy Page Redesign

Date: 2026-04-26

## Goal

Replace the plain table UI on `/strategy` with a responsive layout:
- **Desktop (≥768px)**: split layout — list on the left, detail panel on the right
- **Mobile (<768px)**: card grid — click a card navigates to `/strategy/[id]` full detail page

---

## Layout

### Desktop — Split Layout

```
┌─────────────────────────────────────────────────────┐
│ Strategies                          [+ Add Strategy] │
├──────────────────┬──────────────────────────────────┤
│ rsi-reversal     │  rsi-reversal          v1.0.0    │
│ price-action  ◀  │  Created: 16/04/2026             │
│ ema-crossover    │                                  │
│ FOMO mind cap    │  RSI Reversal Strategy           │
│                  │  Timeframe: 4h                   │
│                  │  Indicators: RSI(14), ATR(14)    │
│                  │  ...                             │
│                  │                                  │
│                  │  [Edit]  [Delete]                │
└──────────────────┴──────────────────────────────────┘
```

- Clicking a list item updates the query param `?id=[strategyId]` — no full page reload
- The selected strategy panel shows: name, version badge, created date, full content, Edit + Delete actions
- Edit opens the existing dialog. Delete opens the existing confirm dialog.
- If no `?id` param or the id is invalid, the panel shows an empty state: "Select a strategy to view details"

### Mobile — Card Grid

```
┌─────────────────────────┐
│ Strategies  [+ Add]     │
├─────────────────────────┤
│ ┌─────────┐ ┌─────────┐ │
│ │rsi-rev  │ │price-ac │ │
│ │v1.0.0   │ │v1.0.0   │ │
│ │RSI Rev. │ │Multi-TF │ │
│ │Strategy…│ │Price…   │ │
│ │16/04    │ │16/04    │ │
│ └─────────┘ └─────────┘ │
└─────────────────────────┘
```

- 2-column card grid
- Each card shows: name (bold), version badge, content preview (2 lines, ellipsis), created date
- Clicking a card navigates to `/strategy/[id]`

### Mobile — Detail Page (`/strategy/[id]`)

- Back button → `/strategy`
- Full content display (no truncation)
- Edit (opens dialog) + Delete (confirm dialog) actions
- If strategy not found → redirect to `/strategy`

---

## Routing

| Route | Behaviour |
|-------|-----------|
| `/strategy` | Desktop: split layout with `?id` param for selection. Mobile: card grid. |
| `/strategy/[id]` | Mobile: full detail page (Server Component). Desktop: redirect to `/strategy?id=[id]`. |

The desktop redirect from `/strategy/[id]` uses `redirect()` from `next/navigation` inside a Server Component, conditional on viewport detection via CSS only — no JS redirect. Actually, since we can't detect screen size in a Server Component, the `/strategy/[id]` page will render the mobile detail layout regardless of screen size (it's only reachable via mobile card tap in practice). Desktop users who land on that URL will see the detail page, which is acceptable.

---

## Components

### New / Modified

| File | Action | Description |
|------|--------|-------------|
| `widgets/strategies-list/strategies-list.tsx` | Modify | Remove `StrategiesTable` usage; render `StrategiesSplitLayout` (desktop) and `StrategiesCardGrid` (mobile) — toggled via CSS |
| `widgets/strategies-list/strategies-table.tsx` | Delete | Replaced by split + card grid |
| `widgets/strategies-list/strategies-split.tsx` | Create | Desktop split: left list + right detail panel |
| `widgets/strategies-list/strategies-card-grid.tsx` | Create | Mobile card grid |
| `widgets/strategies-list/strategy-detail-panel.tsx` | Create | Shared component: full content display, Edit/Delete buttons. Used by desktop panel and mobile detail page. |
| `app/strategy/[id]/page.tsx` | Create | Server Component: fetches strategy by id, renders mobile detail page |
| `_pages/strategy-page/strategy-page.tsx` | Modify | Accept and pass `searchParams.id` to `StrategiesList` |
| `shared/api/client.ts` | Modify | Add `fetchTradingStrategyById(id)` method |

### Unchanged

- `features/create-strategy/create-strategy-form.tsx`
- `features/edit-strategy/edit-strategy-form.tsx`
- Dialog infrastructure in `strategies-list.tsx`

---

## State Management

### Desktop (split layout)
- Selected strategy driven by URL query param `?id=[strategyId]`
- `StrategiesPage` (server component) reads `searchParams.id`, passes selected strategy to `StrategiesList`
- Clicking a list item uses `router.push('/strategy?id=xxx')` — shallow navigation

### Mobile (card grid)
- No local state needed — card click uses `<Link href="/strategy/[id]">` (full navigation)
- Detail page is a Server Component fetching data directly

---

## API Client Addition

```ts
async fetchTradingStrategyById(id: string): Promise<TradingStrategy> {
  const row = await fetchJson<JsonRecord>(fetchImpl, `${baseUrl}/strategies/${id}`, withDefaults());
  return mapTradingStrategy(row);
}
```

---

## CSS

New classes added to `globals.css` (namespaced `strat-*` for split layout, `sgrid-*` for card grid):

```
.strat-split          — desktop 2-column grid (220px list + 1fr panel)
.strat-list-item      — clickable list row, active state
.strat-detail-panel   — white surface card, full content
.sgrid-grid           — 2-col card grid (mobile)
.sgrid-card           — individual card
.sgrid-card-name      — bold strategy name
.sgrid-card-preview   — 2-line content preview
```

Responsive toggle:
```css
.strat-split  { display: none; }
.sgrid-grid   { display: grid; }

@media (min-width: 768px) {
  .strat-split  { display: grid; }
  .sgrid-grid   { display: none; }
}
```

---

## Edge Cases

- **No strategies**: empty state in both layouts ("No strategies yet. Add one to get started.")
- **Invalid `?id` on desktop**: detail panel shows empty state, no error thrown
- **Strategy not found on `/strategy/[id]`**: `notFound()` from Next.js (renders 404)
- **Delete from detail panel**: after delete, navigate to `/strategy` (list root)
- **Add strategy on mobile**: `+ Add Strategy` button opens the same create dialog (overlay)

---

## Related Files

- `apps/web/src/widgets/strategies-list/strategies-list.tsx`
- `apps/web/src/widgets/strategies-list/strategies-table.tsx` (to be deleted)
- `apps/web/src/widgets/strategies-list/strategies-split.tsx` (new)
- `apps/web/src/widgets/strategies-list/strategies-card-grid.tsx` (new)
- `apps/web/src/widgets/strategies-list/strategy-detail-panel.tsx` (new)
- `apps/web/src/app/strategy/[id]/page.tsx` (new)
- `apps/web/src/_pages/strategy-page/strategy-page.tsx`
- `apps/web/src/shared/api/client.ts`
- `apps/web/src/app/globals.css`
