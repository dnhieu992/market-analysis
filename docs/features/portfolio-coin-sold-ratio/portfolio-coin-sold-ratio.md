## Description
Adds a **"Sold vs Remaining"** card to the portfolio coin detail page
(`/portfolio/[id]/[coinId]`). It shows a two-tone horizontal bar (red = sold, green =
remaining) plus the exact percentages and quantities, computed against every unit of the
coin ever bought since it was first added to the portfolio (not just the current open
position).

## Main Flow
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

## Edge Cases
- **No buy transactions yet** (`totalBoughtAmount === 0`) — the whole card is hidden; there is
  nothing meaningful to show a ratio of.
- **Fully sold position** (`totalSoldAmount === totalBoughtAmount`) — bar renders 100% red,
  0% green; the remaining segment is omitted from the DOM (0-width) rather than rendered at 0%.
- **Never sold** — bar renders 100% green; the sold segment is omitted.
- **Remaining amount** is derived independently (`totalBoughtAmount − totalSoldAmount`) rather
  than reused from `holding.totalAmount`, but the two always agree since the API's holdings
  reducer (`HoldingsService.replayTransactions`) computes `totalAmount` the same way.

## Related Files (FE / BE / Worker)
- `apps/web/src/widgets/portfolio-coin-detail/portfolio-coin-detail.tsx` — `totalSoldAmount`,
  `totalBoughtAmount`, `soldPct`/`remainingPct`, and the "Sold vs Remaining" grid item
  (`className="pc-stat-grid__span2"`) inside the `pc-stat-grid` stat-card row.
- `apps/web/src/app/globals.css` — `.pc-stat-grid` / `.pc-stat-grid__span2` (6-column desktop
  layout at `≥860px`, `auto-fit` wrap below that).
- No API/worker changes — reuses the `transactions` prop already fetched by
  `apps/web/src/_pages/portfolio-coin-page/portfolio-coin-page.tsx` via `fetchTransactions()`.
