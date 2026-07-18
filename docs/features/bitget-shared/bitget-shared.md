## Description
Lớp **kết nối + hành động Bitget dùng chung**, tách ra khi gỡ bỏ 2 bot `day-trading` và `long-signal`. Mục đích: giữ lại toàn bộ code tích hợp Bitget (ký request, đặt/đóng lệnh, đọc market data, giá realtime) ở một nơi trung lập để **bot tương lai tái sử dụng**, không lệ thuộc vào chiến lược cụ thể nào.

## Main Flow
- **API (`apps/api/src/modules/bitget/`)** — `BitgetTradeClient` (`bitget-trade.client.ts`) là client Bitget v2 mix có ký HMAC, chỉ phụ thuộc `axios` + `node:crypto`. Cung cấp `getAllPositions()`, `getPositionSize()`, `closePosition()`. Đang được `BitgetService` dùng cho trang `/bitget` (đọc vị thế + force-close).
- **Worker (`apps/worker/src/modules/bitget/`)** — module chung `BitgetModule` gom 3 provider tái sử dụng:
  - `BitgetService` (`bitget.service.ts`) — REST public: klines / ticker.
  - `BitgetTradeService` (`bitget-trade.service.ts`) — v2 mix có ký: đặt lệnh (clientOid idempotent), đóng lệnh, set leverage; ném `BitgetApiError` mang mã lỗi sàn.
  - `BitgetWebSocketService` (`bitget-websocket.service.ts`) — WS public: giá ticker / candle realtime.
  - `retry.util.ts` — helper `withRetry` mà các service trên dùng.

## Edge Cases
- **Chưa wire vào `WorkerModule`**: `BitgetModule` (worker) **cố ý không** được import ở `worker.module.ts` — không có consumer nên để ngoài Nest graph, tránh mở WS idle khi boot. Bot tương lai chỉ cần `imports: [BitgetModule]` rồi inject service cần dùng.
- **Credentials đọc lazy**: `BitgetTradeService`/`BitgetTradeClient` đọc key từ env khi gọi, không throw lúc khởi tạo — process vẫn boot khi thiếu key (PAPER/không cấu hình).
- **`bitget-history` là riêng**: module `bitget-history` (mirror lịch sử lệnh đóng) tự ký độc lập, KHÔNG thuộc `BitgetModule` này.

## Related Files (FE / BE / Worker)
- `apps/api/src/modules/bitget/bitget-trade.client.ts` — client Bitget dùng chung (API).
- `apps/api/src/modules/bitget/bitget.service.ts` — dùng client cho positions + force-close.
- `apps/worker/src/modules/bitget/bitget.module.ts` — module chung (chưa wire, để tái dùng).
- `apps/worker/src/modules/bitget/bitget-trade.service.ts` — đặt/đóng lệnh + set leverage (LIVE).
- `apps/worker/src/modules/bitget/bitget.service.ts` — klines / ticker REST public.
- `apps/worker/src/modules/bitget/bitget-websocket.service.ts` — giá realtime qua WS public.
- `apps/worker/src/modules/bitget/retry.util.ts` — `withRetry`.
