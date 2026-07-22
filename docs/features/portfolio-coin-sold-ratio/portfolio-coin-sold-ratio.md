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
   quantity via the existing `formatCrypto` helper) and a "Total bought since inception" line.
5. The card sits between the existing stat-card grid (Quantity / Avg. buy price / Basic Cost /
   Total P&L) and the Transactions panel.

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
  `totalBoughtAmount`, `soldPct`/`remainingPct`, and the "Sold vs Remaining" `<article className="panel">` card.
- No API/worker changes — reuses the `transactions` prop already fetched by
  `apps/web/src/_pages/portfolio-coin-page/portfolio-coin-page.tsx` via `fetchTransactions()`.
