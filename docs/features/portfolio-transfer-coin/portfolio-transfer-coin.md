## Description
Move an entire coin position from one portfolio to another. "Transferring" a coin reassigns
**all** of that coin's transactions (including soft-deleted rows and any mirrored DCA layers) to
the destination portfolio and recalculates holdings on both sides. Cost basis (`avgCost`),
`realizedPnl` and the full transaction history are preserved — no synthetic buy/sell is created and
no fake PnL is generated. If the destination portfolio already holds the same coin, the two
positions are merged on recalculation. This is a whole-position move, not a partial-quantity transfer.

## Main Flow
1. On the portfolio coin-detail page (`/portfolio/[id]/[coinId]`), the header shows a **Transfer**
   button whenever the coin has at least one transaction.
2. Clicking it opens `TransferCoinModal`, which loads the user's other portfolios
   (`fetchPortfolios`, excluding the current one) into a dropdown.
3. The user picks a destination and confirms → `POST /portfolios/:portfolioId/holdings/:coinId/transfer`
   with `{ targetPortfolioId }`.
4. The API verifies the caller owns **both** the source and the destination portfolio
   (`PortfolioService.getPortfolio` for each), then `HoldingsService.transferCoin`:
   - finds every `CoinTransaction` for that coin in the source portfolio,
   - in one DB transaction reassigns their `portfolioId` to the target and updates any
     `TrackingCoinDcaBuy` mirror rows (`transactionId` match) to the target,
   - recalculates holdings for the coin in the source (row disappears — no transactions left) and
     in the target (existing + moved transactions are replayed into a merged holding).
5. On success the UI navigates to `/portfolio/<target>/<coinId>`, where the coin now lives.

## Edge Cases
- **Same source and target** → `400 BadRequest` ("Source and target portfolios must be different").
- **No transactions for the coin in source** → `404 NotFound`.
- **Caller does not own one of the portfolios** → `403 Forbidden` (or `404` if it doesn't exist).
- **Destination already holds the coin** → positions merge; recalculation replays all transactions,
  yielding a combined `avgCost`/`totalAmount`/`realizedPnl`.
- **Closed position (current amount 0 but history exists)** → still transferable; the button is gated
  on `transactions.length > 0`, not on a positive holding amount, so realized history moves too.
- **No other portfolio exists** → dropdown is empty and the modal shows an inline hint.
- **PnlHistory snapshots** are intentionally left untouched in the source portfolio — they are a
  point-in-time daily record, not live state.

## Related Files (FE / BE / Worker)
- `apps/api/src/modules/holdings/holdings.controller.ts` — `POST :coinId/transfer` route, dual ownership check.
- `apps/api/src/modules/holdings/holdings.service.ts` — `transferCoin()` reassigns transactions + DCA mirror, recalcs both portfolios.
- `apps/api/src/modules/holdings/dto/transfer-coin.dto.ts` — `TransferCoinDto { targetPortfolioId }`.
- `apps/web/src/shared/api/client.ts` — `transferHolding(portfolioId, coinId, targetPortfolioId)`.
- `apps/web/src/widgets/portfolio-coin-detail/portfolio-coin-detail.tsx` — `TransferCoinModal` + Transfer button.
