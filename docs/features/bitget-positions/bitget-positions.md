## Description
Tab **Vị thế đang mở** trong trang gộp `/bitget` hiển thị **tất cả vị thế futures đang mở** trên tài khoản Bitget USDT-M (đọc trực tiếp từ sàn, không phải từ DB). Mục đích: xem nhanh trạng thái live của mọi position đang giữ — size, giá vào, giá hiện tại, ký quỹ, PnL chưa thực hiện và ROE — mà không phải mở app Bitget.

> `/bitget` gộp 2 tab: **Vị thế đang mở** (trang này) và **Lịch sử & PnL** (xem `docs/features/bitget-history`). Hai route cũ `/bitget-positions` và `/bitget-history` redirect về trang gộp.

**Force-close:** mỗi dòng có nút **Đóng** để đóng vị thế theo **giá market** ngay (reduce-only) qua `POST /bitget/positions/close` — dùng `BitgetTradeClient.closePosition()` (client Bitget dùng chung, đặt tại chính module `bitget`). Có xác nhận trước khi đóng; nếu sàn đã flat thì trả 409.

**Số dư tài khoản:** tile **Số dư tài khoản** (equity = số dư ví + PnL chưa thực hiện) lấy từ `GET /api/v2/mix/account/accounts` (marginCoin USDT). Ngay dưới con số là **% thay đổi so với vốn gốc** — `(equity − vốn gốc) ÷ vốn gốc × 100`, xanh/đỏ theo dấu, kèm chú thích "so với vốn $X". Vốn gốc là hằng số `INITIAL_CAPITAL_USD` trong `BitgetService` (mặc định **$100**, override bằng env `BITGET_INITIAL_CAPITAL_USD`) — **phải cập nhật khi nạp thêm vốn**, nếu không % sẽ vô nghĩa. Fetch song song với positions, non-fatal (lỗi → `null` → hiển thị "—", không làm trắng bảng). Tile **PnL chưa thực hiện** hiện **% dựa trên số dư tài khoản** (`totalUnrealizedPnlUsd ÷ accountEquity`) khi ẩn value, và số USD khi hiện value.

**Ẩn/hiện value:** toggle **👁 Hiện value / 🙈 Ẩn value** ở góc phải trên bảng áp dụng cho **số dư tài khoản** và **PnL**: khi tắt, tile "Số dư tài khoản" hiện `••••••` cho **số tiền USD**, còn dòng **% so với vốn gốc** thì **luôn hiện** (theo yêu cầu của user — lưu ý: biết % + vốn gốc là suy ra được số dư), và PnL (tile + cột từng dòng) chỉ hiện **%** (ROE / % trên equity); khi bật hiện số USD đầy đủ. Lựa chọn lưu ở `localStorage` (`bitget:pnl-show-value`), mặc định **ẩn**. Nút toggle hiện bất cứ khi nào đã cấu hình API (kể cả khi không có vị thế nào) để luôn xem lại được số dư. Tile **Tổng ký quỹ** luôn hiện số USD.

**Đặt TP/SL trên sàn:** mỗi dòng có nút **TP / SL** (ngay trước nút Đóng) hiện mức TP/SL đang live trên sàn. Bấm mở dialog để nhập giá kích hoạt; giá trị được đẩy thẳng lên Bitget dưới dạng **position TP/SL plan order** (`POST /api/v2/mix/order/place-pos-tpsl`, trigger theo **Mark Price**, đóng toàn bộ vị thế) — **sàn tự đóng lệnh khi chạm mức**, không phụ thuộc dashboard/worker có đang chạy hay không. Mức hiện tại đọc từ chính row vị thế (`takeProfit` / `stopLoss` của `all-position`). Mỗi lần đặt đều được ghi **log hệ thống** vào nhật ký lệnh (`kind: 'system'`).

## Main Flow
1. Server component gộp `BitgetPage` fetch song song `fetchBitgetPositions()` + `fetchBitgetHistory()` khi render (SSR), truyền vào `BitgetTabs`; tab này render `BitgetPositionsFeed` (chế độ `embedded`).
2. `GET /bitget/positions` (API) → `BitgetService.getOpenPositions()`:
   - Nếu chưa cấu hình credentials (`BITGET_API_KEY/SECRET/PASSPHRASE`) → trả `configured: false`, danh sách rỗng.
   - Ngược lại gọi `BitgetTradeClient.getAllPositions()` → ký HMAC-SHA256 → `GET /api/v2/mix/position/all-position?marginCoin=USDT&productType=usdt-futures`.
   - Lọc các row có `total > 0`, map sang shape sạch (`BitgetPosition`), tính `notionalUsd = size × markPrice` và `roePct = unrealizedPL / marginSize × 100`, sắp xếp theo giá trị vị thế giảm dần, cộng tổng ký quỹ và tổng uPnL.
3. Widget client `BitgetPositionsFeed` render 3 tile tổng hợp + bảng vị thế, và **tự làm mới mỗi 15 giây** qua `createApiClient().fetchBitgetPositions()` (dữ liệu authoritative: margin, realized PnL, vị thế mới/đã đóng); có nút "Làm mới" thủ công và mốc thời gian "đồng bộ … trước".
4. **Force-close (nút Đóng):** widget gọi `closeBitgetPosition(symbol, holdSide)` sau khi `window.confirm`. API `BitgetService.closePosition()` đọc size hiện tại (409 nếu đã đóng), rồi `POST /api/v2/mix/order/close-positions` (market, reduce-only). Thành công → auto-refresh bảng; lỗi → banner đỏ (đọc message từ body). Trong lúc đóng, mọi nút Đóng bị disable, nút của dòng đang xử lý hiện "…".
5. **Toggle value:** state `showValue` (khởi tạo từ `localStorage` trong `useEffect` để tránh lệch SSR); khi tắt, tile "Số dư tài khoản" chỉ ẩn **số USD** (`••••••`) — dòng % so với vốn gốc vẫn hiện — và cột PnL + tile PnL chỉ hiện %/ROE; khi bật hiện số USD. Tile tổng ký quỹ render thẳng `fmtUsdPlain(...)`, không phụ thuộc `showValue`.
8. **Đặt TP/SL (nút TP / SL):** widget mở `TpslDialog` với vị thế live (mark price cập nhật theo WS, kèm ước tính PnL/ROE nếu chạm mức). Bấm "Lưu lên sàn" → `setBitgetTpsl({ symbol, holdSide, takeProfitPrice, stopLossPrice })` → `POST /bitget/positions/tpsl` → `BitgetService.setTpsl()`:
   - Đọc lại vị thế (`single-position`); nếu đã flat → 409.
   - Làm tròn giá theo `pricePlace` của contract, kiểm tra chiều (long: TP > giá hiện tại, SL < giá hiện tại; short ngược lại) → 400 với message tiếng Việt nếu sai.
   - `place-pos-tpsl` với các mức được nhập (bỏ qua ô để trống).
   - **Dọn plan order thừa** (`cleanupTpslOrders`): đọc `orders-plan-pending?planType=profit_loss`, với mỗi loại `pos_profit`/`pos_loss` giữ lại order **mới nhất** (khi mức đó vẫn được đặt) và **huỷ phần còn lại** qua `cancel-plan-order`; nếu ô để trống thì huỷ hết loại đó. Thứ tự **đặt trước — dọn sau** nên vị thế không bao giờ bị hở bảo vệ giữa chừng.
   - Ghi log hệ thống vào nhật ký lệnh (tradeKey = `symbol-holdSide-openedAt`), rồi refresh bảng.
7. **Xem chart (icon cạnh symbol):** mỗi dòng có một nút icon (candlestick, không chữ) ngay sau badge LONG/SHORT. Bấm mở `SetupChartDialog` dùng chung (`apps/web/src/widgets/bitget/setup-chart-dialog.tsx`) — chart SonicR + S/R Channel + RSI render server-side qua `GET /bitget/setup-chart`, có switcher khung M30/H1/H4/D1 (mặc định H4), giống các tab khác. Read-only.
6. **Giá realtime (WebSocket public Bitget):** hook `useBitgetLivePrices` mở kết nối `wss://ws.bitget.com/v2/ws/public` ngay từ browser (không cần auth, WS không vướng CORS), subscribe channel `ticker` cho từng symbol đang mở. Mỗi tick, widget tính lại **markPrice → uPnL/ROE/notional** ngay trên client giữa hai lần REST refresh, cập nhật cả 3 tile tổng hợp. Ô "Giá hiện tại" nhấp nháy xanh/đỏ theo chiều giá; badge **LIVE** ở header báo trạng thái kết nối WS. uPnL client-side = `(markPrice − entryPrice) × size × (long ? 1 : −1)`, được sàn reconcile lại mỗi 15s.

## Edge Cases
- **Chưa cấu hình Bitget** → `configured: false`, trang hiện hướng dẫn thêm biến `.env` thay vì lỗi.
- **Không có vị thế nào** → hiện "Không có vị thế nào đang mở."
- **Lỗi gọi sàn** (mạng/chữ ký) → SSR nuốt lỗi và trả state rỗng; lần refresh phía client hiện banner đỏ "Không tải được vị thế…", không làm sập trang.
- **`liquidationPrice` âm/không hợp lệ** (thường gặp với margin cross khi không có mức thanh lý thực) → map thành `null`, hiển thị "—".
- **`marginSize = 0`** → `roePct` trả 0 thay vì chia cho 0.
- **Không lấy được equity / vốn gốc ≤ 0** → `equityChangePct` trả `null`, dòng % hiển thị "—" thay vì NaN.
- **SSR fallback** (`EMPTY_POSITIONS` khi API lỗi) đặt `initialCapitalUsd: 0` + `equityChangePct: null` nên tile hiện "—" cho tới lần refresh client đầu tiên.
- **Nạp/rút vốn** → hằng số vốn gốc KHÔNG tự đổi; phải sửa `INITIAL_CAPITAL_USD` (hoặc env `BITGET_INITIAL_CAPITAL_USD`) rồi restart `market-api`, nếu không % lệch.
- Bảng cuộn ngang trong khung riêng (`.bg-table-wrap` `overflow-x: auto`) để không tràn body trên mobile; tile xếp 1 cột dưới 720px.
- **WS rớt kết nối** → `onclose` tự reconnect sau 3s; badge chuyển "offline"; bảng vẫn hiện giá REST 15s nên không bao giờ trắng dữ liệu.
- **Không có vị thế** → hook không mở WS (mảng symbol rỗng), badge "offline".
- **Ping/pong:** gửi text `ping` mỗi 20s để sàn không đóng kết nối (timeout 30s idle).
- **Đóng khi đã flat** → API trả 409 "Vị thế đã đóng trên sàn"; banner hiện thông báo, bảng refresh bỏ dòng đó.
- **Chưa cấu hình credentials khi đóng** → API trả 503; nút Đóng vẫn hiện nhưng thao tác báo lỗi rõ.
- **Đóng thất bại (mạng/sàn)** → 503 với message từ sàn, không refresh nhầm; vị thế giữ nguyên trên bảng.
- **`showValue` khi SSR** → chỉ đọc `localStorage` trong `useEffect` (client), initial `false` nên không lệch hydrate (số dư ẩn mặc định).
- **TP/SL sai chiều** (long đặt TP dưới giá hiện tại…) → dialog chặn ngay ở client (hint đỏ + disable nút Lưu) và API vẫn kiểm tra lại → 400, tránh lỗi khó hiểu từ sàn.
- **Để trống ô TP hoặc SL** → mức đó bị **huỷ trên sàn** (không phải "giữ nguyên"); để trống cả hai = gỡ hết TP/SL.
- **Vị thế đóng khi dialog đang mở** → `tpslPosition` không còn trong danh sách → dialog tự đóng ở lần refresh kế; nếu bấm Lưu trước đó → API trả 409.
- **Đặt TP/SL khi sàn đã có sẵn mức (đặt từ app Bitget)** → dialog prefill mức cũ; sau khi đặt, `cleanupTpslOrders` đảm bảo chỉ còn **đúng 1 TP + 1 SL** cho mỗi hướng, dù sàn thay thế hay tạo thêm plan order mới.
- **Lỗi ở bước dọn plan order** → chỉ log `warn`, không fail request (mức mới đã live trên sàn); log ghi rõ có thể còn plan order thừa.
- **Vị thế được thêm volume sau khi đặt TP/SL** → TP/SL là mức của *vị thế* (đóng toàn bộ), nên vẫn áp dụng cho size mới; chỉ cần cân nhắc chỉnh lại giá vì giá vào trung bình đã đổi.

## Related Files (FE / BE / Worker)
- `apps/api/src/modules/bitget/bitget-trade.client.ts` — client Bitget dùng chung (ký v2): `getAllPositions()`, `getPosition()`, `getPositionSize()`, `closePosition()`, `getAccountBalance()`, `placePositionTpsl()`, `getPendingTpslOrders()`, `cancelPlanOrder()` + type `BitgetRawPosition` (kèm `takeProfit`/`stopLoss`), `BitgetPlanOrder`.
- `apps/api/src/modules/bitget/bitget.service.ts` — `BitgetService`: gọi client, map + tính notional/ROE + tổng hợp; `INITIAL_CAPITAL_USD` + `equityChangePct()` (% so với vốn gốc); `closePosition()` force-close market; `setTpsl()` + `cleanupTpslOrders()` + `writeSystemLog()`.
- `apps/api/src/modules/bitget/bitget.controller.ts` — `GET /bitget/positions`, `POST /bitget/positions/close`, `POST /bitget/positions/tpsl`.
- `apps/api/src/modules/bitget/dto/close-position.dto.ts` — validate `symbol` + `holdSide`.
- `apps/api/src/modules/bitget/dto/set-tpsl.dto.ts` — validate `symbol`, `holdSide`, `takeProfitPrice`/`stopLossPrice` (nullable = xoá mức).
- `apps/web/src/widgets/bitget-positions/tpsl-dialog.tsx` — dialog đặt TP/SL: prefill mức đang live, kiểm tra chiều theo giá hiện tại, ước tính PnL/ROE nếu chạm mức.
- `apps/api/src/modules/bitget/bitget.module.ts` — module, đăng ký trong `apps/api/src/app.module.ts`.
- `apps/web/src/widgets/bitget-positions/bitget-positions-feed.tsx` — bảng vị thế + nút icon xem chart cạnh symbol (mở `SetupChartDialog`); báo số vị thế đang mở lên nhãn tab qua `onCount` (hiện là "Vị thế đang mở (N)").
- `apps/web/src/widgets/bitget/chart-icon.tsx` — `ChartIcon` (icon nến monochrome) tách ra khỏi widget này 2026-07-27 để tab Setup và tab Lịch sử dùng lại y hệt.
- `apps/web/src/widgets/bitget/setup-chart-dialog.tsx` — dialog chart dùng chung (Setup tab + Vị thế đang mở): switcher khung M30/H1/H4/D1, fetch PNG từ `GET /bitget/setup-chart`.
- `apps/web/src/shared/api/types.ts` — type `BitgetPosition` (kèm `takeProfitPrice`/`stopLossPrice`), `BitgetPositionsResponse` (kèm `initialCapitalUsd`/`equityChangePct`), `BitgetTpslResult`.
- `apps/web/src/_pages/bitget-page/bitget-page.tsx` — `EMPTY_POSITIONS` fallback phải khớp shape (`initialCapitalUsd`, `equityChangePct`).
- `apps/web/src/shared/api/client.ts` — `fetchBitgetPositions()`, `closeBitgetPosition()`, `setBitgetTpsl()`.
- `apps/web/src/_pages/bitget-page/bitget-page.tsx` — server component gộp: fetch positions + history, chọn tab từ `?tab=`.
- `apps/web/src/widgets/bitget/bitget-tabs.tsx` — client: tab bar Vị thế / Lịch sử.
- `apps/web/src/widgets/bitget-positions/bitget-positions-feed.tsx` — widget client: bảng + tile + auto-refresh 15s + ghép giá live, tính lại uPnL/ROE/notional, badge LIVE, flash ô giá (prop `embedded`); nút Đóng force-close + toggle ẩn/hiện value PnL.
- `apps/web/src/widgets/bitget-positions/use-bitget-live-prices.ts` — hook WebSocket public Bitget (ticker) trả map giá realtime + trạng thái kết nối.
- `apps/web/src/app/bitget/page.tsx` — route re-export trang gộp.
- `apps/web/src/app/bitget-positions/page.tsx` — redirect `/bitget` (giữ bookmark cũ).
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — mục nav gộp "Bitget".
- `apps/web/src/app/globals.css` — style `.bg-*` + `.bg-tabs`/`.bg-tab`/`.bg-panel` + `.bg-table-toolbar`/`.bg-toggle-value`/`.bg-close-btn`/`.bg-tile-hidden`/`.bg-tpsl-*`.
