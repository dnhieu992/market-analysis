## Description
Client-side pagination for the transaction list on a portfolio coin detail page
(`/portfolio/[id]/[coin]`). Shows 10 transactions per page and displays the total
transaction count next to the **Transactions** title.

## Main Flow
1. The coin detail page loads the full transaction list for the coin as a prop (unchanged).
2. `PortfolioCoinDetail` keeps a `page` state; it slices the transactions to the current
   page window of `TX_PAGE_SIZE` (10) and renders only that slice in the table.
3. The section title renders `Transactions (N)` where `N` is the total transaction count.
4. When there is more than one page, a `tt-pagination` control (Prev / numbered pages with
   ellipsis / Next) lets the user switch pages. The active page button is highlighted.

## Edge Cases
- **≤ 10 transactions** — the pagination control is hidden (only one page); the count still shows.
- **0 transactions** — the "No transactions yet." empty state renders and the count `(N)` is hidden.
- **Page out of range after a delete** — `safePage` is clamped to `[1, totalPages]`, so the slice
  never reads past the end even before the post-delete `window.location.reload()`.

## Related Files (FE / BE / Worker)
- `apps/web/src/widgets/portfolio-coin-detail/portfolio-coin-detail.tsx` — `TX_PAGE_SIZE`,
  `getPageNumbers`, `page` state, paginated slice, total-count title, `tt-pagination` controls.
- `apps/web/src/app/globals.css` — reuses the existing `.tt-pagination*` styles.
