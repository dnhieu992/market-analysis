## Description

A triage layer for small-cap coins. The table answers one question: _"Which coin is worth opening a chart for right now?"_ It is **not** a buy signal — the actual entry decision still belongs to the user after manual chart analysis.

A cron job runs daily at **00:05 UTC**, fetches 220 D1 candles per coin from Binance, computes RSI / EMA / Vol× indicators, classifies each coin into a Stage, and stores a Signal score (0–100) in the database. The web page shows these results sorted by Signal descending, with Quiet coins hidden by default.

Each coin also stores **market cap** (synced from CoinGecko during Sync Coins) and **listing date** (fetched from Binance on first scan and cached permanently).

## Main Flow

1. **Cron (00:05 UTC)** — `SchedulerService.runSmallCapScan()` calls `SmallCapScanService.scanAll()`.
2. For each coin in `small_cap_coins`, fetches 220 daily candles from Binance (`SYMBOLUSDT`).
3. If `listingDate` is not yet stored, fires a non-blocking Binance call (`startTime=2017-01-01, limit=1`) to record the coin's first ever candle date.
4. Computes `computeSmallCapSignal(closes, volumes)` from `@app/core`:
   - RSI(14), EMA(34/89/200), Vol× = volume / SMA20(volume)
   - Classifies **Stage**: Breakout → Accumulating → Waking → Extended → Quiet
   - Computes **Signal score** (0–100): vol bonus + RSI factor + EMA position bonus − extended penalty
   - Extracts last-30-closes as sparkline array
5. Upserts result into `small_cap_signals` (unique on `coinId + date`).
6. User opens `/small-cap-radar` — Server Component loads latest signals via `GET /small-cap-radar`.
7. Client widget renders the table: sort by Signal↓, stage filter chips (Quiet hidden by default), click row → TradingView.
8. Coins with `signal = null` (not yet scanned) are always shown regardless of stage filter.

## Toolbar Actions

| Button | Endpoint | Behaviour |
|---|---|---|
| ↻ Refresh | `GET /small-cap-radar` | Reload coin list + signals from API, update state in place |
| ⚡ Re-analyze | `POST /small-cap-radar/scan` | Runs full signal scan synchronously, then reloads; shows scanned/failed count |
| ⟳ Sync Coins | `POST /small-cap-radar/rescan-coins` | Background job: pulls Binance USDT pairs + CoinGecko <$50M market cap, upserts coins + marketCap, prunes delisted coins (skipped if 0 found to protect watchlist) |
| + Coin | `POST /small-cap-radar/coins` | Add a single coin manually |

## Stage Definitions

| Stage | Meaning | Conditions |
|---|---|---|
| 🟢 Breakout | Open chart immediately | above EMA34 + Vol× ≥ 2 + RSI 30–65 |
| 🔵 Accumulating | Watch closely | below EMA34 + RSI 25–50 + Vol× ≥ 0.7 |
| 🟡 Waking | Early signs | one weak signal (above34 OR Vol×≥1.2 OR RSI 40–62) |
| 🔴 Extended | Already ran — avoid chasing | RSI > 70 OR (all EMAs above + RSI>68 + Vol×≥1.5) |
| ⚪ Quiet | Skip | everything else |

## Signal Score Algorithm

```
base = 50

volBonus  = volX≥3 → +30 | ≥2 → +20 | ≥1.5 → +12 | ≥1.0 → +5 | else 0
rsiFactor = rsi 35–55 → +15 | 55–65 → +8 | 65–70 → 0 | >70 → −25 | <25 → −5 | else +5
emaBonus  = above34 → +8 | above89 → +5 | above200 → +3
extPenalty= rsi>70 && volX≥2 → −15 | else 0

score = clamp(base + volBonus + rsiFactor + emaBonus + extPenalty, 0, 100)
```

## Edge Cases

- Fewer than 210 candles returned from Binance: coin is skipped for that day, previous signal remains in DB.
- Binance fetch error for one coin: logged as warning, scan continues for remaining coins.
- `computeSmallCapSignal` returns `null` if `closes.length < 210` — the upsert is skipped.
- Coins with `signal = null` always appear in the table (not filtered by the Quiet stage chip) so newly synced coins are visible before the first scan runs.
- **Sync Coins** skips the deletion step if 0 coins are found (prevents wiping the watchlist when CoinGecko is rate-limited or unavailable).
- `listingDate` is fetched once per coin (non-blocking, non-fatal) and cached; subsequent scans skip the Binance call.
- `marketCap` shown as `—` for coins added manually or before the first Sync Coins run.
- Re-analyze runs synchronously; for large watchlists it may take a while (no timeout on the HTTP call).
- Coin removed from watchlist via `POST /small-cap-radar/coins` (add) — no remove button in UI; to remove, use the API directly.

## Related Files (FE / BE / Worker)

**Core**
- `packages/core/src/analysis/small-cap-signal.ts` — `computeSmallCapSignal()`, stage classification, signal score
- `packages/core/src/index.ts` — exports `computeSmallCapSignal`, `SmallCapStage`, `SmallCapSignalResult`

**Database**
- `packages/db/prisma/schema.prisma` — `SmallCapCoin` (id, symbol, name, marketCap, listingDate, addedAt) + `SmallCapSignal` models
- `packages/db/prisma/migrations/20260608000500_add_small_cap_radar/migration.sql` — initial migration
- `packages/db/prisma/migrations/20260608140000_small_cap_market_info/migration.sql` — adds `marketCap`, `listingDate`
- `packages/db/src/repositories/small-cap-radar.repository.ts` — `addCoin(symbol, name, marketCap?)`, `updateListingDate()`, `findCoinsWithLatestSignal()`, `deleteCoinsNotInSymbols()`
- `packages/db/src/index.ts` — exports `createSmallCapRadarRepository`

**Worker**
- `apps/worker/src/modules/small-cap-scan/small-cap-scan.service.ts` — `scanAll()` / `scanOne(coinId, symbol, currentListingDate?)` / `fetchAndStoreListingDate()`
- `apps/worker/src/modules/small-cap-scan/small-cap-scan.module.ts` — module wiring
- `apps/worker/src/modules/market/binance-market-data.service.ts` — `fetchKlines({ startTime? })` supports earliest-candle lookup
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — `@Cron('5 0 * * *')` `runSmallCapScan()`
- `apps/worker/src/modules/scheduler/scheduler.module.ts` — imports `SmallCapScanModule`

**API**
- `apps/api/src/modules/small-cap-radar/small-cap-radar.service.ts` — `listCoins()`, `rescanCoins()`, `triggerScan()`, `scanOneCoin()`, `fetchAndStoreListingDate()`
- `apps/api/src/modules/small-cap-radar/small-cap-radar.controller.ts` — `GET /`, `POST /coins`, `DELETE /coins/:symbol`, `POST /rescan-coins`, `POST /scan`
- `apps/api/src/modules/small-cap-radar/small-cap-radar.module.ts` — module
- `apps/api/src/modules/small-cap-radar/dto/add-coin.dto.ts` — `AddCoinDto`
- `apps/api/src/app.module.ts` — registers `SmallCapRadarModule`

**Web**
- `apps/web/src/app/small-cap-radar/page.tsx` — Next.js route entry
- `apps/web/src/_pages/small-cap-radar-page/small-cap-radar-page.tsx` — Server Component, loads initial data
- `apps/web/src/widgets/small-cap-radar/small-cap-radar-feed.tsx` — Client Component: table with sort/filter/sparkline, Mkt Cap column, Listed column, Re-analyze button
- `apps/web/src/shared/api/types.ts` — `SmallCapCoinRow` (includes `marketCap`, `listingDate`), `SmallCapStage`
- `apps/web/src/shared/api/client.ts` — `fetchSmallCapRadar`, `addSmallCapCoin`, `removeSmallCapCoin`, `triggerSmallCapScan`
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav item
- `apps/web/src/app/globals.css` — `scr-*` CSS classes
