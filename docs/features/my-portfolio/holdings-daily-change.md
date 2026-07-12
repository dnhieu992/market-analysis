## Description
Trong danh sách Holdings của một portfolio, cột **Current Price** hiển thị thêm **% thay đổi theo ngày (24h)** ngay dưới giá hiện tại — xanh nếu tăng, đỏ nếu giảm. Giúp nhìn nhanh động lượng trong ngày của từng coin ngay tại bảng holdings.

## Main Flow
1. `PortfolioHoldingsList` mount → gọi `fetchPrices(coinIds)`.
2. `fetchPrices` gọi Binance `GET /api/v3/ticker/24hr?symbols=[...]` (thay cho `ticker/price` cũ), trả về `{ prices, changes }`:
   - `prices[coin]` = `lastPrice`
   - `changes[coin]` = `priceChangePercent` (biến động rolling 24h, %).
3. Kết quả set vào state `prices` và `changes`; poll lại mỗi 5s (live).
4. Ở mỗi hàng, cột **Current Price** render giá (`formatCryptoPrice`) và, nếu có `changes[coinId]`, render dòng phụ `±xx.xx%` với màu theo dấu.

## Edge Cases
- Coin không có cặp `USDT` trên Binance / lỗi fetch → `fetchPrices` trả map rỗng; cột hiện `—`, không có dòng % (guard `changes[coinId] != null`).
- Chưa load xong giá → hiện `loading…` (state `pricesLoaded`).
- `changes` là biến động 24h của thị trường (không phải PnL của vị thế) — % lời/lỗ so với giá vốn vẫn nằm ở cột **Avg. Buy Price**.

## Related Files (FE / BE / Worker)
- `apps/web/src/widgets/portfolio-holdings-list/portfolio-holdings-list.tsx` — `fetchPrices` đổi sang `ticker/24hr` trả `{ prices, changes }`; thêm state `changes`; cột Current Price render % thay đổi ngày dưới giá.
