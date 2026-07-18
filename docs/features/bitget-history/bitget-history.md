## Description
Tab **Lịch sử & PnL** trong trang gộp `/bitget` là **nhật ký lệnh đã đóng + realized PnL** của tài khoản Bitget USDT-M. Vì Bitget chỉ trả về lịch sử vị thế trong khoảng **~90 ngày gần nhất**, worker định kỳ **mirror** dữ liệu đó vào bảng `bitget_closed_positions` để có lịch sử vĩnh viễn (không mất khi quá 90 ngày) và thống kê tổng hợp: tổng PnL ròng, win rate, PnL trung bình/lệnh, lãi/lỗ lớn nhất.

**Mốc bắt đầu (history start):** thay vì backfill toàn bộ ~90 ngày, nhật ký chỉ **bắt đầu ghi từ ngày mở vị thế đang-live sớm nhất**. Lần sync đầu, worker đọc các vị thế đang mở, lấy `cTime` nhỏ nhất làm mốc, **lưu cố định** vào `bitget_sync_state.historyStartAt` và **xoá các row đóng trước mốc đó**. Từ đó về sau chỉ ghi thêm, không backfill lịch sử cũ hơn mốc.

Read-only: trang chỉ đọc DB, không đặt/đóng lệnh. Nguồn dữ liệu là `GET /api/v2/mix/position/history-position` (vị thế đã đóng, không phải từng fill).

## Main Flow
1. **Worker sync (nguồn ghi):** `BitgetHistoryService.sync()` chạy theo cron **mỗi 15 phút** (`SchedulerService.runBitgetHistorySync`) + một lần **catch-up khi worker khởi động** (`onModuleInit`, trễ 10s).
   - **Mốc bắt đầu:** `resolveHistoryStart()` đọc `historyStartAt` đã lưu; nếu chưa có, gọi `GET /api/v2/mix/position/all-position`, lấy `cTime` nhỏ nhất của vị thế đang mở làm mốc, lưu vào `bitget_sync_state` và `deleteClosedBefore(mốc)`. Nếu tài khoản đang flat (không có vị thế) → chưa neo được, tạm fallback `now − 90 ngày`.
   - Xác định cửa sổ: `floor = historyStart` (hoặc `now − 90 ngày` khi chưa neo); start = `max(floor, latestClosedAt − 1 ngày)` đến `now`.
   - Phân trang lùi theo `idLessThan` (limit 100/trang, tối đa 40 trang), ký HMAC-SHA256 bằng key tài khoản (self-contained, độc lập bot LIVE).
   - `normalizeBitgetClosed` (từ `@app/core`) map row thô → shape sạch, **lọc bỏ row đóng trước `floor`**; `repo.upsertMany` upsert theo `positionId` (idempotent, không trùng) trong một transaction.
2. **API đọc:** `GET /bitget/history?limit&symbol` → `BitgetService.getClosedHistory()` đọc `bitget_closed_positions` (mới đóng trước), tính `netProfitPct = netProfit ÷ notional vào`, và `summarizeBitgetClosed` (từ `@app/core`) cho khối thống kê. `configured` phản ánh có credentials Bitget hay không để trang giải thích khi rỗng.
3. **Web:** trang gộp `/bitget` (`BitgetPage`, server component) fetch song song positions + history rồi truyền vào `BitgetTabs`; tab **Lịch sử & PnL** render widget client `BitgetHistoryFeed` (chế độ `embedded`) — 6 tile thống kê + bảng lệnh, **tự làm mới mỗi 60s** (đọc DB, không gọi sàn) + nút "Làm mới". Vào `/bitget?tab=history` để mở thẳng tab này; route cũ `/bitget-history` redirect sang đây.

## Edge Cases
- **Chưa cấu hình Bitget** (thiếu key) → worker bỏ qua sync; API trả `configured: false`; trang hiện hướng dẫn thêm `.env` (chỉ khi chưa có lệnh nào).
- **Chưa có dữ liệu** (trước lần sync đầu) → trang báo "Worker sẽ tự kéo lịch sử ~90 ngày trong vài phút tới".
- **Neo mốc khi tài khoản flat** → không có vị thế đang mở nên không lấy được `cTime`; `historyStartAt` để trống, tạm fallback 90 ngày cho tới khi có vị thế mở để neo. Khi đã neo thì cố định, không đổi dù về sau mở/đóng thêm lệnh (nhật ký chỉ lớn dần, không bị cắt).
- **Đọc vị thế mở lỗi** khi neo → `resolveHistoryStart` log warn và bỏ qua neo lần này (fallback 90 ngày), thử lại lần sync sau.
- **Sync chồng nhau** → cờ `syncing` chặn, cron kế tiếp bỏ qua nếu lần trước chưa xong.
- **Row nửa vời** (thiếu `positionId`/`utime`) → `normalizeBitgetClosed` trả `null`, bị lọc bỏ, không ghi.
- **Trade settle trễ** (funding/phí cập nhật sau khi đóng) → cửa sổ sync lùi lại 1 ngày quá watermark nên upsert refresh lại thay vì bỏ sót.
- **Quá 90 ngày không đồng bộ** → chỉ mất các lệnh đóng-rồi-đóng trong khoảng gián đoạn > 90 ngày; cron 15 phút + catch-up khi boot khiến kịch bản này gần như không xảy ra.
- **PnL %:** tính trên **notional lúc vào** (`openAvgPrice × size`), không phải trên ký quỹ — endpoint history không trả margin/leverage ổn định.

## Related Files (FE / BE / Worker)
- `packages/db/prisma/schema.prisma` — model `BitgetClosedPosition` (`bitget_closed_positions`) + `BitgetSyncState` (`bitget_sync_state`, mốc `historyStartAt`).
- `packages/db/prisma/migrations/20260718031611_add_bitget_closed_positions/migration.sql` — migration tạo bảng lịch sử.
- `packages/db/prisma/migrations/20260718120000_add_bitget_sync_state/migration.sql` — migration tạo bảng mốc sync.
- `packages/db/src/repositories/bitget-closed-position.repository.ts` — `upsertMany` / `findRecent` / `latestClosedAt` / `deleteClosedBefore`.
- `packages/db/src/repositories/bitget-sync-state.repository.ts` — `getHistoryStartAt` / `setHistoryStartAt`.
- `packages/core/src/analysis/bitget-closed.ts` — `normalizeBitgetClosed`, `summarizeBitgetClosed` + types dùng chung.
- `apps/worker/src/modules/bitget-history/bitget-history.service.ts` — sync ký + phân trang + upsert; cron + boot catch-up.
- `apps/worker/src/modules/bitget-history/bitget-history.module.ts` — module worker.
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — cron `runBitgetHistorySync` (`*/15 * * * *`).
- `apps/worker/src/modules/scheduler/scheduler.module.ts` — import `BitgetHistoryModule`.
- `apps/api/src/modules/bitget/bitget.service.ts` — `getClosedHistory()` + types kết quả.
- `apps/api/src/modules/bitget/bitget.controller.ts` — `GET /bitget/history`.
- `apps/web/src/shared/api/types.ts` — `BitgetClosedTrade`, `BitgetClosedSummary`, `BitgetHistoryResponse`.
- `apps/web/src/shared/api/client.ts` — `fetchBitgetHistory()`.
- `apps/web/src/_pages/bitget-page/bitget-page.tsx` — server component gộp: fetch positions + history, chọn tab từ `?tab=`.
- `apps/web/src/widgets/bitget/bitget-tabs.tsx` — client: tab bar Vị thế / Lịch sử.
- `apps/web/src/app/bitget/page.tsx` — route re-export trang gộp.
- `apps/web/src/app/bitget-history/page.tsx` — redirect `/bitget?tab=history` (giữ bookmark cũ).
- `apps/web/src/widgets/bitget-history/bitget-history-feed.tsx` — widget: tile thống kê + bảng + auto-refresh 60s (prop `embedded`).
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — mục nav gộp "Bitget".
- `apps/web/src/app/globals.css` — thêm `.bg-tabs`, `.bg-tab`, `.bg-panel`; sẵn `.bg-tile-sub`, `.bg-time` (tái dùng `.bg-*`).
