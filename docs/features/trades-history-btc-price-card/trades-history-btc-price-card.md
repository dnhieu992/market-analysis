## Description
A live BTC price card in the Trades History summary bar — shows the current BTCUSDT
price, 24h change %, and a green/red flash on tick direction, as a market-context
reference while reviewing trades.

## Main Flow
1. `BtcPriceCard` mounts and fetches `https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT`.
2. It polls every 5s, updates the price, computes tick direction (up/down vs previous), and shows
   the 24h change % (green when ≥0, red otherwise).
3. The card renders in the `tt-summary-bar`, always visible (even when there are no orders);
   the unrealized/closed P&L cards still render alongside it only when orders exist.

## Edge Cases
- **Fetch failure** → silently ignored; the card keeps the last value (or "…" before first load).
- **No orders** → the summary bar still shows just the BTC price card.
- Component unmount clears the polling interval (no leak).

## Related Files (FE / BE / Worker)
- `apps/web/src/widgets/trades-history/trades-table.tsx` — `BtcPriceCard` component + summary-bar render
