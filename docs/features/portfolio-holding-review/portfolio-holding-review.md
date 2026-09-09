## Description
The daily Claude portfolio review (00:00 UTC) shown inside the app instead of only in Telegram:
a verdict badge next to every coin in the Holdings table, and the full analysis — reasoning,
D1 metrics, buy/sell zones, plus the day-by-day history — on the coin detail page.

Verdicts are the four from the review prompt: 🟢 GOM THÊM · 🔵 GIỮ · 🟠 CHỐT BỚT · 🔴 THOÁT
(plus ⚪ KHÔNG CÓ DỮ LIỆU for a coin Binance has no data for). Since 2026-09-07 a **sold-out**
coin can also carry a verdict from the snowball buy-back scan — 🟢 MUA LẠI · 🟡 CHỜ VÙNG · ⚫
KHÔNG ĐỦ ĐIỀU KIỆN — and only those three ever appear on a row whose holding is zero. Since
2026-09-09 every sold-out coin the scan can read Binance data for gets one of these three, not
just the top-6 shortlist — see the "Sold-out coin" edge case below for the split.

The analysis is produced entirely outside the app — see `docs/features/portfolio-daily-review/`.
The app only reads the `holding_reviews` table; it never writes it.

## Main Flow
1. The cron session writes `/var/tmp/portfolio-review/review.json` and runs `publish-reviews.mjs`,
   which upserts one `holding_reviews` row per `(portfolioId, coinId, reviewDate)`.
2. On `/portfolio/<id>`, `PortfolioHoldingsList` fetches `GET /portfolios/:id/holdings/reviews`
   after mount and renders a `VerdictBadge` next to each coin symbol. The badge's tooltip carries
   the report date, the reasoning, and `(đổi từ …)` when the verdict moved.
3. On `/portfolio/<id>/<coinId>`, `HoldingReviewPanel` fetches
   `GET /portfolios/:id/holdings/:coinId/reviews` (newest first, capped at 60) and renders the
   latest verdict in full: badge, price at review time, reasoning, the D1 metrics line, and the
   🟩 buy / 🟥 sell zones. A "Lịch sử (n)" button opens `ReviewHistoryDialog`, listing every older
   review as a one-line row (date, verdict, reason); clicking a row expands it in place to the
   same full detail as the latest review, via the shared `ReviewDetail` renderer.
4. Both endpoints go through `PortfolioService.getPortfolio` first, so a portfolio belonging to
   another user 404s before any review is read.

## Edge Cases
- **No review yet** — a coin the cron has never covered renders no badge, and the detail panel
  returns `null` rather than an empty card. Both pages are fully usable without the review.
- **Fetch fails** — the badge request swallows its error: the Holdings table loses its badges and
  nothing else changes.
- **Stale review** — the panel prints "· N ngày trước" once the newest review is older than a day,
  so a cron that stopped running is visible instead of looking like today's opinion.
- **Malformed JSON in a column** — `metricsJson` / `buyZonesJson` / `sellZonesJson` parse through a
  try/catch that falls back to `null` / `[]`; one bad column never fails the request.
- **Unknown verdict string** — `verdictStyle()` falls back to a grey ⚪ badge rather than crashing
  on a verdict the prompt did not produce.
- **Two rows for one coin and date** — impossible: `@@unique([portfolioId, coinId, reviewDate])`.
  A same-day re-run updates the row in place.
- **Sold-out coin** — the daily scan covers every zeroed holding it can read Binance data for, not
  just the ones its buy-back gate shortlists (at most 6, capped so the report block stays
  readable). Before 2026-09-09 a coin outside the top 6 got **no** DB entry at all — "missing" from
  the portfolio page, which read as a bug even though the report explained the gate. Now every such
  coin gets a verdict: `shortlisted: true` → 🟢 MUA LẠI / 🟡 CHỜ VÙNG with the full 3-tier ladder as
  `buyZones`; blocked only by score/no-pullback/outside-top-6 → the same two verdicts but with a
  single `entryZone` as `buyZones`; blocked by D1 downtrend, too-expensive-vs-last-sell, or no sell
  history at all → ⚫ **KHÔNG ĐỦ ĐIỀU KIỆN** with empty `buyZones` and the block reason as `reason`.
  A coin Binance has no data for still gets no entry. Every one of these rows still dims to 45%
  opacity like any other zero-holding row; the badge is shown but never brightens the row (a
  2026-09-08 attempt to except a live buy-back verdict from the dim rule made the row visibly
  un-dim every day the gate re-picked it — since 2026-09-09 a sold-out row dims unconditionally).
- **`Holding.note` is untouched** — the trader's note column and the review live in separate
  tables, so neither can overwrite the other.

## Related Files (FE / BE / Worker)
- `packages/db/prisma/schema.prisma` — `HoldingReview` model (`holding_reviews`)
- `packages/db/prisma/migrations/20260906091500_add_holding_reviews/migration.sql` — the table
- `packages/db/src/repositories/holding-review.repository.ts` — upsert, `latestByCoin`, `listByCoin`
- `apps/api/src/modules/database/database.providers.ts` — `HOLDING_REVIEW_REPOSITORY` provider
- `apps/api/src/modules/holdings/holdings.service.ts` — `getLatestReviews` / `getReviewHistory`,
  Decimal→number and JSON column mapping
- `apps/api/src/modules/holdings/holdings.controller.ts` — `GET .../holdings/reviews` and
  `GET .../holdings/:coinId/reviews`
- `apps/web/src/shared/api/client.ts` — `fetchHoldingReviews`, `fetchCoinReviewHistory`, `mapHoldingReview`
- `apps/web/src/shared/api/types.ts` — `HoldingReview`, `ReviewZone`
- `apps/web/src/shared/lib/holding-review.ts` — verdict colours/emoji (incl. MUA LẠI / CHỜ VÙNG / KHÔNG ĐỦ ĐIỀU KIỆN), date shortening, staleness
- `apps/web/src/widgets/portfolio-holdings-list/portfolio-holdings-list.tsx` — `VerdictBadge` per row; a zero-holding row always dims regardless of its verdict
- `apps/web/src/widgets/portfolio-coin-detail/holding-review-panel.tsx` — the full panel + history
- `apps/web/src/widgets/portfolio-coin-detail/portfolio-coin-detail.tsx` — mounts the panel
- `claude-cron/portfolio-review/snapshot.mjs` — builds the `watchlist` (soldOut coins), scores and
  gates them (`BUYBACK.shortlistMax` = 6), gitignored/server-local
- `claude-cron/portfolio-review/prompt.md` — the headless session's instructions; step 7 is what
  decides which watchlist coins get a `holding_reviews` entry and which verdict, gitignored/server-local
- `claude-cron/portfolio-review/publish-reviews.mjs` — the writer (gitignored, server-local)
