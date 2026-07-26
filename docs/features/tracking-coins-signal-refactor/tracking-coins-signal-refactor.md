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

## Step 1c — swing-only timeframes + QQE column (2026-07-26)
The page is a swing/DCA dashboard, so every intraday reading was dropped and a live signal added:

- **Chart switcher = H1 / H4 / D1 / W1.** M15 and M30 are gone; **weekly was added**.
  `SetupChartDialog` now takes an optional `timeframes` prop; `TRACKING_CHART_TIMEFRAMES`
  (H1/H4/D1/W1) is what /tracking-coins passes, while `SWING_CHART_TIMEFRAMES` (H4/D1/W1) is the
  narrower set the QQE column scans. The Bitget Setup tab keeps its own M15…D1 set unchanged.
  Server side, `1w` was added to `TF_CONFIG` (limit 300 / display 80) and `TF_MS`, and `tfLabelOf`
  learned `1w → W1`.
  *(Fixed 2026-07-26: the dialog was documented as swing-only but the `timeframes` prop was never
  actually passed at the call site, so the page still rendered the default M15…D1 switcher.)*
- **Table columns**: **DCA** (dcaScore badge + zone) and **Ext%** removed — both were frozen values
  from the dead scan. A **QQE** column takes their place, rendering the *same* `QqeCell` the Bitget
  Setup tab uses (extracted to `widgets/bitget/qqe-cell.tsx`): only timeframes whose colinmck QQE
  flipped within the last 5 closed candles show a badge, green = Long, red = Short.
- **QQE data** comes from `GET /bitget/qqe-signals`, polled every 60 s. The endpoint gained an
  optional `timeframes=` filter and `1w` support; this page requests only `4h,1d,1w`, which matters
  because it lists ~40 coins and each (coin, timeframe) pair is one Binance klines call. Omitting the
  param preserves the Bitget default (M30,1h,4h,1d).
- **M30 row removed** from every indicator stack — Trend (PA), UT Bot, EMA, RSI, Vol× now show
  **W / D1 / H4** only, in the table *and* in the detail modal's "Chỉ báo theo khung" grid.
- Sorting: the `dca` and `ext` sort keys went with their columns; the default sort is now **coin**
  (A→Z). RSI / Vol× / Coin header sorting still works.

## Edge Cases
- **Newly added coin** → no signal row → indicator cells show "—" and the Overview tab says
  "Chưa có dữ liệu chỉ báo cho coin này." Nothing will populate it until the new flow exists.
- **Stale indicators** — the table keeps rendering the last scanned values; the Overview footer
  ("Cập nhật: …") is the honest timestamp of how old that data is.
- **History / AI review tabs** → still render old rows; no new rows are appended. The DCA badge and
  Ext% still appear *there* (historical rows) even though both columns left the main table.
- **QQE on a young coin** → weekly needs 60 closed candles (~14 months); below that the API returns
  `null` for `1w` and the badge is simply absent. A coin with no live flip on any timeframe shows "—".
- **QQE is live data**, unlike everything else on the table — it is computed on request from Binance,
  so it keeps working while the stored signals stay frozen.
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
- `apps/web/src/widgets/bitget/setup-chart-dialog.tsx` — reused by tracking-coins; gained the
  optional `timeframes` prop + `SWING_CHART_TIMEFRAMES` (H4/D1/W1, QQE scan) +
  `TRACKING_CHART_TIMEFRAMES` (H1/H4/D1/W1, the /tracking-coins switcher) + `1w` label
- `apps/web/src/widgets/bitget/qqe-cell.tsx` — **new**: `QqeCell` / `isLiveSignal` / `bareQqeSymbol`
  extracted from `bitget-setup-feed.tsx` so both pages render the identical QQE column
- `apps/web/src/widgets/bitget/bitget-setup-feed.tsx` — imports the extracted cell (no behaviour change)
- `apps/api/src/modules/bitget/bitget.controller.ts` — `GET /bitget/setup-chart` (`@Public()`), the
  shared PNG endpoint both pages hit; `GET /bitget/qqe-signals` gained the optional `timeframes=` filter
- `apps/api/src/modules/bitget/bitget-setup-chart.service.ts` — `1w` added to `TF_CONFIG` / `TF_MS`
  and to the QQE supported set; `getQqeSignals(symbols, timeframes?)`
- `apps/web/src/shared/api/client.ts` — `fetchBitgetQqeSignals(symbols, timeframes?)`
- `apps/web/src/app/globals.css` — `.tc-coin-line`, `.tc-chart-btn`
- `apps/web/src/shared/api/client.ts` — `triggerTrackingCoinsScan`, `fetchOrderSuggestions`,
  `fetchCoinOrders`, `updateOrderNotes` removed
- `apps/web/src/shared/api/types.ts` — `OrderSuggestion`, `OrderSuggestions`, `TrackingCoinOrder` removed
- `packages/core/src/analysis/*` — **unchanged**: every indicator/scoring helper stays for reuse
- `packages/db/prisma/schema.prisma` — **unchanged**: no migration, no data loss
