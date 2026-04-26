## Description
The `/strategy` page manages trading strategies. On desktop it shows a split layout: strategy list on the left, full content panel on the right. On mobile it shows a 2-column card grid; tapping a card navigates to `/strategy/[id]` for the full detail view.

## Main Flow
1. Server Component (`_pages/strategy-page/strategy-page.tsx`) fetches all strategies and reads `searchParams.id`.
2. Passes `strategies` + `selectedId` to `StrategiesList` (client).
3. **Desktop** (`≥768px`): `StrategiesSplit` renders list + detail panel. Clicking a list item pushes `?id=xxx` to the router. `StrategyDetailPanel` handles edit/delete dialogs.
4. **Mobile** (`<768px`): `StrategiesCardGrid` renders cards as `<Link href="/strategy/[id]">`. Tapping navigates to the detail route.
5. `/strategy/[id]` (Server Component) fetches the strategy by id via `.catch(() => null)` and calls `notFound()` if missing, otherwise renders `StrategyDetailPanel` with a Back link.

## Edge Cases
- No strategies: both layouts show an empty state message.
- Invalid or missing `?id` on desktop: detail area shows placeholder ("Select a strategy to view details").
- Strategy not found on `/strategy/[id]`: Next.js `notFound()` renders the 404 page.
- After delete: `router.push('/strategy')` clears selection and returns to list root. Delete failure shows an inline error message in the confirm dialog.
- Both layouts are always mounted; CSS (`strat-split-wrapper` / `sgrid-wrapper`) toggles visibility at 768px breakpoint.

## Related Files (FE)
- `apps/web/src/_pages/strategy-page/strategy-page.tsx` — server component, data fetching, reads `searchParams.id`
- `apps/web/src/widgets/strategies-list/strategies-list.tsx` — client orchestrator, create dialog, layout wrappers
- `apps/web/src/widgets/strategies-list/strategies-split.tsx` — desktop split layout, `useRouter` for `?id` param
- `apps/web/src/widgets/strategies-list/strategies-card-grid.tsx` — mobile card grid, Link navigation
- `apps/web/src/widgets/strategies-list/strategy-detail-panel.tsx` — shared detail view, edit/delete dialogs with error handling
- `apps/web/src/app/strategy/[id]/page.tsx` — mobile detail route, server component
- `apps/web/src/shared/api/client.ts` — `fetchTradingStrategyById` method
- `apps/web/src/app/globals.css` — `strat-*`, `sgrid-*`, `strat-split-wrapper`, `sgrid-wrapper` CSS classes
