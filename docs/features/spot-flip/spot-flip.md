## Description
`/spot-flip` ("Spot Flip") is an on-demand tool for short-term spot swing trading ("lướt spot").
Given a coin symbol it computes, from live Binance klines, where price sits in its recent range and
how much it normally moves per day, then feeds a fee-net take-profit / stop-loss calculator. It exists
so the user can quickly judge **whether to enter a dip and where to realistically take profit**, instead
of eyeballing a raw % change. All price metrics are computed fresh from public Binance endpoints on each view; the only persisted state is a small **watchlist** (`spot_flip_watch`) that remembers which coins to show.

## Watchlist (persisted, soft-delete)
The set of coins on the page is a per-user watchlist stored in MySQL (`SpotFlipWatch` model → `spot_flip_watch` table: `symbol` unique, `name`, `addedAt`, **`disabledAt` nullable**). It is seeded by the migration with the five defaults (BTC/ETH/SOL/BNB/XRP) so the page looks the same as before on first run.
- **Add**: typing a symbol + **Thêm** → `analyzeSpotFlip` validates the symbol first, then `POST /spot-flip/watchlist` persists the normalized pair (upsert). Re-adding a previously-removed coin **re-activates** it (`disabledAt` → null), so it reappears with its history intact.
- **Remove (soft-delete + confirm)**: each card shows a ✕ button (top-right, revealed on hover / always visible on touch). Clicking it opens a **confirm dialog** ("Bỏ theo dõi X?"). On confirm the card is optimistically hidden and `DELETE /spot-flip/watchlist/:symbol` **soft-deletes** the row (sets `disabledAt = now()`; the row is kept). `findAll()` only returns rows where `disabledAt IS NULL`. Removing the open detail dialog's coin also closes it.
- **Filter**: a text input under the add box filters the *currently shown* cards by base symbol / pair / full name (case-insensitive) — purely client-side, does not hit the API. (Replaced the old quick-add chip row.)
- **Empty**: if every coin is removed the list shows a "Chưa theo dõi coin nào" hint; if a filter matches nothing it shows a "Không có coin nào khớp …" hint.

## UI
`/spot-flip` renders as a **vertical list of coin cards** (rounded ~20px cards, light gray `#F7F7F8` background, 16px apart). On load the page fetches the watchlist and analyzes each coin in saved order; the search box **adds** a coin to the top of the list (deduped by symbol) instead of replacing a single result.

Each card has:
- **Header** — round avatar (deterministic color + base-asset initials), base symbol in bold uppercase, full coin name in gray below (from `COIN_NAMES`, falls back to the `BASE / QUOTE` pair); right-aligned current price (bold) with the 24h change below it (green ▲ if up, red ▼ if down).
- **Dual up/down bar** — one continuous bar showing the *remaining room* in the 30-day range: green "tăng giá" = headroom up to the high (share of `pullbackPct`), red "giảm giá" = downside to the low (share of `reboundPct`), normalized to 100%. The nearer price sits to the 30-day high, the smaller the green share (less room to rise). Labels sit above the bar (green left, red right).
- **Summary line** — short Vietnamese take on dip depth (in ATR units) and stance.
- **Detail dialog** (tap anywhere on the card to open) — a modal (`.dialog--wide`) with **3 tabs**:
  1. **Thông tin chung** — range/dip/ATR metric grid (cách đỉnh, trên đáy, biên ngày, độ sâu nhịp chỉnh), the dual up/down bar, and a 5-cell momentum row (1H/4H/24H/7N/30N, green/red).
  2. **Lịch sử** — two tables. First, the **stored daily analysis history** (from `spot_flip_daily`, fetched via `GET /spot-flip/history/:symbol` when the tab opens): date, price, the **Tăng / Giảm** ratio (green up% / red down%), and the auto-generated **Nhận định** (stance note). Shows "Chưa có snapshot phân tích nào" until the 00:15 UTC job has run at least once. Below it, the live **daily OHLC price history** table (last 30 completed days: date, open, close, and % change vs the previous day's close) — the **Biến động** column renders as a colored **pill badge** (green background for up, red for down, gray for neutral).
  3. **Tín hiệu lệnh** — a signal banner (dip-depth stance) + the fee-net TP/SL flip calculator (state seeded per-card from that coin's ATR).
  Close via the ✕ button, backdrop click, or `Escape`. Tab defaults to **Thông tin chung** on open.

## Daily snapshot job (worker, 00:15 UTC)
A worker cron (`SchedulerService.runSpotFlipDaily`, `@Cron('15 0 * * *', UTC)`) persists one analysis snapshot per watched coin per day into `spot_flip_daily`, so the page can show how each coin's position evolved over time.
- For every **active** watchlist coin (`createSpotFlipWatchRepository().findAll()` — soft-deleted coins are skipped), `SpotFlipDailyService` fetches live price + 1h/1d klines, runs the shared `computeSpotFlip` (from `@app/core`, the exact same math the API's on-demand view uses), then derives the up/down ratio (`spotFlipShares`) and an auto Vietnamese stance note (`spotFlipSummary`).
- Persisted fields: `price`, `upPct`/`downPct` (the dual-bar shares = tỉ lệ tăng/giảm %), `pullbackPct`, `reboundPct`, `atrPct`, `high30d`, `low30d`, `changeH24`, and `notes` (the stance).
- **Idempotent per day**: rows are keyed by `(symbol, date)` (date bucketed to 00:00 UTC) and **upserted**, so re-running the job the same day overwrites rather than duplicating.
- Non-fatal per coin: a single symbol failing (`Promise`-less loop with try/catch) just logs a warning and continues; coins with < 2 candles are skipped.
- The shared math lives in `packages/core/src/analysis/spot-flip.ts` — extracted from the old inline API service so the worker and API never diverge.
- **Manual trigger**: `scripts/run-spot-flip-snapshot.ts` instantiates the same `SpotFlipDailyService` and runs `runDaily()` once against the live DB — used to seed today's data immediately instead of waiting for the cron. Run with `set -a && source .env && set +a && pnpm ts-node --transpile-only --project apps/worker/tsconfig.json scripts/run-spot-flip-snapshot.ts`.

## Auto-refresh
The card list auto-refreshes once a day at **00:08 UTC** (a few minutes after the daily candle closes at 00:00 UTC) so each card's history and metrics pick up the freshly completed day. A single `setTimeout` is scheduled to the next 00:08 UTC boundary; on fire it re-runs `analyzeSpotFlip` for every currently shown symbol (via a `cardsRef` so the one-time timer reads the live symbol list) and reschedules for the next day. An open dialog reflects the update automatically because it reads its data from the live `cards` state by symbol.

Colors: green `#00C896`, red `#F6465D`, muted gray `#9B9B9B`, price/name near-black `#17120D`.

## Main Flow
1. User opens `/spot-flip`; the web fetches the watchlist (`GET /spot-flip/watchlist`) and analyzes each saved coin as a card. To add another coin, they type a symbol (e.g. `BTC`, `SOL`, `PEPE`) and hit **Thêm** → the coin is validated, persisted to the watchlist, and prepended to the list. A separate filter box narrows the shown cards by name.
2. Web calls `GET /spot-flip?symbol=…` → `SpotFlipService.analyze()` for each symbol.
3. Service normalizes the symbol (bare `BTC` → `BTCUSDT`) and fetches in parallel:
   - `ticker/price` (live price)
   - `1h` klines (limit 200) — intraday momentum
   - `1d` klines (limit 40) — 30d range + ATR
4. Service computes:
   - **Momentum**: % change over 1h / 4h / 24h / 7d (hourly) and 30d (daily).
   - **Dip depth**: `(high30d − price) / high30d` — how far below the 30d high.
   - **Rebound**: `(price − low30d) / low30d` — how far above the 30d low.
   - **ATR%**: average of `(high − low) / close` over the last 14 completed daily candles (daily-range proxy).
   - **History**: last 30 completed daily candles (newest first) → `{ date, open, close, changePct }`, where `changePct` is close vs the previous day's close.
5. Web renders/updates that coin's card (header + dual bar + summary); tapping the card opens the 3-tab detail dialog (Thông tin chung / Lịch sử / Tín hiệu lệnh).
6. The calculator seeds Entry = current price, TP = `entry × (1 + 0.8·ATR%)`, SL = `entry × (1 − 0.6·ATR%)`,
   then reactively shows (all client-side, net of the 0.10% round-trip fee):
   - `tpNet% = (tp−entry)/entry×100 − 0.10`, and $ profit on the entered capital
   - `slNet%` and $ loss
   - `R:R = (tp−entry)/(entry−sl)` (flagged good when ≥ 1.5)
   - breakeven price = `entry × 1.001`
   User can override Entry/TP/SL/capital freely.

## Edge Cases
- **Bare / lowercase symbol** (`btc`, `sol`) → uppercased and `USDT` appended unless it already ends in a known quote (USDT/USDC/FDUSD/BUSD/BTC/ETH).
- **Unknown or delisted symbol / Binance error** → service throws `BadRequestException`; web shows a Vietnamese error and leaves the existing card list intact.
- **Preload failure** → watchlist coins are fetched with `Promise.allSettled`, so a single failing symbol just drops from the initial list without breaking the page.
- **Zero range** (`reboundPct + pullbackPct ≤ 0`) → dual bar falls back to a 50/50 split.
- **Thin history** (< 2 daily or hourly candles) → `BadRequestException` ("Not enough market history").
- **Missing lookback candle** (e.g. 7d window with < 168 hourly candles) → that change cell renders `—` (null), others still show.
- **In-progress candle** is excluded from 30d range and ATR (uses `daily.slice(0, -1)`); momentum refs use closed candles `k` steps back from the newest.
- **Non-numeric calculator input** → derived rows show `—`; entry ≤ 0 hides all results.

## Related Files (FE / BE / Worker)
- `packages/core/src/analysis/spot-flip.ts` — shared metric math: `computeSpotFlip`, `spotFlipShares`, `spotFlipSummary` (used by both API + worker) (CORE)
- `apps/api/src/modules/spot-flip/spot-flip.service.ts` — symbol normalization, Binance fetch, calls `computeSpotFlip`, `history()` reads stored snapshots, watchlist list/add/remove (BE)
- `apps/api/src/modules/spot-flip/spot-flip.controller.ts` — `GET /spot-flip`, `GET /spot-flip/history/:symbol`, `GET/POST /spot-flip/watchlist`, `DELETE /spot-flip/watchlist/:symbol` (BE)
- `apps/worker/src/modules/spot-flip-daily/spot-flip-daily.service.ts` — daily snapshot job: analyze each watched coin + upsert into `spot_flip_daily` (Worker)
- `apps/worker/src/modules/spot-flip-daily/spot-flip-daily.module.ts` — module wiring (Worker)
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — `runSpotFlipDaily` cron @ 00:15 UTC (Worker)
- `scripts/run-spot-flip-snapshot.ts` — manual one-off trigger for the daily snapshot (Worker/CLI)
- `packages/db/src/repositories/spot-flip-daily.repository.ts` — `createSpotFlipDailyRepository` (upsert / findBySymbol) (BE)
- `apps/api/src/modules/spot-flip/dto/add-watch.dto.ts` — add-to-watchlist body DTO (BE)
- `apps/api/src/modules/spot-flip/spot-flip.module.ts` — module wiring (BE)
- `packages/db/prisma/schema.prisma` — `SpotFlipWatch` model (BE)
- `packages/db/prisma/migrations/20260711120000_add_spot_flip_watch/migration.sql` — create table + seed defaults (BE)
- `packages/db/prisma/migrations/20260711140000_spot_flip_watch_soft_delete/migration.sql` — add `disabledAt` column for soft-delete (BE)
- `packages/db/prisma/schema.prisma` — also `SpotFlipDaily` model (daily snapshots) (BE)
- `packages/db/prisma/migrations/20260711150000_add_spot_flip_daily/migration.sql` — create `spot_flip_daily` table (BE)
- `packages/db/src/repositories/spot-flip-watch.repository.ts` — `createSpotFlipWatchRepository` (findAll filters `disabledAt IS NULL`; add re-activates; remove = soft-delete) (BE)
- `apps/api/src/app.module.ts` — registers `SpotFlipModule` (BE)
- `apps/web/src/app/spot-flip/page.tsx` — App Router route re-export (FE)
- `apps/web/src/_pages/spot-flip-page/spot-flip-page.tsx` — page component (FE)
- `apps/web/src/widgets/spot-flip/spot-flip-tool.tsx` — interactive tool: watchlist load, add + client-side filter, soft-delete with confirm dialog, dual bar, 3-tab detail dialog (general / history-with-color-badge / signal calculator), 00:08 UTC auto-refresh (FE)
- `apps/web/src/shared/api/types.ts` — `SpotFlipAnalysis` + `SpotFlipHistoryEntry` + `SpotFlipWatchItem` + `SpotFlipDailyEntry` types (FE)
- `apps/web/src/shared/api/client.ts` — `analyzeSpotFlip()`, `fetchSpotFlipHistory()`, `fetchSpotFlipWatchlist()`, `addSpotFlipWatch()`, `removeSpotFlipWatch()` client methods (FE)
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav entry (FE)
- `apps/web/src/app/globals.css` — `.sf-*` styles (FE)
