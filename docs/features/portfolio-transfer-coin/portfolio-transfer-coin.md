## Description
Move a coin position from one portfolio to another — either the whole thing or a chosen quantity.
Both forms move units at the source's average cost, so no profit or loss is realized and the
destination inherits the same cost basis. If the destination already holds the same coin, the
positions merge.

The two forms are booked differently because only one of them can carry history:

| | Full transfer | Partial transfer |
|---|---|---|
| Trigger | `amount` omitted, or ≥ the current holding | `amount` below the current holding |
| Mechanism | Reassigns every `CoinTransaction` of that coin (soft-deleted rows included) to the target | Creates a **sell in the source + buy in the target**, both priced at the source `avgCost` |
| History | Moves with the position | Stays in the source; the target starts with the transfer-in row |
| `realizedPnl` | Preserved exactly | Unchanged — the sell is priced at cost, so it realizes zero |

A partial move cannot reassign rows (a single buy may be larger than the amount being moved, and
FIFO-splitting real buys would silently change the source's average cost), so it is booked as a
transfer pair instead. Both legs carry the `[transfer]` note prefix — `TRANSFER_NOTE_PREFIX`, kept
in `holdings.service.ts` and mirrored in `apps/web/src/shared/lib/transfer.ts` because the web app
does not depend on the API's packages. The prefix is what lets the UI tell a bookkeeping move from
a trade.

**Effect on the sold/remaining bar.** A transfer out is not a sale, so it is subtracted from
"ever bought" rather than added to "sold" — after moving units away, the source's remaining
quantity in the bar still matches its actual holding, and the sold percentage stays a measure of
trading. The incoming leg is an ordinary buy on the target's side and needs no special handling.

## Main Flow
1. On the portfolio coin-detail page (`/portfolio/[id]/[coinId]`), the header shows a **Transfer**
   button whenever the coin has at least one transaction.
2. Clicking it opens `TransferCoinModal`, which loads the user's other portfolios
   (`fetchPortfolios`, excluding the current one) into a dropdown.
3. The modal shows a **quantity** field pre-filled with the full holding, a **Max** button and
   25/50/75% presets. A line under it says what will happen: the whole position (history included)
   or how much stays behind.
4. Confirm → `POST /portfolios/:portfolioId/holdings/:coinId/transfer` with
   `{ targetPortfolioId, amount? }`. `amount` is omitted when the field is at (or within 1e-8 of)
   the full holding, which selects the full-transfer path.
5. The API verifies the caller owns **both** the source and the destination portfolio
   (`PortfolioService.getPortfolio` for each), then `HoldingsService.transferCoin`:
   - **partial** → `transferPartial()` creates the two `[transfer]` transactions at `avgCost`,
   - **full** → reassigns every `CoinTransaction` for that coin to the target,
   - either way, recalculates holdings for the coin in both portfolios by replaying transactions.
6. After a full transfer the UI navigates to `/portfolio/<target>/<coinId>`; after a partial one it
   reloads the current page, where the reduced quantity now shows.

## Edge Cases
- **Same source and target** → `400 BadRequest` ("Source and target portfolios must be different"),
  checked before the amount.
- **`amount` above the current holding** → `400 BadRequest` naming the available quantity.
- **`amount` ≤ 0 or non-numeric** → rejected by `class-validator` (`@IsPositive`) before the service.
- **`amount` within 1e-8 of the full holding** → treated as a full transfer rather than a partial
  one that would leave sub-satoshi dust behind. Quantities are `Decimal(20,8)`, so anything below
  that is not representable.
- **`amount` given but the coin has no holding row in the source** → `404 NotFound`.
- **No transactions for the coin in source** (full path) → `404 NotFound`.
- **Caller does not own one of the portfolios** → `403 Forbidden` (or `404` if it doesn't exist).
- **Closed position (amount 0 but history exists)** → the modal hides the quantity field and says
  the history moves in full; the button is gated on `transactions.length > 0`, not on a positive
  holding, so realized history still moves.
- **Destination already holds the coin** → positions merge; recalculation replays all transactions,
  yielding a combined `avgCost`/`totalAmount`/`realizedPnl`.
- **The transfer sell in the PnL calendar** → priced at `avgCost`, it contributes a realized PnL of
  zero (to within `Decimal(20,8)` rounding of the average cost), so a transfer does not move the
  day's PnL.
- **A `[transfer]` row in the transaction log** → labelled "Transfer in" / "Transfer out" instead of
  Buy/Sell. It is still an ordinary row: editing or deleting it is allowed and simply re-runs the
  replay, which is how a mistaken transfer is undone (delete both legs).
- **No other portfolio exists** → dropdown is empty and the modal shows an inline hint.
- **PnlHistory snapshots** are intentionally left untouched in the source portfolio — they are a
  point-in-time daily record, not live state.

## Related Files (FE / BE / Worker)
- `apps/api/src/modules/holdings/holdings.controller.ts` — `POST :coinId/transfer` route, dual ownership check, passes `amount` through.
- `apps/api/src/modules/holdings/holdings.service.ts` — `transferCoin()` picks the path and recalcs both portfolios; `transferPartial()` books the `[transfer]` pair; exports `TRANSFER_NOTE_PREFIX`.
- `apps/api/src/modules/holdings/dto/transfer-coin.dto.ts` — `TransferCoinDto { targetPortfolioId, amount? }`.
- `apps/api/test/holdings.transfer.spec.ts` — covers the partial pair, the full-history path, and the rejection cases.
- `apps/web/src/shared/api/client.ts` — `transferHolding(portfolioId, coinId, targetPortfolioId, amount?)`.
- `apps/web/src/shared/lib/transfer.ts` — `TRANSFER_NOTE_PREFIX` / `isTransferTransaction()` for the web side.
- `apps/web/src/widgets/portfolio-coin-detail/portfolio-coin-detail.tsx` — `TransferCoinModal` with the quantity field, the Transfer button, the sold-ratio calc, and the "Transfer in/out" row label.
- `apps/web/src/widgets/portfolio-holdings-list/portfolio-holdings-list.tsx` — `buildSoldRatioByCoin()` keeps transfers out of the sold bucket.
