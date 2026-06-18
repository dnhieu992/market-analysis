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

## Main Flow
1. Daily job (`SchedulerService.sendDailySignals`, 00:30 UTC) generates + saves the plan, then calls
   `SetupExtractionService.extractForSymbol(symbol)`.
2. Extraction loads today's `DailyAnalysis`, sends `analysisText` to Claude via `tool_use`
   (`record_trade_setups`), and persists one `TrackedSetup` per actionable setup (PENDING).
3. Hourly cron (`runSetupTracking`, `0 * * * *`) → `SetupTrackingService.trackOpenSetups()`:
   fetches 1h candles per symbol and replays candles newer than `lastCheckedAt`:
   - LONG: ENTERED when `low ≤ entryHigh`; SL_HIT when `low ≤ stopLoss`; TP when `high ≥ tpN`.
   - SHORT: mirrored. SL is scored before TP within a candle (conservative). TP2 closes; TP1 closes
     only when there is no TP2. Telegram notification on each transition.
4. Daily review cron (`runSetupReview`, `45 0 * * *`) → `SetupTrackingService.reviewStaleSetups()`:
   PENDING older than `EXPIRY_DAYS` (3) → EXPIRED; a previous-day PENDING setup → INVALID only
   when a newer, different setup (`isDifferentSetup`: direction flip or non-overlapping entry
   zone) for the same symbol exists. ENTERED setups are skipped entirely — they run to TP/SL.
5. `/daily-plan` server page fetches setups via `GET /tracked-setups/by-plans?ids=…` and renders a
   "Lệnh theo dõi" block with entry/SL/TP and a live status badge on each card.

## Edge Cases
- Plan is NO_TRADE / has no actionable setup → extraction stores nothing.
- Entry given as a single price → `entryLow = entryHigh`.
- Re-running generation/extraction for the same day is idempotent (`existsForPlan`).
- Missed tracking hours → replay all candles since `lastCheckedAt`, not just the latest.
- A candle touching both entry and SL fills then stops out in the same pass (conservative).
- All LLM / Telegram calls are non-fatal — failures are logged and never block plan generation.

## Related Files (FE / BE / Worker)
- `packages/db/prisma/schema.prisma` — `TrackedSetup` model.
- `packages/db/prisma/migrations/20260617120000_add_tracked_setup/migration.sql` — table DDL.
- `packages/db/src/repositories/tracked-setup.repository.ts` — repository (`createTrackedSetupRepository`).
- `apps/worker/src/modules/setup-tracking/setup-extraction.service.ts` — LLM extraction → rows.
- `apps/worker/src/modules/setup-tracking/setup-tracking.service.ts` — hourly tracking + daily review.
- `apps/worker/src/modules/setup-tracking/setup-tracking.module.ts` — worker module.
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — extraction call + two crons.
- `apps/api/src/modules/tracked-setups/*` — `GET /tracked-setups`, `GET /tracked-setups/by-plans`.
- `apps/api/src/modules/database/database.providers.ts` — `TRACKED_SETUP_REPOSITORY` provider.
- `apps/web/src/_pages/daily-plan-page/daily-plan-page.tsx` — fetches setups, groups by plan.
- `apps/web/src/widgets/daily-plan-feed/daily-plan-feed.tsx` — "Lệnh theo dõi" block + status badge.
- `apps/web/src/shared/api/client.ts` / `types.ts` — `TrackedSetup` type, mapper, `fetchTrackedSetupsByPlans`.
- `apps/web/src/app/globals.css` — `.dp-tracked*` / `.dp-setup-status*` styles.
