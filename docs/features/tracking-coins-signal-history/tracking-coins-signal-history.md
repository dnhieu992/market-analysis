## Description
An append-only change-log of the DCA signal for each tracking coin, so the user
can compare how a coin's DCA assessment evolved over time. A new history row is
written **only when the DCA action zone (GOM/CHO/CHOT) OR the quality bucket
(safe/ok/risky/avoid) differs from the most recent row** — so the 4-hour scans do
not bloat the log; it records meaningful state changes only. Raw snapshot fields
are stored (no forward-return/outcome evaluation yet).

The same feed also carries a **daily LLM holding review**: for every coin the user
is currently **holding (DCA position > 0)**, Claude **Haiku** evaluates the open
position once per UTC day and appends a review row (`llmVerdict` ∈
GIU/GOM_THEM/CHOT_BOT/THOAT + a short Vietnamese reason, plus a PnL% / avg-entry /
entry-mode snapshot). This applies to holdings entered **theo tín hiệu (GOM)** or
**FOMO** alike — each DCA layer is tagged at buy time with `entryMode`
(`SIGNAL` when bought while `dcaZone=GOM`, else `FOMO`); the review row reports the
position's combined mode (`SIGNAL`/`FOMO`/`MIXED`).

## Main Flow
1. A scan runs — either the worker cron (`runTrackingCoinScan`, every 4h) or the
   manual `POST /tracking-coins/scan` (⚡ Re-analyze).
2. After `upsertSignal`, the scan computes `dcaZone(...)` and
   `dcaQualityBucket(dcaScore)` (both from `@app/core`).
3. `repo.logSignalHistoryIfChanged(coinId, {...})` reads the most recent history
   row; if zone AND bucket are unchanged it returns `null` (skip), otherwise it
   inserts a new `TrackingCoinSignalHistory` row.
4. The user opens a coin → **History** tab in the detail modal →
   `GET /tracking-coins/coins/:symbol/signal-history` returns the change-log,
   newest first, rendered as a table (time, DCA score+bucket, zone, W/D1/H4 trend,
   RSI, Ext%, price).

## Holding-review flow (daily Haiku)
1. During the worker cron scan (`scanOne`), after the change-log step, `reviewHoldingIfDue`
   runs for the coin.
2. It aggregates the coin's `dcaBuys` → if held coins ≤ 0 (no open position) it returns (no LLM call).
3. Dedupe: if a review row already exists for the coin **since 00:00 UTC today** it returns.
4. Otherwise it computes avg-entry / PnL% / combined entry-mode and calls
   `TrackingCoinReviewService.review(...)` → Claude Haiku (`tool_use`, structured verdict).
5. On success it appends a `TrackingCoinSignalHistory` row carrying the standard snapshot
   PLUS `entryMode`, `avgEntry`, `pnlPct`, `llmVerdict`, `llmReview`, `llmModel`.
6. The History tab renders review rows with an **AI** tag, a colour-coded verdict pill,
   entry-mode + PnL chips, and the review text.

## Edge Cases
- **First scan ever for a coin** — no prior row, so the first snapshot is always
  inserted.
- **Not holding** — coins with no open DCA position are never sent to the LLM.
- **Already reviewed today** — only one Haiku review per coin per UTC day (dedupe), so the
  4h scans don't re-spend tokens; only the API manual re-analyze path is intentionally NOT
  wired to the LLM (review runs on the worker cron only).
- **LLM failure / missing `CLAUDE_API_KEY`** — non-fatal: `review()` returns `null`, no row is
  written, the scan continues.
- **Mixed entry modes** — a position with both SIGNAL and FOMO layers is reported as `MIXED`.
- **No change across many scans** — nothing is written; the log stays compact.
- **Score wobbles within the same bucket and zone** — intentionally NOT logged
  (e.g. 72 → 71 both "safe" and same zone → skipped).
- **`dcaZone` null handling** — repo compares `data.dcaZone ?? null` against the
  stored value so a null/non-null transition still counts as a change.
- **Both scan paths log** — worker cron and API manual re-analyze both call
  `logSignalHistoryIfChanged`, so manual re-analyze can also create a history row.
- **Coin deleted** — history rows cascade-delete via the FK on `tracking_coins`.

## Related Files (FE / BE / Worker)
- `packages/core/src/analysis/dca-signal.ts` — `dcaQualityBucket()` helper (shared 70/50/30 thresholds)
- `packages/db/prisma/schema.prisma` — `TrackingCoinSignalHistory` model (incl. `entryMode`/`avgEntry`/`pnlPct`/`llm*`), `TrackingCoinDcaBuy.entryMode`
- `packages/db/prisma/migrations/20260627060438_add_tracking_coin_signal_history/migration.sql` — table creation
- `packages/db/prisma/migrations/20260630130000_add_holding_llm_review/migration.sql` — holding-review + dca-buy entry-mode columns
- `packages/db/src/repositories/tracking-coins.repository.ts` — `logSignalHistoryIfChanged()`, `findSignalHistory()`, `findLatestSignal()`, `hasHoldingReviewSince()`, `appendHoldingReview()`, `addDcaBuy(entryMode)`
- `apps/worker/src/modules/tracking-coin-scan/tracking-coin-review.service.ts` — Claude Haiku holding-review LLM call (`tool_use`)
- `apps/worker/src/modules/tracking-coin-scan/tracking-coin-scan.service.ts` — logs history + `reviewHoldingIfDue` daily Haiku review (cron path)
- `apps/api/src/modules/tracking-coins/tracking-coins.service.ts` — logs history (manual re-analyze) + `getSignalHistory()` + derives `entryMode` in `addDcaBuy`
- `apps/api/src/modules/tracking-coins/tracking-coins.controller.ts` — `GET coins/:symbol/signal-history`
- `apps/web/src/shared/api/types.ts` — `SignalHistoryRow` type
- `apps/web/src/shared/api/client.ts` — `fetchSignalHistory()`
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — `CoinSignalHistory` component + History tab
- `apps/web/src/app/globals.css` — `.tc-history*` styles
