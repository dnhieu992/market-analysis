## Description
_Đặt **lệnh limit** (lệnh chờ mở vị thế) trên Bitget USDT futures từ trang `/bitget`._

Bổ sung bên cạnh lệnh **market** đang có: mỗi coin × hướng ở tab **Setup** giờ có 2 nút **Market** (mở/thêm ngay theo giá thị trường như cũ) và **Limit** (mở hộp thoại đặt lệnh chờ tại giá tự chọn). Lệnh limit nằm ở dạng lệnh chờ trên sàn cho tới khi giá chạm mức rồi mới khớp thành vị thế; trong lúc chờ nó hiện ở bảng **“Lệnh chờ (limit)”** trên tab **Vị thế đang mở**, kèm nút **Huỷ**.

## Main Flow
1. **Setup tab** (`bitget-setup-feed`): trong cột **Long**/**Short** của mỗi coin có 2 nút — **Market** (`openBitgetPosition`, giữ nguyên hành vi cũ: chưa mở → mở mới, đã mở → `+ Market` thêm volume) và **Limit**.
2. Bấm **Limit** → mở `LimitOrderDialog`: prefill **đòn bẩy/ký quỹ** từ cấu hình đã lưu của coin+hướng (vẫn sửa được), ô **Giá limit** prefill giá hiện tại (WS) kèm hàng mốc nhanh **1/2/3/5/7/10%** — LONG lệch **xuống** (`−%`, mua thấp hơn), SHORT lệch **lên** (`+%`, bán cao hơn). Ước tính size ≈ `ký quỹ × đòn bẩy ÷ giá limit`.
3. Bấm **Đặt lệnh chờ** → `POST /bitget/positions/limit` → `BitgetService.placeLimitOrder`:
   - Kiểm tra vị thế hiện có của hướng đó: **đang mở** → dùng đòn bẩy của vị thế (Bitget từ chối đổi đòn bẩy khi đang có lệnh); **flat** → `setCrossLeverage` trước.
   - Làm tròn giá theo `pricePlace`, tính `size = ký quỹ × đòn bẩy ÷ giá` (floor theo `volumePlace`), chặn nếu `< minTradeNum`.
   - `BitgetTradeClient.placeLimitOrder` → `POST /api/v2/mix/order/place-order` với `orderType: 'limit'`, `price`, `force: 'gtc'`, cross, `tradeSide: 'open'` (hedge mode).
4. **Positions tab** (`bitget-positions-feed`): mỗi 15s (và ngay khi mở) gọi `GET /bitget/positions/pending` → `listPendingLimitOrders` (lọc `orderType === 'limit'`). Bảng **“Lệnh chờ (limit)”** hiện giữa các tile và bảng vị thế, **chỉ khi có lệnh chờ**: Symbol · Hướng · Giá limit · **Khoảng cách** (so với giá WS realtime) · Đòn bẩy · Size · Giá trị · Đặt lúc · **Huỷ**.
5. Bấm **Huỷ** (có xác nhận) → `POST /bitget/positions/cancel-order` → `cancelLimitOrder` → `cancel-order`, rồi refetch danh sách chờ.

## Edge Cases
- **Giá limit sai chiều** (LONG ≥ giá hiện tại, hoặc SHORT ≤ giá hiện tại): dialog hiện hint vàng "có thể khớp ngay như lệnh market" nhưng **không chặn** — Bitget vẫn nhận (khớp taker ngay).
- **Gõ tay vào ô giá** → bỏ tô sáng mốc % (`pricePct = null`); mốc chỉ tô khi bấm nút.
- **Ký quỹ quá nhỏ** → size < `minTradeNum` → API trả 400 với thông báo tiếng Việt, dialog hiện lỗi, không gửi lên sàn.
- **Chưa cấu hình coin+hướng** → nút Limit vẫn bấm được; dialog để đòn bẩy mặc định 10 và ô ký quỹ trống để nhập tay.
- **Đặt limit khi đã có vị thế cùng hướng** → dùng đòn bẩy của vị thế đang mở, không set lại; khi khớp sẽ gộp volume vào vị thế đó.
- **Chưa cấu hình API key** → `GET /positions/pending` trả `configured: false` + list rỗng → panel tự ẩn (không lỗi).
- **Lỗi đọc danh sách chờ** → giữ nguyên list cũ (non-fatal), không làm trắng trang.
- **Coin có lệnh chờ nhưng không có vị thế mở** → symbol đó vẫn được subscribe WS để tính "Khoảng cách"; panel hiện kể cả khi không có vị thế nào đang mở.

## Related Files (FE / BE / Worker)
- `apps/web/src/widgets/bitget/limit-order-dialog.tsx` — hộp thoại đặt lệnh limit (mốc % giá, ước tính size/giá trị).
- `apps/web/src/widgets/bitget/bitget-setup-feed.tsx` — 2 nút Market/Limit trong cột Long/Short + handler `placeLimit`.
- `apps/web/src/widgets/bitget-positions/bitget-positions-feed.tsx` — panel "Lệnh chờ (limit)" + poll `refreshPending` + `cancelPending`.
- `apps/web/src/shared/api/client.ts` — `placeBitgetLimitOrder`, `fetchBitgetPendingOrders`, `cancelBitgetOrder`.
- `apps/web/src/shared/api/types.ts` — `BitgetLimitResult`, `BitgetPendingOrder`, `BitgetPendingOrdersResponse`.
- `apps/web/src/app/globals.css` — `.bg-limit-btn*`, `.bg-limit-row`, `.bg-pending*`, `.bg-cancel-btn`.
- `apps/api/src/modules/bitget/bitget.controller.ts` — `POST /positions/limit`, `GET /positions/pending`, `POST /positions/cancel-order`.
- `apps/api/src/modules/bitget/bitget.service.ts` — `placeLimitOrder`, `listPendingLimitOrders`, `cancelLimitOrder`, `mapPendingOrder`.
- `apps/api/src/modules/bitget/bitget-trade.client.ts` — `placeLimitOrder`, `getPendingOrders`, `cancelOrder`, type `BitgetPendingOrder`.
- `apps/api/src/modules/bitget/dto/{place-limit,cancel-order}.dto.ts` — DTO validate.
