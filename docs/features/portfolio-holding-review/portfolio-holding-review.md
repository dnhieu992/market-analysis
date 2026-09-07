## Description
The daily Claude portfolio review (00:00 UTC) shown inside the app instead of only in Telegram:
a verdict badge next to every coin in the Holdings table, and the full analysis — reasoning,
D1 metrics, buy/sell zones, plus the day-by-day history — on the coin detail page.

Verdicts are the four from the review prompt: 🟢 GOM THÊM · 🔵 GIỮ · 🟠 CHỐT BỚT · 🔴 THOÁT
(plus ⚪ KHÔNG CÓ DỮ LIỆU for a coin Binance has no data for). Since 2026-09-07 a **sold-out**
coin can also carry a buy-back verdict from the snowball scan — 🟢 MUA LẠI · 🟡 CHỜ VÙNG — and
only those two ever appear on a row whose holding is zero.

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
   🟩 buy / 🟥 sell zones. Older reviews collapse behind a "Lịch sử (n)" button.
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
- **Sold-out coin** — the daily scan now covers zeroed holdings too, but only the ones its
  buy-back gate shortlists (at most 6). Such a row keeps its normal opacity in the Holdings table
  instead of being dimmed as history, because a 🟢 MUA LẠI badge at 45% opacity is the one badge
  worth reading. A sold-out coin the gate skipped keeps its last badge from when it was held; the
  date on the badge shows how old that is.
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
- `apps/web/src/shared/lib/holding-review.ts` — verdict colours/emoji (incl. MUA LẠI / CHỜ VÙNG), date shortening, staleness
- `apps/web/src/widgets/portfolio-holdings-list/portfolio-holdings-list.tsx` — `VerdictBadge` per row, and the dim rule that a reviewed sold-out row opts out of
- `apps/web/src/widgets/portfolio-coin-detail/holding-review-panel.tsx` — the full panel + history
- `apps/web/src/widgets/portfolio-coin-detail/portfolio-coin-detail.tsx` — mounts the panel
- `claude-cron/portfolio-review/publish-reviews.mjs` — the writer (gitignored, server-local)
