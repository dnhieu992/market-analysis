## Description
A coin scanner that evaluates a user-defined watchlist against the UT Bot trailing stop indicator on the daily (1D) timeframe. Coins are classified as uptrend (close > stop) or downtrend (close ≤ stop). The watchlist is persisted in the `settings` table.

## Main Flow
1. User opens `/scanner` page — server loads the saved watchlist from `GET /scanner/watchlist`.
2. User adds/removes coins in the Watchlist section and optionally clicks **Save Watchlist** (`PUT /scanner/watchlist`) to persist changes.
3. User clicks **Scan** — client calls `POST /scanner/scan` with the current symbol list.
4. API fetches 100 daily candles per symbol from Binance, runs `calcUtBotResult()` (period=10, multiplier=1), and returns `{ symbol, trend, price, stopLevel }` for each.
5. Results are rendered in two groups: Uptrend (green) and Downtrend (red), each showing price, stop level, and distance gap (for uptrend coins).

## Edge Cases
- Fewer than 11 candles: API returns `error: 'Not enough candles'`, displayed inline in the row.
- Binance fetch failure: returns `error: 'Fetch failed'`, does not crash the full scan.
- Empty watchlist: Scan button is disabled.
- Save before scan: watchlist is saved independently from the scan run.

## Related Files (FE / BE / Worker)
- `apps/web/src/app/scanner/page.tsx` — Next.js route entry point
- `apps/web/src/_pages/scanner-page/scanner-page.tsx` — Server Component, loads initial watchlist
- `apps/web/src/widgets/scanner-feed/scanner-feed.tsx` — Client Component, watchlist editor + scan results UI
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — added Scanner nav item
- `apps/web/src/shared/api/client.ts` — `fetchScannerWatchlist`, `updateScannerWatchlist`, `scanUtBot`
- `apps/web/src/shared/api/types.ts` — `ScanResult` type
- `apps/api/src/modules/scanner/scanner.controller.ts` — `GET /scanner/watchlist`, `PUT /scanner/watchlist`, `POST /scanner/scan`
- `apps/api/src/modules/scanner/scanner.service.ts` — scan logic, watchlist CRUD
- `apps/api/src/modules/scanner/dto/update-scanner-watchlist.dto.ts` — request DTO
- `apps/api/src/modules/scanner/scanner.module.ts` — module wiring
- `apps/api/src/app.module.ts` — registers `ScannerModule`
- `packages/core/src/indicators/ut-bot.ts` — `calcUtBotResult()` indicator logic
- `packages/db/src/repositories/settings.repository.ts` — `upsertUtbotWatchlist()`
- `packages/db/prisma/schema.prisma` — `utbotWatchlist Json` field on `Settings`
- `packages/db/prisma/migrations/20260522100000_add_utbot_watchlist/migration.sql` — adds the column
