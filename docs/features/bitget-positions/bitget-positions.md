## Description
Tab **Vị thế đang mở** trong trang gộp `/bitget` hiển thị **tất cả vị thế futures đang mở** trên tài khoản Bitget USDT-M (đọc trực tiếp từ sàn, không phải từ DB). Mục đích: xem nhanh trạng thái live của mọi position mà bot day-trading (hoặc trader) đang giữ — size, giá vào, giá hiện tại, ký quỹ, PnL chưa thực hiện và ROE — mà không phải mở app Bitget.

> `/bitget` gộp 2 tab: **Vị thế đang mở** (trang này) và **Lịch sử & PnL** (xem `docs/features/bitget-history`). Hai route cũ `/bitget-positions` và `/bitget-history` redirect về trang gộp.

Chỉ đọc (read-only): trang không đặt/đóng lệnh. Việc đóng lệnh vẫn nằm ở luồng day-trading (`POST /day-trading/signals/:id/close`).

## Main Flow
1. Server component gộp `BitgetPage` fetch song song `fetchBitgetPositions()` + `fetchBitgetHistory()` khi render (SSR), truyền vào `BitgetTabs`; tab này render `BitgetPositionsFeed` (chế độ `embedded`).
2. `GET /bitget/positions` (API) → `BitgetService.getOpenPositions()`:
   - Nếu chưa cấu hình credentials (`BITGET_API_KEY/SECRET/PASSPHRASE`) → trả `configured: false`, danh sách rỗng.
   - Ngược lại gọi `BitgetTradeClient.getAllPositions()` → ký HMAC-SHA256 → `GET /api/v2/mix/position/all-position?marginCoin=USDT&productType=usdt-futures`.
   - Lọc các row có `total > 0`, map sang shape sạch (`BitgetPosition`), tính `notionalUsd = size × markPrice` và `roePct = unrealizedPL / marginSize × 100`, sắp xếp theo giá trị vị thế giảm dần, cộng tổng ký quỹ và tổng uPnL.
3. Widget client `BitgetPositionsFeed` render 3 tile tổng hợp + bảng vị thế, và **tự làm mới mỗi 15 giây** qua `createApiClient().fetchBitgetPositions()` (dữ liệu authoritative: margin, realized PnL, vị thế mới/đã đóng); có nút "Làm mới" thủ công và mốc thời gian "đồng bộ … trước".
4. **Giá realtime (WebSocket public Bitget):** hook `useBitgetLivePrices` mở kết nối `wss://ws.bitget.com/v2/ws/public` ngay từ browser (không cần auth, WS không vướng CORS), subscribe channel `ticker` cho từng symbol đang mở. Mỗi tick, widget tính lại **markPrice → uPnL/ROE/notional** ngay trên client giữa hai lần REST refresh, cập nhật cả 3 tile tổng hợp. Ô "Giá hiện tại" nhấp nháy xanh/đỏ theo chiều giá; badge **LIVE** ở header báo trạng thái kết nối WS. uPnL client-side = `(markPrice − entryPrice) × size × (long ? 1 : −1)`, được sàn reconcile lại mỗi 15s.

## Edge Cases
- **Chưa cấu hình Bitget** → `configured: false`, trang hiện hướng dẫn thêm biến `.env` thay vì lỗi.
- **Không có vị thế nào** → hiện "Không có vị thế nào đang mở."
- **Lỗi gọi sàn** (mạng/chữ ký) → SSR nuốt lỗi và trả state rỗng; lần refresh phía client hiện banner đỏ "Không tải được vị thế…", không làm sập trang.
- **`liquidationPrice` âm/không hợp lệ** (thường gặp với margin cross khi không có mức thanh lý thực) → map thành `null`, hiển thị "—".
- **`marginSize = 0`** → `roePct` trả 0 thay vì chia cho 0.
- Bảng cuộn ngang trong khung riêng (`.bg-table-wrap` `overflow-x: auto`) để không tràn body trên mobile; tile xếp 1 cột dưới 720px.
- **WS rớt kết nối** → `onclose` tự reconnect sau 3s; badge chuyển "offline"; bảng vẫn hiện giá REST 15s nên không bao giờ trắng dữ liệu.
- **Không có vị thế** → hook không mở WS (mảng symbol rỗng), badge "offline".
- **Ping/pong:** gửi text `ping` mỗi 20s để sàn không đóng kết nối (timeout 30s idle).

## Related Files (FE / BE / Worker)
- `apps/api/src/modules/day-trading/bitget-trade.client.ts` — thêm type `BitgetRawPosition` và hàm `getAllPositions()` (ký request v2, lọc vị thế mở).
- `apps/api/src/modules/bitget/bitget.service.ts` — `BitgetService`: gọi client, map + tính notional/ROE + tổng hợp.
- `apps/api/src/modules/bitget/bitget.controller.ts` — `GET /bitget/positions`.
- `apps/api/src/modules/bitget/bitget.module.ts` — module, đăng ký trong `apps/api/src/app.module.ts`.
- `apps/web/src/shared/api/types.ts` — type `BitgetPosition`, `BitgetPositionsResponse`.
- `apps/web/src/shared/api/client.ts` — `fetchBitgetPositions()`.
- `apps/web/src/_pages/bitget-page/bitget-page.tsx` — server component gộp: fetch positions + history, chọn tab từ `?tab=`.
- `apps/web/src/widgets/bitget/bitget-tabs.tsx` — client: tab bar Vị thế / Lịch sử.
- `apps/web/src/widgets/bitget-positions/bitget-positions-feed.tsx` — widget client: bảng + tile + auto-refresh 15s + ghép giá live, tính lại uPnL/ROE/notional, badge LIVE, flash ô giá (prop `embedded`).
- `apps/web/src/widgets/bitget-positions/use-bitget-live-prices.ts` — hook WebSocket public Bitget (ticker) trả map giá realtime + trạng thái kết nối.
- `apps/web/src/app/bitget/page.tsx` — route re-export trang gộp.
- `apps/web/src/app/bitget-positions/page.tsx` — redirect `/bitget` (giữ bookmark cũ).
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — mục nav gộp "Bitget".
- `apps/web/src/app/globals.css` — style `.bg-*` + `.bg-tabs`/`.bg-tab`/`.bg-panel` cho trang.
