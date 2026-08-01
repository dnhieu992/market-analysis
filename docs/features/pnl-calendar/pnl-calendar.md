## Description
`/pnl-calendar` is the trading-calendar page: realized PnL per day / per month, plus performance stats and a PnL-by-symbol breakdown. It aggregates **every** closed trade the app knows about — manual `Order` rows *and* the Bitget/MEXC futures trades that live in their own tables. The overview page's "Total Profit / Loss" card shows the same combined all-time total and links here.

## Main Flow
1. `app/pnl-calendar/page.tsx` (Server Component) fetches three sources in parallel:
   - `fetchOrders({ status: 'closed', pageSize: 1000 })` — manual orders
   - `fetchBitgetHistory({ limit: 500 })` — Bitget closed trades
   - `fetchMexcHistory({ limit: 500 })` — MEXC closed trades
2. Exchange trades are mapped to the `DashboardOrder` shape by `mapExchangeClosedTrades` (`shared/api/exchange-orders.ts`): `holdSide → side`, `openAvgPrice → entryPrice`, `netProfit → pnl`, `size → quantity`, `exchange`/`source` set to `bitget` / `mexc`, id prefixed (`bitget:<positionId>`) so it can never collide with an `Order` id.
3. The merged array is passed to `PnlCalendarPage`, which groups by `closedAt` for the day/month grids and computes all stats from `pnl`.
4. The overview page (`_pages/overview-page/overview-page.tsx`) fetches the same two histories but only reads `summary.totalNetProfit`, adds them to `paginatedOrders.closedPnlSum`, and renders the combined figure in the "Total Profit / Loss" card. Only the total is shown — no per-source breakdown.

## Edge Cases
- **Exchange not configured / API error** — each history fetch has its own `.catch()` returning `0` (overview) or `[]` (calendar), so a broken Bitget or MEXC key never blanks the page; the remaining sources still render.
- **History limit** — `/bitget/history` and `/mexc/history` cap `limit` at 500 server-side (`EXCHANGE_HISTORY_LIMIT`). Beyond 500 closed trades per exchange the oldest ones fall out of both the calendar and the "all-time" total.
- **PnL %** — `PerformanceStats` computes percentages as `pnl / (entryPrice * quantity)`, i.e. against **notional**, not margin. Leveraged Bitget/MEXC trades therefore show a smaller % than the exchange's own margin-based `netProfitPct`.
- **Open positions** — only trades with both `closedAt` and a non-null `pnl` are counted; open Bitget/MEXC positions and their unrealized PnL are excluded.
- **Timezone** — day/month bucketing uses the browser's local timezone (`new Date(closedAt).getMonth()`), while the exchanges report UTC close times.

## Related Files (FE / BE / Worker)
- `apps/web/src/app/pnl-calendar/page.tsx` — server-side fetch + merge of the three trade sources
- `apps/web/src/_pages/pnl-calendar-page/pnl-calendar-page.tsx` — calendar grid, sidebar stats, performance stats, PnL-by-symbol
- `apps/web/src/shared/api/exchange-orders.ts` — `mapExchangeClosedTrades`, `EXCHANGE_HISTORY_LIMIT`
- `apps/web/src/_pages/overview-page/overview-page.tsx` — "Total Profit / Loss" card = manual + Bitget + MEXC realized PnL
- `apps/web/src/shared/api/client.ts` — `fetchOrders`, `fetchBitgetHistory`, `fetchMexcHistory`
- `apps/api/src/modules/bitget/bitget.controller.ts` — `GET /bitget/history` (limit capped at 500)
- `apps/api/src/modules/mexc/mexc.controller.ts` — `GET /mexc/history`
