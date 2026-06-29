## Description
The **Accumulation DCA** page (`/accumulation`) is a spot, **no-stop-loss** DCA dashboard
that surfaces coins sitting in a high-quality **accumulation zone**: down 40–70% from their
cycle peak, consolidating in a tight sideways base, with low RSI — and, crucially, only
emits a BUY ("GOM") when the coin clears the `dcaScore` **survival gate** (market cap +
weekly trend alive).

It exists because backtests showed that entering the accumulation zone with no stop-loss
has a high win rate but is **net-negative on the full basket** — the tail (coins that keep
trending down or die) ruins the average. The defence that replaces a stop-loss is therefore
coin selection, not entry timing. See:
- `claude-backtest/runs/2026-06-29-accumulation-zone-no-sl.md` (the no-SL accumulation study)
- `claude-backtest/runs/2026-06-29-beaten-down-breakout-retest.md` (the breakout-retest variant — rejected: retest adds no edge)

It reuses the **same coin list and signal scan** as `/tracking-coins`; it is a parallel
*view* over the same data, not a separate universe.

## Main Flow
1. The tracking-coin scan (worker cron `scanAll`, or API `triggerScan` via the "Re-analyze"
   button) fetches D1/4H/M30/W1 klines for every tracked coin.
2. `computeAccumulationSignal` (in `@app/core`) computes, from the D1 closes/highs/lows and
   the weekly highs:
   - `drawdownPct` — % below the cycle peak (weekly highs over the last 104 weeks).
   - `baseWidthPct` — width of the last 30-day consolidation base.
   - `inBase` — deep drawdown (40–70%) AND tight base (≤25%) AND price near the base low
     (≤ low+8%) AND RSI ≤ 45.
   - zone: **GOM** if `inBase` AND `dcaScore ≥ 50`; **CHOT** if price reclaimed EMA34;
     otherwise **CHO** (wait).
3. The signal is persisted on `TrackingCoinSignal` (`accZone`, `accDrawdownPct`,
   `accBaseWidthPct`, `accInBase`, `accGatePassed`).
4. The page reads `GET /tracking-coins` (same endpoint as Tracking Coins), sorts GOM first
   then by `dcaScore`, and renders a table with live Binance prices.

## Edge Cases
- **Insufficient history** (`< 35` D1 candles or `< baseLen+1`): `computeAccumulationSignal`
  returns `null` → the row shows "—" for the accumulation columns.
- **No weekly data**: the peak falls back to the max of the available D1 highs.
- **Coin above EMA34**: always `CHOT` (it has already recovered — not a buy), regardless of
  drawdown.
- **In base but fails the gate** (`dcaScore < 50`): downgraded to `CHO`, never GOM — this is
  the survival filter that replaces a stop-loss.
- **Stale rows** (scanned before this feature shipped): accumulation columns are null until
  the next scan; the page degrades gracefully to "—".

## Related Files (FE / BE / Worker)
- `packages/core/src/analysis/accumulation-signal.ts` — `computeAccumulationSignal`, config, zone logic.
- `packages/core/src/analysis/accumulation-signal.spec.ts` — unit tests.
- `packages/core/src/index.ts` — exports the new symbols.
- `packages/db/prisma/schema.prisma` — `TrackingCoinSignal.acc*` columns.
- `packages/db/prisma/migrations/20260629120000_tracking_coin_accumulation/migration.sql` — DB migration.
- `apps/worker/src/modules/tracking-coin-scan/tracking-coin-scan.service.ts` — computes + persists the signal in the scheduled scan.
- `apps/api/src/modules/tracking-coins/tracking-coins.service.ts` — computes + persists in the manual scan; maps the fields into `GET /tracking-coins`.
- `apps/web/src/shared/api/types.ts` — `TrackingCoinRow.signal.acc*` types.
- `apps/web/src/widgets/accumulation/accumulation-feed.tsx` — the page UI (table, filters, live prices, scan).
- `apps/web/src/_pages/accumulation-page/accumulation-page.tsx` — server component loader.
- `apps/web/src/app/accumulation/page.tsx` — route re-export.
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav entry.
- `scripts/run-accumulation-no-sl-backtest.ts` — the backtest behind the strategy.
