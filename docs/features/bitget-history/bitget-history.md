## Description
Trang `/bitget-history` là **nhật ký lệnh đã đóng + realized PnL** của tài khoản Bitget USDT-M. Vì Bitget chỉ trả về lịch sử vị thế trong khoảng **~90 ngày gần nhất**, worker định kỳ **mirror** dữ liệu đó vào bảng `bitget_closed_positions` để có lịch sử vĩnh viễn (không mất khi quá 90 ngày) và thống kê tổng hợp: tổng PnL ròng, win rate, PnL trung bình/lệnh, lãi/lỗ lớn nhất.

Read-only: trang chỉ đọc DB, không đặt/đóng lệnh. Nguồn dữ liệu là `GET /api/v2/mix/position/history-position` (vị thế đã đóng, không phải từng fill).

## Main Flow
1. **Worker sync (nguồn ghi):** `BitgetHistoryService.sync()` chạy theo cron **mỗi 15 phút** (`SchedulerService.runBitgetHistorySync`) + một lần **catch-up khi worker khởi động** (`onModuleInit`, trễ 10s).
   - Xác định cửa sổ: từ `latestClosedAt − 1 ngày` (hoặc `now − 90 ngày` ở lần đầu) đến `now`.
   - Phân trang lùi theo `idLessThan` (limit 100/trang, tối đa 40 trang), ký HMAC-SHA256 bằng key tài khoản (self-contained, độc lập bot LIVE).
   - `normalizeBitgetClosed` (từ `@app/core`) map row thô → shape sạch; `repo.upsertMany` upsert theo `positionId` (idempotent, không trùng) trong một transaction.
2. **API đọc:** `GET /bitget/history?limit&symbol` → `BitgetService.getClosedHistory()` đọc `bitget_closed_positions` (mới đóng trước), tính `netProfitPct = netProfit ÷ notional vào`, và `summarizeBitgetClosed` (từ `@app/core`) cho khối thống kê. `configured` phản ánh có credentials Bitget hay không để trang giải thích khi rỗng.
3. **Web:** server component `BitgetHistoryPage` gọi `fetchBitgetHistory({ limit: 200 })` khi render; widget client `BitgetHistoryFeed` render 6 tile thống kê + bảng lệnh, **tự làm mới mỗi 60s** (đọc DB, không gọi sàn) + nút "Làm mới".

## Edge Cases
- **Chưa cấu hình Bitget** (thiếu key) → worker bỏ qua sync; API trả `configured: false`; trang hiện hướng dẫn thêm `.env` (chỉ khi chưa có lệnh nào).
- **Chưa có dữ liệu** (trước lần sync đầu) → trang báo "Worker sẽ tự kéo lịch sử ~90 ngày trong vài phút tới".
- **Sync chồng nhau** → cờ `syncing` chặn, cron kế tiếp bỏ qua nếu lần trước chưa xong.
- **Row nửa vời** (thiếu `positionId`/`utime`) → `normalizeBitgetClosed` trả `null`, bị lọc bỏ, không ghi.
- **Trade settle trễ** (funding/phí cập nhật sau khi đóng) → cửa sổ sync lùi lại 1 ngày quá watermark nên upsert refresh lại thay vì bỏ sót.
- **Quá 90 ngày không đồng bộ** → chỉ mất các lệnh đóng-rồi-đóng trong khoảng gián đoạn > 90 ngày; cron 15 phút + catch-up khi boot khiến kịch bản này gần như không xảy ra.
- **PnL %:** tính trên **notional lúc vào** (`openAvgPrice × size`), không phải trên ký quỹ — endpoint history không trả margin/leverage ổn định.

## Related Files (FE / BE / Worker)
- `packages/db/prisma/schema.prisma` — model `BitgetClosedPosition` (`bitget_closed_positions`).
- `packages/db/prisma/migrations/20260718031611_add_bitget_closed_positions/migration.sql` — migration tạo bảng.
- `packages/db/src/repositories/bitget-closed-position.repository.ts` — `upsertMany` / `findRecent` / `latestClosedAt`.
- `packages/core/src/analysis/bitget-closed.ts` — `normalizeBitgetClosed`, `summarizeBitgetClosed` + types dùng chung.
- `apps/worker/src/modules/bitget-history/bitget-history.service.ts` — sync ký + phân trang + upsert; cron + boot catch-up.
- `apps/worker/src/modules/bitget-history/bitget-history.module.ts` — module worker.
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — cron `runBitgetHistorySync` (`*/15 * * * *`).
- `apps/worker/src/modules/scheduler/scheduler.module.ts` — import `BitgetHistoryModule`.
- `apps/api/src/modules/bitget/bitget.service.ts` — `getClosedHistory()` + types kết quả.
- `apps/api/src/modules/bitget/bitget.controller.ts` — `GET /bitget/history`.
- `apps/web/src/shared/api/types.ts` — `BitgetClosedTrade`, `BitgetClosedSummary`, `BitgetHistoryResponse`.
- `apps/web/src/shared/api/client.ts` — `fetchBitgetHistory()`.
- `apps/web/src/_pages/bitget-history-page/bitget-history-page.tsx` — server component.
- `apps/web/src/app/bitget-history/page.tsx` — route re-export.
- `apps/web/src/widgets/bitget-history/bitget-history-feed.tsx` — widget: tile thống kê + bảng + auto-refresh 60s.
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — mục nav "Bitget History".
- `apps/web/src/app/globals.css` — thêm `.bg-tile-sub`, `.bg-time` (tái dùng `.bg-*`).
