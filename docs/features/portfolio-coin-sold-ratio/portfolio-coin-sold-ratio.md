## Description
Adds a **"Sold vs Remaining"** ratio indicator — a two-tone bar (red = sold, green =
remaining) computed against every unit of a coin ever bought since it was first added to a
portfolio (not just the current open position) — in two places:
1. A full-size card on the portfolio coin detail page (`/portfolio/[id]/[coinId]`), with
   exact percentages and quantities.
2. A compact inline bar per row on the portfolio's coin-list page (`/portfolio/[id]`), inside
   the existing "Holdings" column of the holdings table.

## Main Flow

### Coin detail page (`/portfolio/[id]/[coinId]`)
1. The coin detail page already loads the full transaction history for the coin as a prop
   (`transactions: CoinTransaction[]`, unfiltered, unpaginated — see
   `portfolio-coin-transactions-pagination`).
2. `PortfolioCoinDetail` sums `amount` across all `type: 'buy'` transactions
   (`totalBoughtAmount`) and all `type: 'sell'` transactions (`totalSoldAmount`).
3. `soldPct = totalSoldAmount / totalBoughtAmount × 100`, clamped to `[0, 100]`;
   `remainingPct = 100 − soldPct`.
4. The card renders a single flex-row bar with two segments sized by `width: {pct}%` (no
   external chart/slider library), plus a legend line under each segment (percentage +
   quantity via the existing `formatCrypto` helper).
5. The card is a 5th item inside the same `pc-stat-grid` as the 4 existing stat cards
   (Quantity / Avg. buy price / Basic Cost / Total P&L), given `className="pc-stat-grid__span2"`
   so it renders **2x the width** of a normal stat card. At `≥860px` viewport width
   `.pc-stat-grid` switches from `auto-fit` wrapping to a fixed `repeat(6, 1fr)` layout — 4
   single-span cards + 1 double-span card = 6 columns — so all 5 cards sit on **one row on
   desktop**; below that breakpoint it wraps like the other stat cards.

### Coin-list page (`/portfolio/[id]`)
1. `portfolio-detail-page.tsx` adds a 3rd parallel fetch — `client.fetchTransactions(portfolioId)`
   with **no `coinId` filter** — alongside the existing `fetchPortfolio`/`fetchHoldings` calls.
   The API/repository already supports this: omitting `coinId` from
   `GET /portfolios/:portfolioId/transactions` returns every non-deleted transaction for the
   whole portfolio (across all coins) in one call — no backend changes needed.
2. `PortfolioHoldingsList` receives this as a new `transactions` prop and groups it by `coinId`
   via `buildSoldRatioByCoin()`, producing a `Record<coinId, SoldRatio>` (`totalBought`,
   `totalSold`, `soldPct`, `remainingPct`) memoized on the transactions array.
3. Each coin row's existing "Holdings" cell gets a compact 4px-tall two-tone `SoldRatioBar`
   underneath the quantity/value lines — same red-sold/green-remaining convention as the coin
   detail page's card, but with no legend text (title/`aria-label` carry the percentages for
   hover/screen-reader access instead, to keep the table row compact).

## Edge Cases
- **No buy transactions yet** (`totalBoughtAmount === 0`) — the ratio card/bar is omitted for
  that coin; there is nothing meaningful to show a ratio of.
- **Fully sold position** (`totalSoldAmount === totalBoughtAmount`) — bar renders 100% red,
  0% green; the remaining segment is omitted from the DOM (0-width) rather than rendered at 0%.
- **Never sold** — bar renders 100% green; the sold segment is omitted.
- **Remaining amount** is derived independently (`totalBoughtAmount − totalSoldAmount`) rather
  than reused from `holding.totalAmount`, but the two always agree since the API's holdings
  reducer (`HoldingsService.replayTransactions`) computes `totalAmount` the same way.
- **List page: a coin fetch fails** — `Promise.allSettled` means a failed `fetchTransactions`
  call just yields `[]`; the holdings table still renders, only without any sold-ratio bars.

## Related Files (FE / BE / Worker)
- `apps/web/src/widgets/portfolio-coin-detail/portfolio-coin-detail.tsx` — `totalSoldAmount`,
  `totalBoughtAmount`, `soldPct`/`remainingPct`, and the "Sold vs Remaining" grid item
  (`className="pc-stat-grid__span2"`) inside the `pc-stat-grid` stat-card row.
- `apps/web/src/app/globals.css` — `.pc-stat-grid` / `.pc-stat-grid__span2` (6-column desktop
  layout at `≥860px`, `auto-fit` wrap below that).
- `apps/web/src/_pages/portfolio-detail-page/portfolio-detail-page.tsx` — adds the
  `client.fetchTransactions(portfolioId)` (no coinId) fetch and passes `transactions` down.
- `apps/web/src/widgets/portfolio-holdings-list/portfolio-holdings-list.tsx` —
  `buildSoldRatioByCoin()`, `SoldRatioBar`, per-row rendering inside the "Holdings" `<td>`.
- No API/worker changes — both pages reuse the existing
  `GET /portfolios/:portfolioId/transactions` endpoint (`coinId` optional).
