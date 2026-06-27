## Description
Top Cap Radar is a manually-curated watchlist that runs the same daily signal scan as
Small Cap Radar (RSI, volume multiplier, EMA34/89/200 alignment, stage classification,
30-day sparkline). It is a clone of the Small Cap Radar feature with the coin-list **sync
removed** — coins are entered by hand instead of being auto-discovered from
Binance/CoinGecko by market cap. It stores its own watchlist in dedicated tables, fully
independent of Small Cap Radar.

## Main Flow
1. User opens `/top-cap-radar`. The page server-fetches the watchlist via
   `GET /top-cap-radar` and renders `TopCapRadarFeed`.
2. User adds coins manually with the **+ Coin** form (`POST /top-cap-radar/coins`) or
   removes them (`DELETE /top-cap-radar/coins/:symbol`).
3. A scheduled worker cron (`runTopCapScan`, daily at 00:10 UTC) fetches 1d Binance klines
   for each watchlist coin, computes the signal via `computeSmallCapSignal`, and upserts a
   `TopCapSignal` row for today.
4. User can also trigger an on-demand scan with **⚡ Re-analyze** (`POST /top-cap-radar/scan`)
   or reload the table with **↻ Refresh**.
5. The table supports stage filters, symbol/name search, sorting (signal/rsi/vol/ext/coin),
   and pagination. Clicking a row opens the TradingView chart.

## Edge Cases
- Coins with fewer than 210 daily candles are skipped (signal needs EMA200 history).
- Listing date is backfilled lazily on first scan (non-fatal if the lookup fails).
- A coin with no signal yet shows "—" cells and is always visible (not hidden by stage filter).
- Server-side fetch failure on the page falls back to an empty list rather than erroring.
- Unlike Small Cap Radar, there is **no `rescan-coins` / Sync Coins** path, so the watchlist
  is never auto-pruned — removing a coin is always a manual delete.

## Related Files (FE / BE / Worker)
- `apps/web/src/app/top-cap-radar/page.tsx` — route re-export
- `apps/web/src/_pages/top-cap-radar-page/top-cap-radar-page.tsx` — server component, loads watchlist
- `apps/web/src/widgets/top-cap-radar/top-cap-radar-feed.tsx` — client UI (reuses `.scr-*` styles)
- `apps/web/src/shared/api/client.ts` — `fetchTopCapRadar`, `addTopCapCoin`, `removeTopCapCoin`, `triggerTopCapScan`
- `apps/web/src/shared/api/types.ts` — `TopCapCoinRow`
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav entry
- `apps/api/src/modules/top-cap-radar/top-cap-radar.controller.ts` — REST endpoints (no rescan)
- `apps/api/src/modules/top-cap-radar/top-cap-radar.service.ts` — list/add/remove/triggerScan
- `apps/api/src/modules/top-cap-radar/dto/add-coin.dto.ts` — add-coin validation
- `apps/api/src/app.module.ts` — registers `TopCapRadarModule`
- `apps/worker/src/modules/top-cap-scan/top-cap-scan.service.ts` — daily scan logic
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — `runTopCapScan` cron (00:10 UTC)
- `packages/db/src/repositories/top-cap-radar.repository.ts` — coin + signal persistence
- `packages/db/prisma/schema.prisma` — `TopCapCoin`, `TopCapSignal` models
- `packages/db/prisma/migrations/20260625130000_add_top_cap_radar/migration.sql` — creates the tables
