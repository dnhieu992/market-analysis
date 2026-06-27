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
   - Classifies **Stage**: Breakout → Trending → Oversold → Accumulating → Waking → Extended → Quiet
   - Computes **Signal score** (0–100): vol bonus + RSI factor + EMA position bonus − extended penalty
   - Computes **extPct** = % distance of last close above/below EMA34 (extension / overheat gauge for exit timing)
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
| ⟳ Sync Coins | `POST /small-cap-radar/rescan-coins` | Background job: (1) fetches top-500 large-cap symbols from CoinGecko as a blocklist; (2) pages through CoinGecko `market_cap_asc` to find coins <$50M whose symbol is on Binance but NOT in the blocklist; (3) upserts coins + marketCap; (4) prunes delisted coins (step 4 skipped if 0 coins found, to protect watchlist on API failure) |
| + Coin | `POST /small-cap-radar/coins` | Add a single coin manually |

## Stage Definitions

| Stage | Meaning | Conditions |
|---|---|---|
| 🟢 Breakout | Open chart immediately | above EMA34 + Vol× ≥ 2 + RSI 30–65 |
| 🟩 Trending | Confirmed trend — hold | above EMA34 **and** EMA89 + EMA34 sloping up + RSI 50–68 (volume need NOT spike) |
| 🟣 Oversold | Capitulation bounce candidate — watchlist, NOT a buy | below EMA200 + RSI < 30 + dropped ≥ 25% over the last 10 days |
| 🔵 Accumulating | Watch closely | below EMA34 + RSI 25–50 + Vol× ≥ 0.7 |
| 🟡 Waking | Early signs | one weak signal (above34 OR Vol×≥1.2 OR RSI 40–62) |
| 🔴 Extended | Already ran — avoid chasing | RSI > 70 OR (all EMAs above + RSI>68 + Vol×≥1.5) |
| ⚪ Quiet | Skip | everything else |

**Why Oversold exists:** the radar's once-a-day scan (and the EMA34-based stages) blind it to coins that pump straight out of a deep capitulation — e.g. PIVX on 2026-06-27 V-reversed +84% the day after sitting at RSI 24, -35%/10d, below every EMA, where the old rules labelled it "Quiet". Oversold singles out that violent-flush state (below EMA200, RSI < 30, sharp multi-day drop) as a **mean-reversion / bounce watchlist**. It is explicitly **not** a buy signal — these are falling knives that can keep falling. Backtested on 40 low-cap coins (`scripts/run-oversold-primed-backtest.ts`, run logged `claude-backtest/runs/2026-06-27-oversold-primed-smallcap.md`): forward-30d return median ~+30% with 31% of fires reaching +50% vs 16% baseline, but it only catches ~16% of all big pumps (it surfaces the capitulation-bounce subset, not breakouts). Evaluated **after** Breakout/Trending so a coin already bouncing back above EMA34 is classified by its live strength instead.

**Why Trending exists:** the strongest legs in small caps often grind up on quiet volume and never trip the Vol×≥2 Breakout rule, so they used to stay labelled "Waking" (chớm động) the whole way up — which made it easy to take profit far too early. Trending separates a *confirmed, hold-worthy* uptrend (price reclaimed EMA34 & EMA89, EMA34 rising) from a coin that is merely stirring. Evaluated **after** Breakout and Extended, so a volume-spike breakout or an overheated coin still take priority.

**extPct (Ext% column):** distance of the close above EMA34, in %. It is the exit-timing gauge — a healthy trend sits a few % above EMA34; once extPct climbs past ~+20% the move is overheated (usually paired with the Extended stage) and the table flags it red as a trail / take-profit cue rather than an entry.

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
- **Symbol collision guard**: CoinGecko lists many obscure tokens with symbols identical to large-cap Binance pairs (e.g. a $30K "Bitcoin Base" token with symbol `BTC`). Without the guard, these would be added and then scanned as real Bitcoin via `BTCUSDT`. The fix is to pre-fetch the top-500 CoinGecko coins by market cap and block any matching symbol.
- **Sync Coins** skips the deletion step if 0 coins are found (prevents wiping the watchlist when CoinGecko is rate-limited or unavailable).
- CoinGecko rate-limit (HTTP 429) during the large-cap blocklist fetch is retried up to 3× with a 35s delay; if all retries fail the page is skipped (blocklist may be incomplete for that page).
- `listingDate` is fetched once per coin (non-blocking, non-fatal) and cached; subsequent scans skip the Binance call.
- `marketCap` shown as `—` for coins added manually or before the first Sync Coins run.
- Re-analyze runs synchronously; for large watchlists it may take a while (no timeout on the HTTP call).
- No remove button in the UI — to remove a coin use `DELETE /small-cap-radar/coins/:symbol` directly.

## Related Files (FE / BE / Worker)

**Core**
- `packages/core/src/analysis/small-cap-signal.ts` — `computeSmallCapSignal()`, stage classification, signal score
- `packages/core/src/index.ts` — exports `computeSmallCapSignal`, `SmallCapStage`, `SmallCapSignalResult`

**Database**
- `packages/db/prisma/schema.prisma` — `SmallCapCoin` (id, symbol, name, marketCap, listingDate, addedAt) + `SmallCapSignal` models
- `packages/db/prisma/migrations/20260608000500_add_small_cap_radar/migration.sql` — initial migration
- `packages/db/prisma/migrations/20260608140000_small_cap_market_info/migration.sql` — adds `marketCap`, `listingDate`
- `packages/db/prisma/migrations/20260619130000_add_extpct_to_small_cap_signal/migration.sql` — adds `extPct` column to `small_cap_signals`
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
- `apps/web/src/widgets/small-cap-radar/small-cap-radar-feed.tsx` — Client Component: table with sort/filter/sparkline, Trending stage chip + bar, Ext% column (sortable), Mkt Cap column, Listed column, Re-analyze button
- `apps/web/src/shared/api/types.ts` — `SmallCapCoinRow` (includes `marketCap`, `listingDate`), `SmallCapStage`
- `apps/web/src/shared/api/client.ts` — `fetchSmallCapRadar`, `addSmallCapCoin`, `removeSmallCapCoin`, `triggerSmallCapScan`
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav item
- `apps/web/src/app/globals.css` — `scr-*` CSS classes
