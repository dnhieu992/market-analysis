## Description
Trang `/bitget-positions` hiển thị **tất cả vị thế futures đang mở** trên tài khoản Bitget USDT-M (đọc trực tiếp từ sàn, không phải từ DB). Mục đích: xem nhanh trạng thái live của mọi position mà bot day-trading (hoặc trader) đang giữ — size, giá vào, giá hiện tại, ký quỹ, PnL chưa thực hiện và ROE — mà không phải mở app Bitget.

Chỉ đọc (read-only): trang không đặt/đóng lệnh. Việc đóng lệnh vẫn nằm ở luồng day-trading (`POST /day-trading/signals/:id/close`).

## Main Flow
1. Server component `BitgetPositionsPage` gọi `createServerApiClient().fetchBitgetPositions()` khi render (SSR), truyền dữ liệu ban đầu vào widget.
2. `GET /bitget/positions` (API) → `BitgetService.getOpenPositions()`:
   - Nếu chưa cấu hình credentials (`BITGET_API_KEY/SECRET/PASSPHRASE`) → trả `configured: false`, danh sách rỗng.
   - Ngược lại gọi `BitgetTradeClient.getAllPositions()` → ký HMAC-SHA256 → `GET /api/v2/mix/position/all-position?marginCoin=USDT&productType=usdt-futures`.
   - Lọc các row có `total > 0`, map sang shape sạch (`BitgetPosition`), tính `notionalUsd = size × markPrice` và `roePct = unrealizedPL / marginSize × 100`, sắp xếp theo giá trị vị thế giảm dần, cộng tổng ký quỹ và tổng uPnL.
3. Widget client `BitgetPositionsFeed` render 3 tile tổng hợp + bảng vị thế, và **tự làm mới mỗi 15 giây** qua `createApiClient().fetchBitgetPositions()`; có nút "Làm mới" thủ công và mốc thời gian "cập nhật … trước".

## Edge Cases
- **Chưa cấu hình Bitget** → `configured: false`, trang hiện hướng dẫn thêm biến `.env` thay vì lỗi.
- **Không có vị thế nào** → hiện "Không có vị thế nào đang mở."
- **Lỗi gọi sàn** (mạng/chữ ký) → SSR nuốt lỗi và trả state rỗng; lần refresh phía client hiện banner đỏ "Không tải được vị thế…", không làm sập trang.
- **`liquidationPrice` âm/không hợp lệ** (thường gặp với margin cross khi không có mức thanh lý thực) → map thành `null`, hiển thị "—".
- **`marginSize = 0`** → `roePct` trả 0 thay vì chia cho 0.
- Bảng cuộn ngang trong khung riêng (`.bg-table-wrap` `overflow-x: auto`) để không tràn body trên mobile; tile xếp 1 cột dưới 720px.

## Related Files (FE / BE / Worker)
- `apps/api/src/modules/day-trading/bitget-trade.client.ts` — thêm type `BitgetRawPosition` và hàm `getAllPositions()` (ký request v2, lọc vị thế mở).
- `apps/api/src/modules/bitget/bitget.service.ts` — `BitgetService`: gọi client, map + tính notional/ROE + tổng hợp.
- `apps/api/src/modules/bitget/bitget.controller.ts` — `GET /bitget/positions`.
- `apps/api/src/modules/bitget/bitget.module.ts` — module, đăng ký trong `apps/api/src/app.module.ts`.
- `apps/web/src/shared/api/types.ts` — type `BitgetPosition`, `BitgetPositionsResponse`.
- `apps/web/src/shared/api/client.ts` — `fetchBitgetPositions()`.
- `apps/web/src/_pages/bitget-positions-page/bitget-positions-page.tsx` — server component tải dữ liệu.
- `apps/web/src/widgets/bitget-positions/bitget-positions-feed.tsx` — widget client: bảng + tile + auto-refresh 15s.
- `apps/web/src/app/bitget-positions/page.tsx` — route re-export.
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — mục nav "Bitget Positions".
- `apps/web/src/app/globals.css` — style `.bg-*` cho trang.
