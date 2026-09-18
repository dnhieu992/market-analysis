## Description
The `/strategy` page (nav label **"Strategy Analysis"**, positioned right under Overview) manages trading strategies. On desktop the strategy selector is a **row of chip buttons on the first row** (under the page header); the selected strategy renders full-width below in a sectioned detail panel. On mobile it shows a 2-column card grid; tapping a card navigates to `/strategy/[id]` for the full detail view.

The detail panel has three parts: a **header** (name, version, created/updated dates, Edit/Delete), a **📊 Backtest & mô tả** section rendering `content` as markdown (tables/headings via `renderMarkdown`), and a **📝 Ghi chú của tôi** section — a persisted personal note (`TradingStrategy.note`, separate from `content`) with inline add/edit/save.

## Main Flow
1. Server Component (`_pages/strategy-page/strategy-page.tsx`) fetches all strategies and reads `searchParams.id`.
2. Passes `strategies` + `selectedId` to `StrategiesList` (client).
3. **Desktop** (`≥768px`): `StrategiesSplit` renders the chip selector row + full-width detail panel. Clicking a chip pushes `?id=xxx`; when the URL has no/unknown id it falls back to the first strategy so the panel is never empty. `StrategyDetailPanel` (tabbed: Backtest | Ghi chú) handles edit/delete dialogs.
4. **Mobile** (`<768px`): `StrategiesCardGrid` renders cards as `<Link href="/strategy/[id]">`. Tapping navigates to the detail route.
5. `/strategy/[id]` (Server Component) fetches the strategy by id via `.catch(() => null)` and calls `notFound()` if missing, otherwise renders `StrategyDetailPanel` with a Back link.

## Personal Note
- `StrategyNoteSection` (in `strategy-detail-panel.tsx`) renders `strategy.note` as markdown when present, else an empty-state prompt.
- Editing opens an inline textarea; **Lưu** calls `updateTradingStrategy(id, { note })` (empty → `null` to clear) then `router.refresh()`.
- **The note is the only field editable from the UI.** The header has a **Xoá** (delete) action only — there is no content/name/version editor on the page, so the backtest `content` is read-only (edit it via the seed script / DB if it needs to change). `EditStrategyForm` still exists in the codebase but is no longer wired into the panel.
- Stored on the `TradingStrategy.note` `TEXT NULL` column (migration `20260918120000_add_strategy_note`). API accepts it via `note?` on Create/Update DTOs.

## Edge Cases
- No strategies: both layouts show an empty state message.
- Empty/whitespace note is saved as `null` (clears it) and shows the empty-state prompt.
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
