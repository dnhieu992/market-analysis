## Description

A triage layer for **meme coins that are listed on Binance**. It is a parallel clone of the [Small Cap Radar](../small-cap-radar/small-cap-radar.md): same daily D1 signal engine, same Stage classification, same Signal score (0–100), same Lottery (Xổ số) overlay — only the coin universe differs. Where Small Cap Radar tracks CoinGecko coins under $50M market cap, Meme Radar tracks the CoinGecko **`meme-token` category** (DOGE, SHIB, PEPE, WIF, BONK, FLOKI, …) with **no market-cap limit**, filtered to those that have a `SYMBOLUSDT` pair on Binance.

The table answers the same question — _"Which meme is worth opening a chart for right now?"_ — and is **not** a buy signal.

A cron job runs daily at **00:07 UTC**, fetches 220 D1 candles per coin from Binance, computes RSI / EMA / Vol× indicators, classifies each coin into a Stage, and stores a Signal score in the database. The web page shows results sorted by Signal descending, with Quiet coins hidden by default.

## Main Flow

1. **Cron (00:07 UTC)** — `SchedulerService.runMemeScan()` calls `MemeScanService.scanAll()`.
2. For each coin in `meme_coins`, fetches 220 daily candles from Binance (`SYMBOLUSDT`).
3. If `listingDate` is not yet stored, fires a non-blocking Binance call to record the coin's first ever candle date.
4. Computes `computeSmallCapSignal(closes, highs, lows, volumes)` from `@app/core` — the same generic D1 momentum/stage engine reused from Small Cap Radar.
5. Upserts result into `meme_signals` (unique on `coinId + date`) and appends to `meme_signal_history` only when the stage changes.
6. User opens `/meme-radar` — Server Component loads latest signals via `GET /meme-radar`.
7. Client widget renders the table: sort by Signal↓, stage filter chips (Quiet hidden by default), click row → TradingView, 🕒 opens the stage change-log modal.

## Toolbar Actions

| Button | Endpoint | Behaviour |
|---|---|---|
| ↻ Refresh | `GET /meme-radar` | Reload coin list + signals from API |
| ⚡ Re-analyze | `POST /meme-radar/scan` | Runs full signal scan synchronously, then reloads |
| ⟳ Sync Coins | `POST /meme-radar/rescan-coins` | Background job: pages CoinGecko `/coins/markets?category=meme-token`, keeps every meme with a Binance USDT pair (no cap), upserts coins + marketCap, prunes delisted (deletion skipped if 0 found) |
| + Coin | `POST /meme-radar/coins` | Add a single coin manually |

## Coin Universe Sync

`MemeRadarService.doRescanCoins()`:
1. Fetch all Binance `TRADING` USDT spot pairs → set of base symbols.
2. Page through CoinGecko `/coins/markets?category=meme-token&order=market_cap_desc&per_page=250` until a short/empty page.
3. Keep each meme coin whose symbol has a Binance USDT pair (deduped by symbol; first/highest-cap wins). **No market-cap filter and no large-cap blocklist** — unlike Small Cap Radar — because large memes (DOGE/SHIB/PEPE) are exactly the target here, and the large-cap blocklist would wrongly exclude them.
4. Upsert kept coins; delete coins no longer in the result set (skipped when the result is empty, to protect the watchlist on a CoinGecko failure).

Stages, Signal Score algorithm, extPct, and the Lottery (Xổ số) overlay are identical to Small Cap Radar — see that doc for the definitions.

## Edge Cases

- Fewer than 210 candles from Binance: coin skipped for that day, previous signal remains.
- Binance fetch error for one coin: logged as warning, scan continues.
- `computeSmallCapSignal` returns `null` if `closes.length < 210` — upsert skipped.
- Coins with `signal = null` always appear in the table (not filtered by the Quiet chip) so newly synced coins are visible before the first scan.
- **Symbol-collision risk** is far lower than Small Cap Radar because the CoinGecko `meme-token` category already restricts the universe; matching is still by symbol against Binance USDT pairs. There is no large-cap blocklist (intentional — see above).
- **Sync Coins** skips the deletion step if 0 coins are found (prevents wiping the watchlist when CoinGecko is rate-limited).
- CoinGecko 429 during sync is retried up to 3× with a 60s delay per page.
- `listingDate` is fetched once per coin (non-blocking, non-fatal) and cached.
- `marketCap` shown as `—` for coins added manually or before the first Sync Coins run.

## Related Files (FE / BE / Worker)

**Core** (reused, unchanged)
- `packages/core/src/analysis/small-cap-signal.ts` — `computeSmallCapSignal()`, stage classification, signal score

**Database**
- `packages/db/prisma/schema.prisma` — `MemeCoin`, `MemeSignal`, `MemeSignalHistory` models
- `packages/db/prisma/migrations/20260705120000_add_meme_radar/migration.sql` — initial migration
- `packages/db/src/repositories/meme-radar.repository.ts` — `createMemeRadarRepository`
- `packages/db/src/index.ts` — exports `createMemeRadarRepository`

**Worker**
- `apps/worker/src/modules/meme-scan/meme-scan.service.ts` — `scanAll()` / `scanOne()`
- `apps/worker/src/modules/meme-scan/meme-scan.module.ts` — module wiring
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — `@Cron('7 0 * * *')` `runMemeScan()`
- `apps/worker/src/modules/scheduler/scheduler.module.ts` — imports `MemeScanModule`
- `apps/worker/test/stubs/app-db.ts` — stubs `createMemeRadarRepository`

**API**
- `apps/api/src/modules/meme-radar/meme-radar.service.ts` — `listCoins()`, `rescanCoins()` (meme-token category sync), `triggerScan()`, `getSignalHistory()`
- `apps/api/src/modules/meme-radar/meme-radar.controller.ts` — `GET /`, `POST /coins`, `DELETE /coins/:symbol`, `GET /coins/:symbol/signal-history`, `POST /rescan-coins`, `POST /scan`
- `apps/api/src/modules/meme-radar/meme-radar.module.ts` — module
- `apps/api/src/modules/meme-radar/dto/add-coin.dto.ts` — `AddCoinDto`
- `apps/api/src/app.module.ts` — registers `MemeRadarModule`

**Web**
- `apps/web/src/app/meme-radar/page.tsx` — Next.js route entry
- `apps/web/src/_pages/meme-radar-page/meme-radar-page.tsx` — Server Component, loads initial data
- `apps/web/src/widgets/meme-radar/meme-radar-feed.tsx` — Client Component: table with sort/filter/sparkline, Lottery (Xổ số) overlay (reuses `scr-*` CSS classes from `globals.css`)
- `apps/web/src/shared/api/types.ts` — `MemeCoinRow`, `MemeHistoryRow`, `MemeStage` (aliases of the SmallCap types)
- `apps/web/src/shared/api/client.ts` — `fetchMemeRadar`, `addMemeCoin`, `removeMemeCoin`, `fetchMemeSignalHistory`, `triggerMemeScan`
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav item
