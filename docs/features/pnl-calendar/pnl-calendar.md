## Description
`/pnl-calendar` is the P&L hub: one page, three tabs over the same calendar chrome.

| Tab | `?tab=` | Content |
|-----|---------|---------|
| **Tổng hợp** (default) | `overview` | Combined calendar (trading + portfolio realized P&L per day), scope/all-time split by source, and two clickable per-source summary cards |
| **Giao dịch** | `trading` | The trading calendar: realized PnL per day/month, performance stats, PnL-by-symbol |
| **Portfolio** | `portfolio` | Spot-portfolio realized P&L per day/month + profit/loss-day stats |

The Giao dịch tab aggregates **every** closed trade the app knows about — manual `Order` rows *and* the Bitget/MEXC/OKX futures trades that live in their own tables. The Portfolio tab is a different money stream entirely (`Holding`/`CoinTransaction` sells), which is why the Tổng hợp tab reports them both separately as well as summed.

`/portfolio-pnl` was the standalone portfolio calendar; it is now a `redirects()` entry in `next.config.js` pointing at `/pnl-calendar?tab=portfolio`, so old links and bookmarks still land in the right place. It is **not** an `app/` page calling `redirect()` — that route has no dynamic data, so Next prerenders it static, and a build-time `redirect()` is baked into the HTML as an error page rather than served as an HTTP redirect. The config redirect is a real 307 resolved before the page ever renders (and before `middleware.ts`, so an unauthenticated hit redirects here first and then on to `/login`).

Cards elsewhere in the app deep-link to the tab they summarise:
- Overview "Total Profit / Loss" card → `?tab=trading`
- Trades page "Total Profit/Loss" card → `?tab=trading`
- Portfolio "All-Time P&L" figure on the allocation chart → `?tab=portfolio`

## Main Flow
1. `app/pnl-calendar/page.tsx` (Server Component) fetches five sources in parallel:
   - `fetchOrders({ status: 'closed', pageSize: 1000 })` — manual orders
   - `fetchBitgetHistory({ limit: 500 })` — Bitget closed trades
   - `fetchMexcHistory({ limit: 500 })` — MEXC closed trades
   - `fetchOkxHistory({ limit: 500 })` — OKX closed trades
   - `fetchPortfolioPnlCalendar()` — `{ daily, byCoin }` realized P&L from the spot portfolios
2. Exchange trades are mapped to the `DashboardOrder` shape by `mapExchangeClosedTrades` (`shared/api/exchange-orders.ts`): `holdSide → side`, `openAvgPrice → entryPrice`, `netProfit → pnl`, `size → quantity`, `exchange`/`source` set to `bitget` / `mexc` / `okx`, id prefixed (`bitget:<positionId>`) so it can never collide with an `Order` id.
3. `parseTab(searchParams.tab)` resolves the initial tab; anything unrecognised falls back to `overview`.
4. `PnlHubPage` (Client Component) owns the tab, the day/month view mode, and the year/month cursor. All three tabs share **one** navigation state, so switching tabs keeps the month you were looking at.
5. Each tab derives its own day/month maps from the props and renders `CalendarGrid` plus its own sidebar. The Tổng hợp tab sums the two maps key-by-key (`mergeMaps`).
6. Switching tabs writes `?tab=` with `window.history.replaceState` — **not** `router.replace`, because a real navigation would re-run the server fetch (1000 orders + three exchange histories) on every tab click.

## Edge Cases
- **Overview card vs this page** — the Total Profit / Loss card on `/` sums `closedPnlSum + Bitget + MEXC + OKX`, and this page sums the same four sources. They are computed independently, so an exchange added to one and not the other makes them disagree by exactly that exchange's realized total — which is what happened to OKX (245.78 vs 244.88, fixed 2026-08-17). Add a new exchange to both call sites in the same change.
- **Exchange not configured / API error** — each fetch has its own `.catch()` returning `[]` (orders/history) or an empty `{ daily: [], byCoin: [] }` calendar, so a broken Bitget key or a portfolio API failure never blanks the page; the remaining tabs still render real data.
- **History limit** — `/bitget/history`, `/mexc/history` and `/okx/history` cap `limit` at 500 server-side (`EXCHANGE_HISTORY_LIMIT`). Beyond 500 closed trades per exchange the oldest ones fall out of both the calendar and the "all-time" total.
- **PnL %** — `PerformanceStats` computes percentages as `pnl / (entryPrice * quantity)`, i.e. against **notional**, not margin. Leveraged Bitget/MEXC/OKX trades therefore show a smaller % than the exchange's own margin-based `netProfitPct`.
- **Open positions** — only trades with both `closedAt` and a non-null `pnl` are counted; open Bitget/MEXC/OKX positions and their unrealized PnL are excluded.
- **Timezone** — day/month bucketing uses the browser's local timezone (`new Date(closedAt).getMonth()`), while the exchanges report UTC close times. The portfolio side parses `YYYY-MM-DD` strings, which `new Date()` reads as UTC midnight — in a negative-offset timezone that would shift a day earlier.
- **Contribution split** — the Tổng hợp sidebar splits on `|trading| / (|trading| + |portfolio|)`, absolute values, so a losing source still shows a share of the bar rather than a negative width.
- **Combined day cells** — a day where trading and portfolio P&L have opposite signs shows only the net; the per-source figures live in the sidebar and the two source cards.
- **Mobile** — the tab strip scrolls horizontally instead of wrapping; the source-card grid collapses to one column.

## Related Files (FE / BE / Worker)
- `apps/web/src/app/pnl-calendar/page.tsx` — server-side fetch + merge of the five sources (manual orders, Bitget, MEXC, OKX, portfolio), resolves the initial tab
- `apps/web/next.config.js` — `redirects()`: `/portfolio-pnl` → `/pnl-calendar?tab=portfolio`
- `apps/web/src/_pages/pnl-hub-page/pnl-hub-page.tsx` — tab strip, shared view-mode/month navigation
- `apps/web/src/_pages/pnl-hub-page/overview-tab.tsx` — combined calendar, source split, clickable per-source summary cards
- `apps/web/src/_pages/pnl-hub-page/trading-tab.tsx` — trading sidebar, performance stats, PnL-by-symbol
- `apps/web/src/_pages/pnl-hub-page/portfolio-tab.tsx` — portfolio sidebar (profit/loss days, best/worst day)
- `apps/web/src/_pages/pnl-hub-page/calendar-grid.tsx` — the day/month calendar surface shared by all three tabs
- `apps/web/src/_pages/pnl-hub-page/shared.ts` — VI date labels, formatters, order/daily grouping helpers, and the `TABS` / `parseTab` definitions. Deliberately has **no** `'use client'`: the route page is a Server Component and cannot call a plain function exported from a client module (it can only render one as a component), so `parseTab` must live outside `pnl-hub-page.tsx`.
- `apps/web/src/app/globals.css` — `.pnl-tabs`, `.pnl-src-card`, `.pnl-split-bar` (plus the existing `.pnl-cal-*` / `.perf-*` rules)
- `apps/web/src/shared/api/exchange-orders.ts` — `mapExchangeClosedTrades`, `EXCHANGE_HISTORY_LIMIT`
- `apps/web/src/_pages/overview-page/overview-page.tsx` — "Total Profit / Loss" card → `?tab=trading`
- `apps/web/src/widgets/trades-history/trades-table.tsx` — trades "Total Profit/Loss" card → `?tab=trading`
- `apps/web/src/widgets/holdings-allocation-chart/holdings-allocation-chart.tsx` — "All-Time P&L" → `?tab=portfolio`
- `apps/web/src/shared/api/client.ts` — `fetchOrders`, `fetchBitgetHistory`, `fetchMexcHistory`, `fetchOkxHistory`, `fetchPortfolioPnlCalendar`
- `apps/api/src/modules/portfolio/portfolio.service.ts` — `getPnlCalendar()` behind `GET /portfolios/pnl-calendar`
- `apps/api/src/modules/bitget/bitget.controller.ts` — `GET /bitget/history` (limit capped at 500)
- `apps/api/src/modules/mexc/mexc.controller.ts` — `GET /mexc/history`
- `apps/api/src/modules/okx/okx.controller.ts` — `GET /okx/history`
