## Description
Turns `/tracking-coins` into a **DCA dashboard** for the user's no-stop-loss, dollar-cost-average
strategy: gom (add) into deep dips, take profit when price reclaims EMA34/EMA89.

Backtest (`claude-backtest/runs/2026-06-26-dca-dip-d1-no-sl.md`) showed this works (80–100% win rate)
on coins that survive and mean-revert, but is ruinous on coins that die or trend down for years —
so the #1 risk lever is **coin selection**, which replaces the stop-loss. Two signals are shown:

- **DCA score (0–100)** — "how safe is it to DCA this coin?" from **market cap** (death risk) +
  **weekly trend** (long-term structure alive). Label: ≥70 An toàn / ≥50 Khá / ≥30 Rủi ro / <30 Tránh.
- **Action zone** — `GOM` (oversold near 20d low → add a layer) / `CHO` (wait) / `CHOT` (reclaimed
  EMA34 → take profit).

The earlier trend-following Entry Score (`tracking-coins-entry-score`) is superseded for display but
its column/logic remain in the DB and scan (harmless) — see that doc.

## Main Flow
1. Daily/manual scan (`TrackingCoinScanService` worker, `TrackingCoinsService.scanOneCoin` API)
   builds the D1/H4/W1 signal and computes `low20Pct` (% above the rolling 20-day low).
2. `computeDcaScore` (`@app/core`) scores survival from `marketCap` (max 50) + weekly trend/EMA/UTBot
   (max 50). Persisted as `dcaScore`, with `low20Pct`, on `TrackingCoinSignal`.
3. API `listCoins` derives the action `dcaZone` from stored `ema34Above` / `rsi` / `low20Pct`.
4. The feed shows a **DCA** column (quality badge + zone tag) and defaults to sorting by `dcaScore` desc
   so the safest-to-DCA coins surface first.

## Edge Cases
- **Micro-cap / unknown market cap** → 0 cap points → can never reach "An toàn" (high death risk).
- **Missing signal** (never scanned) → DCA cell shows "—".
- **Null RSI** in zone derivation defaults to 50 (treated as not-oversold → not GOM).
- Layer/position/capital tracking is **not** in this version — the dashboard is a screener
  (which coin is safe + in a gom zone now); tracking actual buys is a planned follow-up.

## Related Files (FE / BE / Worker)
- `packages/core/src/analysis/dca-signal.ts` — `computeDcaScore` + `dcaZone`
- `packages/core/src/analysis/dca-signal.spec.ts` — unit tests
- `packages/core/src/index.ts` — exports
- `packages/db/prisma/schema.prisma` — `TrackingCoinSignal.dcaScore`, `low20Pct`
- `packages/db/prisma/migrations/20260626140000_tracking_coin_dca_score/migration.sql`
- `apps/worker/src/modules/tracking-coin-scan/tracking-coin-scan.service.ts`
- `apps/api/src/modules/tracking-coins/tracking-coins.service.ts` — computes score, derives zone, exposes fields
- `apps/web/src/shared/api/types.ts` — `TrackingCoinRow.signal.dcaScore` / `dcaZone` / `low20Pct`
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — `DcaCell`, sort/column
- `apps/web/src/app/globals.css` — `.tc-dca*`, `.tc-zone*` styles
