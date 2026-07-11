## Description
`/spot-flip` ("Spot Flip") is an on-demand tool for short-term spot swing trading ("lướt spot").
Given a coin symbol it computes, from live Binance klines, where price sits in its recent range and
how much it normally moves per day, then feeds a fee-net take-profit / stop-loss calculator. It exists
so the user can quickly judge **whether to enter a dip and where to realistically take profit**, instead
of eyeballing a raw % change. All price metrics are computed fresh from public Binance endpoints on each view; the only persisted state is a small **watchlist** (`spot_flip_watch`) that remembers which coins to show.

## Watchlist (persisted)
The set of coins on the page is a per-user watchlist stored in MySQL (`SpotFlipWatch` model → `spot_flip_watch` table: `symbol` unique, `name`, `addedAt`). It is seeded by the migration with the five defaults (BTC/ETH/SOL/BNB/XRP) so the page looks the same as before on first run.
- **Add**: typing a symbol + **Thêm**, or tapping a quick chip → `analyzeSpotFlip` validates the symbol first, then `POST /spot-flip/watchlist` persists the normalized pair (upsert, so re-adding is idempotent). Only symbols that resolve on Binance are saved.
- **Remove**: each card shows a ✕ button (top-right, revealed on hover / always visible on touch). Clicking it optimistically drops the card and calls `DELETE /spot-flip/watchlist/:symbol`. Removing the open dialog's coin also closes the dialog.
- **Empty**: if every coin is removed the list shows a "Chưa theo dõi coin nào" hint; the quick chips still add coins back.

## UI
`/spot-flip` renders as a **vertical list of coin cards** (rounded ~20px cards, light gray `#F7F7F8` background, 16px apart). On load the page fetches the watchlist and analyzes each coin in saved order; the search box **adds** a coin to the top of the list (deduped by symbol) instead of replacing a single result.

Each card has:
- **Header** — round avatar (deterministic color + base-asset initials), base symbol in bold uppercase, full coin name in gray below (from `COIN_NAMES`, falls back to the `BASE / QUOTE` pair); right-aligned current price (bold) with the 24h change below it (green ▲ if up, red ▼ if down).
- **Dual up/down bar** — one continuous bar split into a green "tăng giá" segment (share of `reboundPct`) and a red "giảm giá" segment (share of `pullbackPct`), normalized to 100%, showing where price sits in its 30-day range. Labels sit above the bar (green left, red right).
- **Summary line** — short Vietnamese take on dip depth (in ATR units) and stance.
- **History dialog** (tap anywhere on the card to open) — a modal (`.dialog--wide`) showing that coin's **daily price history** table (last 30 completed days, newest first: date `YYYY-MM-DD`, open, close, and % change of close vs the previous day's close — green/red) followed by the range/dip/ATR metrics + the fee-net TP/SL flip calculator (state seeded per-card from that coin's ATR). Close via the ✕ button, backdrop click, or `Escape`.

## Auto-refresh
The card list auto-refreshes once a day at **00:08 UTC** (a few minutes after the daily candle closes at 00:00 UTC) so each card's history and metrics pick up the freshly completed day. A single `setTimeout` is scheduled to the next 00:08 UTC boundary; on fire it re-runs `analyzeSpotFlip` for every currently shown symbol (via a `cardsRef` so the one-time timer reads the live symbol list) and reschedules for the next day. An open dialog reflects the update automatically because it reads its data from the live `cards` state by symbol.

Colors: green `#00C896`, red `#F6465D`, muted gray `#9B9B9B`, price/name near-black `#17120D`.

## Main Flow
1. User opens `/spot-flip`; the web fetches the watchlist (`GET /spot-flip/watchlist`) and analyzes each saved coin as a card. To add another coin, they type a symbol (e.g. `BTC`, `SOL`, `PEPE`) or tap a quick chip and hit **Thêm** → the coin is validated, persisted to the watchlist, and prepended to the list.
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
5. Web renders/updates that coin's card (header + dual bar + summary); tapping the card opens the history dialog (daily OHLC history table + range/dip/ATR metrics + flip calculator).
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
- **Preload failure** → quick-symbol cards are fetched with `Promise.allSettled`, so a single failing symbol just drops from the initial list without breaking the page.
- **Zero range** (`reboundPct + pullbackPct ≤ 0`) → dual bar falls back to a 50/50 split.
- **Thin history** (< 2 daily or hourly candles) → `BadRequestException` ("Not enough market history").
- **Missing lookback candle** (e.g. 7d window with < 168 hourly candles) → that change cell renders `—` (null), others still show.
- **In-progress candle** is excluded from 30d range and ATR (uses `daily.slice(0, -1)`); momentum refs use closed candles `k` steps back from the newest.
- **Non-numeric calculator input** → derived rows show `—`; entry ≤ 0 hides all results.

## Related Files (FE / BE / Worker)
- `apps/api/src/modules/spot-flip/spot-flip.service.ts` — symbol normalization, Binance fetch, metric math, daily `history` array, watchlist list/add/remove (BE)
- `apps/api/src/modules/spot-flip/spot-flip.controller.ts` — `GET /spot-flip`, `GET/POST /spot-flip/watchlist`, `DELETE /spot-flip/watchlist/:symbol` (BE)
- `apps/api/src/modules/spot-flip/dto/add-watch.dto.ts` — add-to-watchlist body DTO (BE)
- `apps/api/src/modules/spot-flip/spot-flip.module.ts` — module wiring (BE)
- `packages/db/prisma/schema.prisma` — `SpotFlipWatch` model (BE)
- `packages/db/prisma/migrations/20260711120000_add_spot_flip_watch/migration.sql` — create table + seed defaults (BE)
- `packages/db/src/repositories/spot-flip-watch.repository.ts` — `createSpotFlipWatchRepository` (findAll/add/remove) (BE)
- `apps/api/src/app.module.ts` — registers `SpotFlipModule` (BE)
- `apps/web/src/app/spot-flip/page.tsx` — App Router route re-export (FE)
- `apps/web/src/_pages/spot-flip-page/spot-flip-page.tsx` — page component (FE)
- `apps/web/src/widgets/spot-flip/spot-flip-tool.tsx` — interactive tool: watchlist load, add/remove, dual bar, history dialog (table + metrics + fee-net calculator), 00:08 UTC auto-refresh (FE)
- `apps/web/src/shared/api/types.ts` — `SpotFlipAnalysis` + `SpotFlipHistoryEntry` + `SpotFlipWatchItem` types (FE)
- `apps/web/src/shared/api/client.ts` — `analyzeSpotFlip()`, `fetchSpotFlipWatchlist()`, `addSpotFlipWatch()`, `removeSpotFlipWatch()` client methods (FE)
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav entry (FE)
- `apps/web/src/app/globals.css` — `.sf-*` styles (FE)
