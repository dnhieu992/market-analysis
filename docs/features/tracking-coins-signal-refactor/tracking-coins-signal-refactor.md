## Description
Step 1 of the `/tracking-coins` signal refactor (2026-07-26). The signal-update pipeline had grown
into one monolithic scan that, per coin, fetched 4 timeframes and computed: the small-cap signal,
per-TF PA trends, EMA/RSI/Vol/UT Bot for W1/D1/H4/M30, long/short score, entry score, dcaScore, the
accumulation zone + base low, a swing limit order (plus outcome evaluation of past orders), a
zone-change history log, and a daily Claude Haiku holding review. Too many overlapping signals to
reason about, so **the whole computation side was removed** to make room for a smaller,
purpose-built one.

**What was removed** — only the *orchestration* (fetch → compute → persist). **All indicator and
scoring logic stays in `@app/core`, untouched and still exported**, ready to be re-wired:
`computeSmallCapSignal`, `computeTimeframeTrend` / `computePaTrend`, `computeLongShortScore`,
`computeEntryScore`, `computeDcaScore`, `computeAccumulationSignal`, `dcaZone`, `dcaQualityBucket`,
`dcaGomPlan`, `computeSwingLimitOrder`, `evaluateLimitOrder`, `calculateEma`, `calculateRsi`,
`calculateAtr`, `calculateVolumeRatio`, `calcUtBotResult`.

**What was kept** — the DB schema (`TrackingCoinSignal`, `TrackingCoinSignalHistory`,
`TrackingCoinOrder`, `TrackingCoinDcaBuy`) with all existing rows, and the whole read/display path:
the coin table (Trend / UT Bot / EMA / RSI / Vol / DCA columns, filters, sparkline), the coin detail
modal (Overview / DCA position / History / Journal), the DCA buy log + portfolio sync, the journal
and the prompt generator. Since nothing writes signals any more, **the displayed indicators are
frozen at the last scan (before 2026-07-26)** until the new flow lands.

## Main Flow
Before: cron `5 */4 * * *` (worker) or the `⚡ Re-analyze` button → `POST /tracking-coins/scan` →
per-coin scan → upsert `TrackingCoinSignal` + history + orders + LLM review → feed reloads.

After: **no signal computation runs at all.** The page is read-only over stored data:
1. `GET /tracking-coins` → `listCoins` reads the latest stored `TrackingCoinSignal` per coin and
   derives the display-only `dcaZone` / `gomZone` from those stored fields (`dcaZone`, `dcaGomPlan`).
2. Live prices still stream client-side straight from the Binance ticker endpoint (5 s poll) — that
   was never part of the scan.
3. DCA position, journal, signal-history read, klines proxy and the prompt generator work unchanged.

## Step 1b — filter cleanup + inline chart (2026-07-26)
Follow-up on the same "too much noise" complaint, on the UI side:

- **All facet filters removed** — the zone (GOM/Chờ/Hồi), quality (An toàn/Khá/Rủi ro/Tránh), trend
  (↑/→/↓) and Holding chips plus their live counts are gone. **Only the symbol/name search box
  remains.** Filtering on frozen signal values was misleading anyway. Column-header sorting is
  untouched.
- **Chart button in the Coin column** — a small candlestick icon sits next to the symbol. Clicking it
  (the click is stopped from bubbling into the row's detail modal) opens the **same fullscreen chart
  dialog the `/bitget` page uses** — `SetupChartDialog` reused as-is from
  `@web/widgets/bitget/setup-chart-dialog`, so the indicators are identical: **SonicR (EMA34 Dragon +
  EMA89) + EMA200 + S/R channel + RSI(14)+MA + QQE Long/Short markers + volume MA20**, rendered
  server-side as a PNG by `GET /bitget/setup-chart` (a `@Public()` route over public Binance klines).
  It opens on **D1** (swing/DCA horizon) instead of the Bitget default H4, and the M15…D1 switcher
  inside the dialog still works. `allowSave` is off — no R2 snapshot button here.

## Edge Cases
- **Newly added coin** → no signal row → indicator cells show "—" and the Overview tab says
  "Chưa có dữ liệu chỉ báo cho coin này." Nothing will populate it until the new flow exists.
- **Stale indicators** — the table keeps rendering the last scanned values; the Overview footer
  ("Cập nhật: …") is the honest timestamp of how old that data is.
- **History / AI review tabs** → still render old rows; no new rows are appended.
- **Orders** — no new swing orders are generated or evaluated. Existing rows stay in the DB;
  `TrackingCoinOrder.outcome` for anything unresolved stays unresolved.
- `addDcaBuy` still tags a layer `SIGNAL` vs `FOMO` from the *stored* zone — with signals frozen this
  tag is no longer meaningful; revisit when the new signal flow lands.
- `swingMaxLoss` / `swingMinRR` / `daytradeMaxLoss` / `daytradeMinRR` on the coin setup are now inert
  (kept in schema + `GET/PUT setup`); only `dcaMaxLayers` is still consumed.

## Related Files (FE / BE / Worker)
- `apps/worker/src/modules/tracking-coin-scan/` — **deleted** (scan service, Haiku review service, module)
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — `runTrackingCoinScan` cron + injection removed
- `apps/worker/src/modules/scheduler/scheduler.module.ts` — `TrackingCoinScanModule` import removed
- `apps/worker/test/scheduler.service.spec.ts` — constructor stub list trimmed
- `apps/api/src/modules/tracking-coins/tracking-coins.service.ts` — `scanOneCoin`, `triggerScan`,
  `suggestOrders`, `persistSuggestion`, `calcVolume`, `listOrders`, `updateOrderNotes` removed;
  keeps `listCoins`, DCA position CRUD + portfolio sync, journal, signal-history read, klines proxy
- `apps/api/src/modules/tracking-coins/tracking-coins.controller.ts` — `POST /scan`,
  `GET order-suggestions`, `GET orders`, `PATCH orders/:id/notes` removed
- `apps/api/src/modules/tracking-coins/dto/update-order-notes.dto.ts` — **deleted**
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — `⚡ Re-analyze` button +
  `handleReanalyze` removed, empty-state copy updated; **step 1b**: facet filters (zone/quality/trend/
  holding) + their count memos removed, `IconChart` + `tc-chart-btn` added to the Coin cell, hosts
  `SetupChartDialog`
- `apps/web/src/widgets/bitget/setup-chart-dialog.tsx` — **reused unchanged** by tracking-coins
- `apps/api/src/modules/bitget/bitget.controller.ts` — `GET /bitget/setup-chart` (`@Public()`), the
  shared PNG endpoint both pages hit
- `apps/web/src/app/globals.css` — `.tc-coin-line`, `.tc-chart-btn`
- `apps/web/src/shared/api/client.ts` — `triggerTrackingCoinsScan`, `fetchOrderSuggestions`,
  `fetchCoinOrders`, `updateOrderNotes` removed
- `apps/web/src/shared/api/types.ts` — `OrderSuggestion`, `OrderSuggestions`, `TrackingCoinOrder` removed
- `packages/core/src/analysis/*` — **unchanged**: every indicator/scoring helper stays for reuse
- `packages/db/prisma/schema.prisma` — **unchanged**: no migration, no data loss
