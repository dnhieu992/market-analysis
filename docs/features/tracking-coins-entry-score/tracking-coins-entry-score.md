## Description
**Entry Score** is a 0–100 "how low-risk is buying this spot coin right now?" gauge shown on
the `/tracking-coins` page. It repurposes the page from a passive watchlist into a spot-trading
radar that surfaces the lowest-risk entries first (risk management over profit chasing).

It is deliberately different from `longScore` (long-short-score.ts), which rewards momentum and
therefore peaks when price is most EXTENDED — i.e. the riskiest moment to buy. Entry Score instead
rewards a healthy uptrend bought on a pullback to support, where the stop sits just below structure
→ small risk-per-unit → high R:R.

## Main Flow
1. Daily/manual scan (`TrackingCoinScanService` in worker, `TrackingCoinsService.scanOneCoin` in API)
   fetches D1/H4/M30/W1 klines and builds the multi-timeframe signal.
2. The swing limit order is computed **first** so its R:R can feed the score.
3. `computeEntryScore` (`@app/core`) runs two layers:
   - **Hard gates (medium strictness)** — fail any → score 0 ("Avoid"):
     D1 trend not Down/StrongDown · price above EMA200 (D1) · extPct < 18%.
   - **Weighted score (0–100)** — pullback proximity (30, via extPct) + R:R (20) +
     RSI cooled (15) + W/D1/H4 trend alignment (25) + volume sanity (10).
4. `entryScore` and `extPct` are persisted on `TrackingCoinSignal`.
5. The web feed renders an `EntryBadge` (Prime ≥75 / Good ≥60 / Watch ≥40 / Avoid <40) and an
   `Ext%` column; the table defaults to sorting by Entry Score descending.

## Edge Cases
- **No valid swing order** (no-trade regime): `rrRatio` is null → R:R component scores 0, lowering Entry Score.
- **Gated out**: entryScore is 0 and labelled "Avoid" regardless of other factors.
- **Score uses the raw order R:R** (pre user `minRR` gate) so it reflects setup quality, not the
  per-coin minRR preference.
- **Missing signal** (coin never scanned): badge shows "—".
- The W1 trend is scored but **not** a hard gate at medium strictness.

## Related Files (FE / BE / Worker)
- `packages/core/src/analysis/entry-score.ts` — the scoring + gating logic
- `packages/core/src/analysis/entry-score.spec.ts` — unit tests
- `packages/core/src/index.ts` — exports `computeEntryScore`
- `packages/db/prisma/schema.prisma` — `TrackingCoinSignal.entryScore`, `extPct`
- `packages/db/prisma/migrations/20260626120000_tracking_coin_entry_score/migration.sql`
- `apps/worker/src/modules/tracking-coin-scan/tracking-coin-scan.service.ts` — computes & persists on scan
- `apps/api/src/modules/tracking-coins/tracking-coins.service.ts` — computes on scan, exposes via listCoins
- `apps/web/src/shared/api/types.ts` — `TrackingCoinRow.signal.entryScore` / `extPct`
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — `EntryBadge`, `ExtCell`, sort/column
- `apps/web/src/app/globals.css` — `.tc-entry*` badge styles
