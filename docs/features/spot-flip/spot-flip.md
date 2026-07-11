## Description
`/spot-flip` ("Spot Flip") is an on-demand tool for short-term spot swing trading ("lướt spot").
Given a coin symbol it computes, from live Binance klines, where price sits in its recent range and
how much it normally moves per day, then feeds a fee-net take-profit / stop-loss calculator. It exists
so the user can quickly judge **whether to enter a dip and where to realistically take profit**, instead
of eyeballing a raw % change. No DB — every request is computed fresh from public Binance endpoints.

## Main Flow
1. User opens `/spot-flip`, types a symbol (e.g. `BTC`, `SOL`, `PEPE`) or taps a quick chip, and hits **Phân tích**.
2. Web calls `GET /spot-flip?symbol=…` → `SpotFlipService.analyze()`.
3. Service normalizes the symbol (bare `BTC` → `BTCUSDT`) and fetches in parallel:
   - `ticker/price` (live price)
   - `1h` klines (limit 200) — intraday momentum
   - `1d` klines (limit 40) — 30d range + ATR
4. Service computes:
   - **Momentum**: % change over 1h / 4h / 24h / 7d (hourly) and 30d (daily).
   - **Dip depth**: `(high30d − price) / high30d` — how far below the 30d high.
   - **Rebound**: `(price − low30d) / low30d` — how far above the 30d low.
   - **ATR%**: average of `(high − low) / close` over the last 14 completed daily candles (daily-range proxy).
5. Web renders three cards: price + momentum, range/dip/ATR, and a flip calculator.
6. The calculator seeds Entry = current price, TP = `entry × (1 + 0.8·ATR%)`, SL = `entry × (1 − 0.6·ATR%)`,
   then reactively shows (all client-side, net of the 0.10% round-trip fee):
   - `tpNet% = (tp−entry)/entry×100 − 0.10`, and $ profit on the entered capital
   - `slNet%` and $ loss
   - `R:R = (tp−entry)/(entry−sl)` (flagged good when ≥ 1.5)
   - breakeven price = `entry × 1.001`
   User can override Entry/TP/SL/capital freely.

## Edge Cases
- **Bare / lowercase symbol** (`btc`, `sol`) → uppercased and `USDT` appended unless it already ends in a known quote (USDT/USDC/FDUSD/BUSD/BTC/ETH).
- **Unknown or delisted symbol / Binance error** → service throws `BadRequestException`; web shows a Vietnamese error and clears results.
- **Thin history** (< 2 daily or hourly candles) → `BadRequestException` ("Not enough market history").
- **Missing lookback candle** (e.g. 7d window with < 168 hourly candles) → that change cell renders `—` (null), others still show.
- **In-progress candle** is excluded from 30d range and ATR (uses `daily.slice(0, -1)`); momentum refs use closed candles `k` steps back from the newest.
- **Non-numeric calculator input** → derived rows show `—`; entry ≤ 0 hides all results.

## Related Files (FE / BE / Worker)
- `apps/api/src/modules/spot-flip/spot-flip.service.ts` — symbol normalization, Binance fetch, metric math (BE)
- `apps/api/src/modules/spot-flip/spot-flip.controller.ts` — `GET /spot-flip` (BE)
- `apps/api/src/modules/spot-flip/spot-flip.module.ts` — module wiring (BE)
- `apps/api/src/app.module.ts` — registers `SpotFlipModule` (BE)
- `apps/web/src/app/spot-flip/page.tsx` — App Router route re-export (FE)
- `apps/web/src/_pages/spot-flip-page/spot-flip-page.tsx` — page component (FE)
- `apps/web/src/widgets/spot-flip/spot-flip-tool.tsx` — interactive tool: search, metrics, fee-net calculator (FE)
- `apps/web/src/shared/api/types.ts` — `SpotFlipAnalysis` type (FE)
- `apps/web/src/shared/api/client.ts` — `analyzeSpotFlip()` client method (FE)
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav entry (FE)
- `apps/web/src/app/globals.css` — `.sf-*` styles (FE)
