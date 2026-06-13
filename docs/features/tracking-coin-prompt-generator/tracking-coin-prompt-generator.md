## Description
Trên trang `/tracking-coins`, mỗi dòng coin có một nút (icon AI). Trước đây nút này mở drawer chat gọi LLM tự động phân tích lệnh hiện tại. Tính năng AI đó **tạm thời bị disable** (code được giữ lại dưới dạng comment để bật lại sau).

Hành vi hiện tại: click nút → drawer trượt ra hiển thị **prompt phân tích đã được tạo sẵn** với đầy đủ chỉ báo của coin (trend D1/H4/M30, UT Bot, EMA, RSI, Volume, giá live, thời điểm scan) **cộng nến thô (OHLCV) dạng CSV** cho D1/H4/M30, và nút **Copy prompt**. Người dùng copy rồi dán vào AI bên ngoài để tự phân tích.

Nến được fetch **qua backend proxy** `GET /tracking-coins/coins/:symbol/klines?interval=&limit=` (server gọi Binance, tránh CORS/geo-block ở trình duyệt — vì web chạy trên HTTP và Binance hay chặn theo vùng) — D1 100 cây, H4 100 cây, M30 80 cây — rồi format CSV `time,open,high,low,close,volume` (giờ UTC, cũ → mới). Indicator vẫn giữ làm lớp số liệu chuẩn; prompt yêu cầu AI không tự tính lại indicator từ nến.

## Main Flow
1. User vào `/tracking-coins`.
2. Click nút icon AI (tooltip "Tạo prompt") ở cột actions của một coin.
3. `setChatCoin(coin)` mở `TrackingCoinChatDrawer`.
4. Drawer fetch nến D1/H4/M30 qua API `fetchCoinKlines` (`Promise.all`), build block CSV; trong lúc tải hiện "⏳ Đang tải nến…" và nút Copy bị disable.
5. Drawer gọi `buildInitialPrompt(coin, livePrice, candleSection)` để dựng prompt đầy đủ chỉ báo + nến CSV.
6. Prompt hiển thị trong textarea read-only; user bấm **Copy prompt** → copy vào clipboard (có fallback `execCommand` cho non-secure context).
7. Nút đổi sang "✓ Đã copy prompt" trong 2 giây.
8. Đóng drawer bằng nút ✕ hoặc click backdrop.

## Edge Cases
- `coin.signal` null → prompt chỉ gồm header + danh sách yêu cầu phân tích, bỏ qua phần chỉ báo.
- `navigator.clipboard` không khả dụng (HTTP / browser cũ) → fallback tạo textarea ẩn + `document.execCommand('copy')`.
- Tính năng AI chat cũ (createConversation → sendMessage → poll reply) được comment trong file drawer; muốn bật lại thì khôi phục block comment và phần render chat gốc.
- Fetch nến lỗi (mạng / symbol không có trên Binance) → hiện cảnh báo "⚠ Không tải được nến", prompt vẫn dùng được nhưng chỉ gồm chỉ báo (không có OHLCV).
- Trình duyệt gọi thẳng Binance hay bị chặn (CORS / geo / trang chạy HTTP) → đã chuyển sang gọi qua backend proxy server-side để ổn định.
- Số Binance trả dạng chuỗi fixed-decimal → `compactNum` bỏ số 0 thừa để CSV gọn.

## Related Files (FE / BE / Worker)
### Frontend
- `apps/web/src/widgets/tracking-coin-chat-drawer/tracking-coin-chat-drawer.tsx` — drawer: fetch nến qua API, dựng prompt + nút copy; logic AI chat cũ được comment giữ lại.
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — nút mở drawer (tooltip "Tạo prompt", icon `IconPrompt`, `setChatCoin`).
- `apps/web/src/shared/api/client.ts` — `fetchCoinKlines(symbol, interval, limit)`.
- `apps/web/src/shared/api/types.ts` — type `BinanceKline`.

### Backend (API)
- `apps/api/src/modules/tracking-coins/tracking-coins.controller.ts` — `GET coins/:symbol/klines`.
- `apps/api/src/modules/tracking-coins/tracking-coins.service.ts` — `fetchKlines()` proxy qua `BinanceMarketDataService`.
