## Description
Client-side pagination and buy/sell type filtering for the transaction list on a portfolio
coin detail page (`/portfolio/[id]/[coin]`). Shows 10 transactions per page, a count next to
the **Transactions** title, and two toggle chips (Buy / Sell) to filter by transaction type.

## Main Flow
1. The coin detail page loads the full transaction list for the coin as a prop (unchanged).
2. `PortfolioCoinDetail` keeps a `typeFilter` state (`all | buy | sell`). Two chips in the
   header toggle it: clicking the active chip clears the filter back to `all`. Changing the
   filter resets the page to 1.
3. The list is filtered by `typeFilter`, then `page`/`TX_PAGE_SIZE` (10) slices it to the
   current page window; only that slice renders in the table.
4. The section title renders `Transactions (N)` where `N` is the **filtered** transaction count.
5. When there is more than one page, a `tt-pagination` control (Prev / numbered pages with
   ellipsis / Next) lets the user switch pages. The active page button is highlighted.

## Edge Cases
- **≤ 10 (filtered) transactions** — the pagination control is hidden (only one page); count still shows.
- **0 transactions overall** — the "No transactions yet." empty state renders; count shows `(0)`.
- **Filter matches nothing** — shows "No buy transactions." / "No sell transactions."
- **Page out of range after a delete or filter change** — `safePage` is clamped to `[1, totalPages]`,
  so the slice never reads past the end even before the post-delete `window.location.reload()`.

## Related Files (FE / BE / Worker)
- `apps/web/src/widgets/portfolio-coin-detail/portfolio-coin-detail.tsx` — `TX_PAGE_SIZE`,
  `getPageNumbers`, `page`/`typeFilter` state, filtered+paginated slice, count title,
  Buy/Sell filter chips, `tt-pagination` controls.
- `apps/web/src/app/globals.css` — `.tx-filter-chip*` styles; reuses `.tt-pagination*`.
