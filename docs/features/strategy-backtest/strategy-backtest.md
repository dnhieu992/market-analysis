# Strategy Backtest (`/strategy-backtest`)

## Description
A scorecard for the trader's own manual analysis. Setups are written by hand on the page —
direction, swing or scalping, limit or market, a stop, optionally a target, a note and the
chart screenshots the read was based on — and a worker cron then watches the market for
them exactly the way an order left on an exchange behaves. A **limit** setup waits at the
entry and fills when price trades through it; a **market** setup is entered on the spot at
the live price. Either way it then runs to TP or SL.

Nothing here is automated analysis and nothing places a real order. The point is to answer
"were my setups actually any good?" with a win rate, an R total and a fill rate, instead of
from memory. Today only `BTCUSDT` is tracked; the table and the scan job already key on
`symbol`, so adding pairs is a UI change only.

Once a setup has resolved it can also carry a **review** — a markdown post-mortem with its
own screenshots, written from a dialog on the card. It is kept apart from the setup's `note`
on purpose: the note is the plan going in ("why this is worth taking"), the review is the
verdict coming out ("why it actually won/lost, and what to change"). Neither can overwrite
the other, so the board keeps both halves of the lesson.

The data lives in its own table (`strategy_backtest_setups`) with no relation to
`Order`/`Signal`/`TrackingCoin` — deliberately, so this history is never touched by the
automated pipelines. **Nothing is ever deleted**: a setup the trader calls off becomes
`INVALID` (with an optional reason) and stays on the board, because the plans that were
abandoned are part of what there is to learn from later.

## Main Flow
1. The trader opens `/strategy-backtest` and fills in the form: LONG/SHORT, Swing/Scalping,
   Limit/Market, stop loss, optional take profit, a note on why the setup is worth taking, and
   any number of chart screenshots. For a limit setup the entry price is typed; for a market
   setup the field is replaced by the live price, read-only, because the server prices it. The
   planned R:R updates live while the numbers are typed.
2. Screenshots are uploaded to Cloudflare R2 first (`POST /upload/images`), and only then is
   the setup written — a setup that saved but lost its charts is the worse outcome, so a failed
   upload aborts before anything is stored.
3. `POST /strategy-backtest` validates that the three prices describe a real trade (LONG →
   stop below entry, target above; mirrored for SHORT).
   - **LIMIT** → stored as `PENDING` at the price the trader typed.
   - **MARKET** → the server reads the live price, uses it as the entry, and writes the row
     straight to `ENTERED` with `triggeredAt` set. It never passes through `PENDING`. The
     client deliberately does not send an entry price for this case, so the entry can never
     be a level that did not actually trade.
4. Every 5 minutes `SchedulerService.runStrategyBacktestScan()` calls
   `StrategyBacktestScanService.scan()`, which loads the open setups, groups them by symbol
   and fetches 60 public Binance **5m** candles per symbol.
5. `replaySetup()` replays only the candles newer than the setup's `lastCheckedAt` watermark:
   - `PENDING` → `ENTERED` when a candle trades through `entryPrice` (LONG needs the low to
     reach it, SHORT the high) — `triggeredAt` is stamped.
   - `ENTERED` → `SL_HIT` / `TP_HIT` when a candle trades through the stop or the target.
     `exitPrice`, `pnlPct` (net of 0.05%/side) and `rMultiple` are written on close.
6. The page polls `GET /strategy-backtest` every 60s. The API returns the setups plus the
   live price, and computes `plannedRr`, `distanceToEntryPct` (PENDING) and
   `unrealizedPct` / `unrealizedR` (ENTERED) on the fly — none of those are stored.
7. Anything the job cannot decide is the trader's call: close a filled setup by hand at the
   live price (`CLOSED`), or mark a waiting or running one `INVALID` when the reasoning
   behind it stops holding. The Invalid button opens a dialog for an optional reason, which
   is then shown on the card.
8. Every card's title row carries a **Review** button. It opens a dialog showing the setup's
   numbers (entry / SL / TP / exit / % / R) above the post-mortem, rendered as markdown, plus
   any review screenshots. "Sửa review" switches to the shared `MarkdownEditor` and an
   `ImageUpload` (markdown tables included); saving uploads the new charts first and then
   `PATCH`es `review` + `reviewImages`. The button reads `+ Review` (dashed) until something is written and
   `✓ Review` (solid) after, so an unreviewed loss is visible from the board.

## Edge Cases
- **A candle that trades through both the stop and the target is scored as the stop.** Intra-
  candle order is unknowable from OHLC, so the pessimistic read is the only one that cannot
  flatter the win rate. The same rule lets a setup fill *and* stop out inside one candle.
- **A market entry is never exited on the candle it opened in.** It is born `ENTERED` partway
  through a 5m candle, and the part of that candle's range that printed beforehand happened
  while the trader was not in the trade — stopping out on it would be plainly wrong rather
  than conservative. Exits resume on the first candle that opens after `triggeredAt`. A limit
  fill detected inside the same replay run is unaffected: there the fill and the exit share
  one candle in unknown order, so the pessimistic rule above still applies.
- **A market setup cannot be created while Binance is unreachable.** Without a live price
  there is nothing honest to use as the entry, so the request is rejected with a message
  suggesting a limit order instead.
- **A new setup never back-fills against history.** The replay skips every candle that closed
  before the setup was created; only the single candle straddling creation is kept, because
  dropping it would lose up to 5 minutes of real fills.
- **Missed passes are caught up, not lost.** The scan fetches 5 hours of candles and replays
  from the `lastCheckedAt` watermark, so a worker restart or a deploy is replayed on the next
  pass. Re-processing an already-seen candle is harmless: the state machine only moves forward.
- **Overlapping runs are skipped**, guarded by an in-service `scanning` flag.
- **Binance failures are non-fatal.** A symbol that throws is logged and retried in 5 minutes
  with its watermark untouched. On the API side a failed price fetch returns `price: null` and
  the board still renders, just without the live columns.
- **A setup without a take profit** runs until the stop or a manual close — it is never closed
  on an up move.
- **Prices are frozen once a setup fills.** `PATCH` rejects price edits unless the setup is
  still `PENDING`; the note stays editable for the whole life of the setup. A market setup is
  therefore never price-editable — it is `ENTERED` from birth, which is the correct reading:
  the trade is already on.
- **Cancel only applies to unfilled setups; manual close only to filled ones** — both rejected
  with a Vietnamese message the dialog shows verbatim.
- **`INVALID` stops the tracking, immediately.** The status is simply not in
  `STRATEGY_BACKTEST_OPEN_STATUSES`, so the very next scan pass no longer loads the setup —
  there is no separate flag to keep in sync. It applies to a setup that has already filled,
  not only to one still waiting, and it is the only way off the board.
- **There is no delete and no cancel.** Both the `DELETE` route and the cancel action were
  removed on purpose; a plan the trader wrote stays readable forever. The reason field is
  optional — an invalid setup with no explanation is still recorded as invalid.
- **Stats exclude what they should.** Win rate and R are computed only over setups that filled
  *and* finished; an invalidated setup never produced a verdict to score, and an open one has
  not resolved. Invalid setups are dropped from the denominators too, not just the numerator.
  A break-even close counts as a loss, not a win.
- **Screenshots are create-only.** They are attached when the setup is written and shown as a
  thumbnail strip on the card (click for a lightbox); there is no edit path for them yet.
- **A review is editable in every status, unlike the prices.** A setup is reviewed *after* it
  resolved, so gating the field on `PENDING` the way the prices are gated would make it
  impossible to ever fill in. Saving an empty review clears both the text and `reviewedAt`.
- **The review dialog opens in edit mode when there is nothing written yet**, and in read mode
  once there is — re-reading an old verdict is the common case. Cancelling the first-ever
  review closes the dialog (there is nothing to fall back to); cancelling an edit of an
  existing one restores the saved text and images.
- **Review screenshots upload before the text is written**, same order as setup creation: a
  review that saved but lost its charts is the worse outcome. Existing review images can be
  removed in the editor; they are not deleted from R2, only unlinked.
- **No expiry.** A `PENDING` setup waits indefinitely — by the trader's choice, it is cancelled
  by hand. There is no Telegram notification either; the page is the only surface.

## Related Files (FE / BE / Worker)

**Web**
- `apps/web/src/app/strategy-backtest/page.tsx` — route, thin re-export
- `apps/web/src/_pages/strategy-backtest-page/strategy-backtest-page.tsx` — Server Component, loads the board
- `apps/web/src/widgets/strategy-backtest/strategy-backtest-board.tsx` — client widget: form (type toggle + image upload), filters, cards, screenshot lightbox, invalid-reason dialog, Review button, 60s polling
- `apps/web/src/widgets/strategy-backtest/review-dialog.tsx` — the post-mortem dialog: result strip, markdown read/edit (shared `MarkdownEditor`), review-image upload and lightbox
- `apps/web/src/shared/ui/markdown-editor/markdown-editor.tsx` — reused TipTap editor
- `apps/web/src/shared/lib/markdown.ts` — `renderMarkdown` used for the read-only render
- `apps/web/src/shared/ui/image-upload/image-upload.tsx` — reused screenshot picker
- `apps/web/src/widgets/strategy-backtest/setup-stats.ts` — pure scorecard math (win rate, R, fill rate)
- `apps/web/src/widgets/strategy-backtest/setup-stats.spec.ts` — its tests
- `apps/web/src/shared/api/client.ts` — `fetchStrategyBacktestBoard` and the mutations (via `mutationJson`, which surfaces the API's message)
- `apps/web/src/shared/api/types.ts` — `StrategyBacktestSetup`, `StrategyBacktestBoard`
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav entry
- `apps/web/src/app/globals.css` — `.sbt-*` styles

**API**
- `apps/api/src/modules/strategy-backtest/strategy-backtest.controller.ts` — `GET /`, `POST /`, `PATCH /:id`, `POST /:id/invalidate`, `POST /:id/close` (no `DELETE` on purpose)
- `apps/api/src/modules/strategy-backtest/strategy-backtest.service.ts` — validation, live-price enrichment, manual close, invalidate-with-reason
- `apps/api/src/modules/strategy-backtest/dto/*.ts` — `class-validator` DTOs
- `apps/api/src/app.module.ts` — module registration

**Worker**
- `apps/worker/src/modules/strategy-backtest/strategy-backtest-scan.service.ts` — the 5m scan and the pure `replaySetup()`
- `apps/worker/src/modules/strategy-backtest/strategy-backtest.module.ts`
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — the `*/5 * * * *` cron
- `apps/worker/test/strategy-backtest-scan.service.spec.ts` — replay tests

**Shared**
- `packages/core/src/setups/strategy-backtest-math.ts` — PnL / R / R:R formulas shared by worker and API
- `packages/db/prisma/schema.prisma` — `StrategyBacktestSetup`
- `packages/db/prisma/migrations/20260831120000_add_strategy_backtest_setups/migration.sql`
- `packages/db/prisma/migrations/20260831160000_add_setup_type_and_images/migration.sql` — `setupType` + `images`
- `packages/db/prisma/migrations/20260831180000_add_setup_invalid_reason/migration.sql` — `invalidReason`
- `packages/db/prisma/migrations/20260831200000_add_setup_order_type/migration.sql` — `orderType`
- `packages/db/prisma/migrations/20260901120000_add_setup_review/migration.sql` — `review` + `reviewImages` + `reviewedAt`
- `packages/db/src/repositories/strategy-backtest.repository.ts`
