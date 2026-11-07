# Spot Analytic (`/tracking-coins`) — 2026-11-07

Renamed from "Tracking Coins", listed right under Portfolio in the sidebar. Goal: spot dip-buying,
~+30% per leg (see `docs/features/tracking-swing-setups/SPOT-2026-11-07.md` for the switch).

## Table
Coin · Đánh giá (0–5 stars, `tracking_coins.rating`, `PUT /tracking-coins/coins/:symbol/rating`) ·
Giá · 24h/7d/30d/90d · Vốn hoá · Nhóm · Actions (History, delete).
Score column (D1 Supertrend rule), 180d column and the "Quét" button were removed.
Coin cell has one icon: chart (SonicR chart dialog). Since 2026-11-07 there is no per-coin chat:
rows are no longer clickable and the per-row chat icon is gone. The page has a single floating
"🧭 AI" button (bottom-right, same `.fab` style as /trading-list from `bitget-ai-chat.module.css`)
that opens the watchlist-scope chat drawer (`CoinPanel` with `symbol=null`). Old per-coin
conversations stay in the DB but are not listed by that drawer (it filters `metadata.symbol` empty).
Page header is left-aligned (title + Chiến lược / + Coin buttons side by side).

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

## Chiến lược (2026-11-07)
- Chiến lược định nghĩa trong code: `packages/skills/src/tracking-swing/strategies.ts` (`SPOT_STRATEGIES`, `ACTIVE_SPOT_STRATEGY`). Chiến lược đang áp dụng được chèn vào system prompt của chat. Thêm chiến lược mới = thêm phần tử B, C…; đổi chiến lược của chat = đổi `ACTIVE_SPOT_STRATEGY`.
- **Chiến lược A**: alt quá bán (RSI tuần < 35) + breadth alt (≥25% mua, 10–25% chỉ top 50, <10% không mở lệnh mới), 8–12 phần vốn, thang 30/30/40 ở 0/−15/−35%, TP = TB × 1.3, không SL. Mục tiêu 15–25%/năm. Nguồn: claude-backtest/runs/2026-11-07-spot-alt-pump-regime.md.
- `GET /tracking-coins/strategies` → nút **Chiến lược** trên trang mở dialog xem quy tắc / backtest.
- Tool `get_tracking_coins` thêm cột rsiW, volRank và dòng breadth (tính trên toàn bộ alt USDT Binance như backtest, cache 6 giờ; kèm số coin quá bán trong danh sách).
- Danh sách theo dõi được bổ sung top 100 alt theo volume 30 ngày (niêm yết ≥ 1 năm), 65 coin mới, mặc định 3 sao.
