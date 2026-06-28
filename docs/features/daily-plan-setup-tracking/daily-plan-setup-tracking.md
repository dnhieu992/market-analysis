## Description
Turns the trade setup(s) embedded in each AI daily plan into structured, machine-trackable
records (`TrackedSetup`) and follows their lifecycle automatically: khớp lệnh (ENTERED),
chạm TP (TP1/TP2_HIT), dính SL (SL_HIT), plus a daily review that expires never-filled setups
and invalidates a still-PENDING setup once a newer, different setup supersedes it. Status is
surfaced live on `/daily-plan`.

A setup is only marked INVALID while it is still PENDING (never filled) **and** a newer,
*different* setup for the same symbol has appeared on a later day. Once a setup has filled
(ENTERED) it is never invalidated — it runs to TP or SL.

The daily plan is generated as free-form Vietnamese markdown (`VisualAnalysisService`), so the
concrete entry/SL/TP levels only exist as prose. An LLM extraction step parses them into numbers.

**Quality gates (added 2026-06-28).** The plan is free-form prose, so the vision LLM used to emit
counter-trend, poor-R:R, or far-from-price "hanging" setups — which on `/daily-plan` showed up as
"toàn stoploss với không khớp" (mostly stop-outs or never-filled). Two layers now enforce discipline:
1. **Prompt discipline** — `callClaudeVision` is grounded with a pre-computed **D1 trend + current
   price** and hard rules: trade only **with** the D1 trend (no fading), entry within **~3%** of price
   (or at a breakout/retest), **R:R ≥ 1.5** (prefer ≥ 2), and an explicit "KHÔNG VÀO LỆNH HÔM NAY"
   when the market is choppy/conflicting — do not fabricate a setup.
2. **Deterministic gates** — after LLM extraction, `SetupExtractionService.applyQualityGates()` drops
   any setup that still violates: RR < `MIN_RR` (1.5), direction counter to a clearly-trending D1
   (LONG in a bearish D1 / SHORT in a bullish D1), or an entry zone further than
   `MAX_ENTRY_DISTANCE_PCT` (3.5%) from the live price. The trend/distance gates need live candles; if
   the fetch fails they fail open (only the data-free RR gate applies), and every rejection is logged.

## Main Flow
1. Daily job (`SchedulerService.sendDailySignals`, 00:30 UTC) generates + saves the plan, then calls
   `SetupExtractionService.extractForSymbol(symbol)`.
2. Extraction loads today's `DailyAnalysis`, sends `analysisText` to Claude via `tool_use`
   (`record_trade_setups`), runs `applyQualityGates()` (RR / trend-alignment / entry-distance) on the
   extracted setups, and persists one `TrackedSetup` per surviving actionable setup (PENDING).
3. Hourly cron (`runSetupTracking`, `0 * * * *`) → `SetupTrackingService.trackOpenSetups()`:
   fetches 1h candles per symbol and replays candles newer than `lastCheckedAt` **and** not
   earlier than the setup's `planDate` (a fresh setup has `lastCheckedAt = null`, so the plan-day
   floor prevents it from filling on the ~2 days of historical candles in the fetch window):
   - LONG: ENTERED when `low ≤ entryHigh`; SL_HIT when `low ≤ stopLoss`; TP when `high ≥ tpN`.
   - SHORT: mirrored. SL is scored before TP within a candle (conservative). TP2 closes; TP1 closes
     only when there is no TP2. Telegram notification on each transition.
4. Daily review cron (`runSetupReview`, `45 0 * * *`) → `SetupTrackingService.reviewStaleSetups()`:
   PENDING older than `EXPIRY_DAYS` (3) → EXPIRED; a previous-day PENDING setup → INVALID only
   when a newer, different setup (`isDifferentSetup`: direction flip or non-overlapping entry
   zone) for the same symbol exists. ENTERED setups are skipped entirely — they run to TP/SL.
5. `/daily-plan` server page fetches setups via `GET /tracked-setups/by-plans?ids=…` and renders a
   "Lệnh theo dõi" block with entry/SL/TP and a live status badge on each card.
6. `/tracked-setups` page (`TrackedSetupsFeed`) lists every setup with status-bucket filters and a
   summary bar: tỉ lệ thắng (wins/decided where decided = TP_HIT + SL_HIT), số lệnh thắng/thua, và
   tổng PnL đã chốt (realized, vốn $1000/lệnh). The raw setup id is no longer shown; instead a copy
   icon next to the coin symbol copies the id to the clipboard (`CopyIdButton`/`copyText`, with a
   hidden-textarea `execCommand` fallback for the plain-HTTP, non-secure-context dashboard).
7. Each setup card has an editable **notes** field (`NotesSection`) using the shared `MarkdownEditor`
   (TipTap, lazy-loaded). Notes are stored as a Markdown string on `TrackedSetup.notes` and saved via
   `PATCH /tracked-setups/:id/notes`. Existing notes render read-only (toolbar hidden) with a "Sửa ghi
   chú" link; empty notes show a "+ Thêm ghi chú" link.

## Edge Cases
- Plan is NO_TRADE / has no actionable setup → extraction stores nothing.
- A setup survives LLM extraction but fails a quality gate (RR < 1.5 / counter-trend / entry too far) → dropped, logged, not persisted.
- Live candle fetch for the gates fails → trend/distance gates skipped (fail open); the RR gate still applies.
- Entry given as a single price → `entryLow = entryHigh`.
- Re-running generation/extraction for the same day is idempotent (`existsForPlan`).
- Missed tracking hours → replay all candles since `lastCheckedAt`, not just the latest.
- A candle touching both entry and SL fills then stops out in the same pass (conservative).
- All LLM / Telegram calls are non-fatal — failures are logged and never block plan generation.

## Related Files (FE / BE / Worker)
- `packages/db/prisma/schema.prisma` — `TrackedSetup` model.
- `packages/db/prisma/migrations/20260617120000_add_tracked_setup/migration.sql` — table DDL.
- `packages/db/prisma/migrations/20260618130000_add_tracked_setup_notes/migration.sql` — `notes` column DDL.
- `packages/db/src/repositories/tracked-setup.repository.ts` — repository (`createTrackedSetupRepository`), incl. `updateNotes`.
- `apps/worker/src/modules/setup-tracking/setup-extraction.service.ts` — LLM extraction → `applyQualityGates()` (RR / trend / distance) → rows.
- `apps/worker/src/modules/visual-analysis/visual-analysis.service.ts` — `callClaudeVision` grounded with D1 trend + price and the trade-discipline rules.
- `apps/worker/test/setup-extraction.gate.spec.ts` — unit tests for the quality gates.
- `apps/worker/src/modules/setup-tracking/setup-tracking.service.ts` — hourly tracking + daily review.
- `apps/worker/src/modules/setup-tracking/setup-tracking.module.ts` — worker module.
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — extraction call + two crons.
- `apps/api/src/modules/tracked-setups/*` — `GET /tracked-setups`, `GET /tracked-setups/by-plans`, `PATCH /tracked-setups/:id/notes` (+ `dto/update-tracked-setup-notes.dto.ts`).
- `apps/api/src/modules/database/database.providers.ts` — `TRACKED_SETUP_REPOSITORY` provider.
- `apps/web/src/_pages/daily-plan-page/daily-plan-page.tsx` — fetches setups, groups by plan.
- `apps/web/src/widgets/daily-plan-feed/daily-plan-feed.tsx` — "Lệnh theo dõi" block + status badge.
- `apps/web/src/widgets/tracked-setups/tracked-setups-feed.tsx` — `/tracked-setups` list + win-rate/PnL summary bar + `NotesSection` (MarkdownEditor).
- `apps/web/src/shared/ui/markdown-editor/markdown-editor.tsx` — shared TipTap editor reused for setup notes.
- `apps/web/src/shared/lib/setup-pnl.ts` — per-setup PnL estimate used by the summary + chips.
- `apps/web/src/shared/api/client.ts` / `types.ts` — `TrackedSetup` type (incl. `notes`), mapper, `fetchTrackedSetupsByPlans`, `updateTrackedSetupNotes`.
- `apps/web/src/app/globals.css` — `.dp-tracked*` / `.dp-setup-status*` / `.ts-notes*` styles.
