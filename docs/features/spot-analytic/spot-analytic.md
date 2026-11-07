# Spot Analytic (`/tracking-coins`) — 2026-11-07

Renamed from "Tracking Coins", listed right under Portfolio in the sidebar. Goal: spot dip-buying,
~+30% per leg (see `docs/features/tracking-swing-setups/SPOT-2026-11-07.md` for the switch).

## Table
Coin · Đánh giá (0–5 stars, `tracking_coins.rating`, `PUT /tracking-coins/coins/:symbol/rating`) ·
Giá · 24h/7d/30d/90d · Vốn hoá · Nhóm · Actions (History, delete).
Score column (D1 Supertrend rule), 180d column and the "Quét" button were removed.

Vốn hoá / Nhóm come from Binance's public product list (`get-products`, cached 1h,
`GET /tracking-coins/meta`): market cap = circulating supply × price; sectors map Binance tags to
L1 / L2 (known-rollup list) / Meme / DeFi / AI / RWA / Infra / Gaming / …

## Chat ↔ portfolio
- Context of a coin chat includes the coin's real holdings in every portfolio (amount, avg cost,
  unrealized %, realized) + its stars. Tool `get_portfolio_position` lists the latest transactions.
- Tool `propose_spot_trade` creates a `spot_trades` row (PENDING) shown as a card under the reply.
  Portfolio: explicit name, else the coin's only portfolio; none / several → the chat asks.
  Sells are checked against the holding.
- Card: Xác nhận / Sửa (amount, price, time, portfolio) / Huỷ. Confirm →
  `TransactionService.createTransaction` (same path as the portfolio page; note prefixed
  "[Spot Analytic]") and the row turns CONFIRMED with `transactionId`.

## History dialog
`GET /tracking-coins/coins/:symbol/history`: CONFIRMED spot trades of this page only (flagged
when the transaction was deleted on the portfolio page) + real holdings per portfolio (so totals
match the portfolio page, including trades typed there).
