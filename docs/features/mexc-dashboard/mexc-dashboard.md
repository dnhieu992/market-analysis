## Description
Trang `/mexc` — bản sao độc lập của `/bitget` cho sàn **MEXC USDT futures**. Cùng 3 tab (Vị thế đang mở · Lịch sử & PnL · Setup), cùng nhật ký lệnh, chart và TP/SL, nhưng chạy trên **bảng DB riêng, module API riêng, worker sync riêng**.

Tách rời hoàn toàn là chủ ý: `/bitget` đang chạy live, nên một thay đổi ở tích hợp MEXC không được phép làm hỏng nó (và ngược lại). Thứ duy nhất dùng chung là `setup-chart-renderer.ts` — bộ vẽ chart thuần Binance, không dính gì tới sàn.

**Khác biệt so với Bitget (do MEXC trả dữ liệu khác):**
| Mục | Bitget | MEXC |
|---|---|---|
| Ký request | HMAC base64, có passphrase | HMAC **hex**, `ApiKey`/`Request-Time`/`Signature`, **không** passphrase |
| Symbol | `BTCUSDT` | `BTC_USDT` (đổi ở biên client) |
| Size | base asset | **số hợp đồng** (× `contractSize` → base asset) |
| Mark price | có trong position | **không có** → lấy `fairPrice` từ ticker công khai |
| Giá hoà vốn | có | không có → cột hiện `—` |
| TP/SL | nằm trong position | phải đọc từ `stoporder/open_orders` |
| Phí đóng lệnh | tách open/close | chỉ có `totalFee` gộp → dồn hết vào `closeFee` |
| Cột đổi giá | "Hôm nay" (mốc 00:00 UTC) | **"24h"** (`riseFallRate`, không có mốc UTC) |
| Đóng lệnh | endpoint `close-positions` | lệnh market ngược chiều kèm `positionId` |

## Main Flow
1. **SSR** — `/mexc` gọi `fetchMexcPositions()` + `fetchMexcHistory({limit:200})`; lỗi thì rơi về snapshot rỗng để trang vẫn render.
2. **Tab Vị thế** — `MexcPositionsFeed` refresh REST mỗi 15s, xen giữa là giá realtime từ WS công khai `wss://contract.mexc.com/edge` (`sub.ticker` từng symbol, ping JSON 20s). uPnL/ROE/notional được tính lại client-side theo giá live. Tile **PnL chưa thực hiện** giống hệt Bitget: dòng USD (ẩn theo toggle value) + dòng **% luôn hiện**, tính trên **vốn + PnL đã chốt** = `accountEquity − uPnL của snapshot` — xem [bitget-positions](../bitget-positions/bitget-positions.md).
3. **Đóng lệnh** — `POST /mexc/positions/close` → đọc vị thế, lấy giá market, gửi `order/create` chiều đóng (`side` 4 = close long / 2 = close short) với `positionId` và toàn bộ `holdVol`.
4. **TP/SL** — `POST /mexc/positions/tpsl` → validate hướng giá, rồi tuỳ trạng thái hiện tại: chưa có lệnh TP/SL → `stoporder/place` (trigger theo **Fair Price**, đóng toàn bộ vị thế); đã có → **sửa giá ngay trên lệnh đang live** (`stoporder/change_price`, fallback `change_plan_price`); xoá cả hai chiều → chỉ huỷ lệnh cũ. Ghi 1 log `system` vào nhật ký lệnh.
5. **Mở lệnh (tab Setup)** — `POST /mexc/positions/open` → `vol = margin × leverage ÷ giá ÷ contractSize`, làm tròn xuống theo `volScale`; đặt đòn bẩy khi đang flat, rồi `order/create` market cross. Bảng Setup có **cả hai cột LONG và SHORT**, mỗi hướng một nút mở lệnh và một cấu hình (đòn bẩy / margin) riêng.
6. **Worker sync** — `MexcHistoryService` chạy mỗi 15s: vị thế mới → insert `status=open` + log "Đã mở lệnh"; vị thế đóng (`state=3`) → flip sang `closed` + log "Đã đóng lệnh". Mốc ROE (+50…+200 / −50…−500) ghi mỗi phút, ratchet 1 chiều như Bitget.
7. **Thêm coin theo dõi (tab Setup)** — nút **+ Thêm coin** mở dialog: gõ mã (không cần đuôi `USDT`, hệ thống tự thêm) → `POST /mexc/setup/watchlist` kiểm tra mã có hợp đồng futures trên MEXC (`contract/detail`, public) rồi lưu vào `mexc_watchlist_symbols`. Dialog liệt kê các coin đã thêm thủ công kèm nút ✕ để bỏ theo dõi. Danh sách coin của bảng = pin (BTC/ETH) + watchlist hardcode + coin thêm tay + mọi coin đã từng giao dịch, dedupe.
8. **Chart / nhật ký / sao ưu tiên** — giống hệt Bitget, chỉ khác bảng DB (`mexc_*`) và route (`/mexc/*`).

## Edge Cases
- **Chưa cấu hình key** (`MEXC_API_KEY`/`MEXC_API_SECRET` trống): `configured: false`, trang hiện hướng dẫn thêm env thay vì bảng rỗng khó hiểu. Worker sync tự bỏ qua, không log lỗi.
- **MEXC chặn API trading**: sàn đóng endpoint đặt lệnh từ 2022-07-25 và mở lại 2026-03-31; ngoài ra tài khoản phải KYC mới bật được quyền "Order Placing". Nếu key thiếu quyền, lệnh mở/đóng trả 503 kèm nguyên văn mã lỗi MEXC. Phần đọc (vị thế, lịch sử, nhật ký, chart) không bị ảnh hưởng.
- **Thêm coin không tồn tại**: `contract/detail` không có mã → 400 "MEXC không có hợp đồng futures cho X", không ghi DB. Thêm lại coin đã có = no-op (upsert), không lỗi trùng unique.
- **Bỏ theo dõi coin không phải thêm tay**: chỉ xoá được row trong `mexc_watchlist_symbols`; coin từ danh sách hardcode hoặc từ lịch sử giao dịch vẫn hiện trong bảng và không có nút ✕.
- **Coin mới list, chưa đủ lịch sử**: cột 90 ngày cần ≥ 91 nến ngày; thiếu thì ô hiện "—" thay vì một con số sai (7d/30d vẫn hiện bình thường).
- **`apiAllowed: false`** trên contract → chặn ngay ở `openPosition` với thông báo tiếng Việt, không tốn round-trip.
- **`externalOid` tối đa 32 ký tự**: vượt quá thì MEXC trả lỗi 2030 và từ chối *mọi* lệnh mở. `buildExternalOid()` ghép side + timestamp base36 + hậu tố ngẫu nhiên (độ dài cố định) rồi cắt symbol theo phần còn lại, nên ID luôn ≤ 32 ký tự kể cả với symbol dài như `1000PEPEUSDT`.
- **Ticker lỗi** → vị thế rơi về giá vào làm mark price, PnL hiện 0 thay vì một số sai. Balance/TP-SL lỗi cũng non-fatal, bảng vẫn render.
- **`contractSize` lookup lỗi** → fallback 1 (coi như đã là base asset); size ghi vào DB sai thang nhưng lệnh vẫn được ghi nhận, không mất dấu.
- **Vị thế đóng một phần**: history chỉ nhận `state = 3` (đóng hẳn); size lấy `closeVol` vì `holdVol` đã về 0.
- **Đóng/mở giữa 2 lần poll**: insert thẳng `status=closed` kèm cả log mở lẫn log đóng.
- **Trùng nhịp sync**: cờ `syncing` chặn chạy chồng; `positionId` unique nên close là idempotent.
- **Cập nhật TP/SL khi đã có lệnh**: MEXC chỉ cho **1 lệnh TP/SL trên mỗi vị thế**, `stoporder/place` lần 2 bị từ chối với lỗi `5005 "there is already a position TP/SL order"`. Vì vậy update = sửa giá trên lệnh cũ (vị thế không có khoảng trống không bảo vệ), không phải đặt thêm lệnh mới.
- **Fallback khi không sửa được tại chỗ**: xoá hẳn 1 chiều TP hoặc SL (endpoint sửa giá chỉ set được giá, không xoá được), có >1 lệnh live, hoặc call sửa lỗi → huỷ lệnh cũ rồi place lại. MEXC giải phóng slot TP/SL bất đồng bộ nên nếu place vẫn dính 5005 thì chờ 800ms và thử lại 1 lần.
- **Mốc ROE khi thiếu `unRealizedPnl`**: bỏ qua vị thế đó thay vì đoán — thà thiếu log còn hơn log sai.

## Related Files (FE / BE / Worker)
**Web**
- `apps/web/src/app/mexc/page.tsx` — route `/mexc` (re-export mỏng).
- `apps/web/src/_pages/mexc-page/mexc-page.tsx` — Server Component, SSR 2 nguồn dữ liệu.
- `apps/web/src/widgets/mexc/mexc-tabs.tsx` — khung 3 tab + đếm số dòng.
- `apps/web/src/widgets/mexc/mexc-setup-feed.tsx` — tab Setup (mở lệnh, sao ưu tiên, QQE, 24h/7d/30d/90d).
- `apps/web/src/widgets/mexc/{setup-chart-dialog,bulk-setup-dialog,add-coin-dialog,chart-note-dialog,qqe-cell,star-rating,symbol-filter-input,chart-icon}.tsx` — UI phụ trợ của tab Setup (`symbol-filter-input` = ô lọc coin free text, dùng chung với tab Lịch sử).
- `apps/web/src/widgets/mexc-positions/mexc-positions-feed.tsx` — bảng vị thế đang mở.
- `apps/web/src/widgets/mexc-positions/{tpsl-dialog,mexc-journal-drawer}.tsx` — dialog TP/SL + drawer nhật ký.
- `apps/web/src/widgets/mexc-positions/use-mexc-live-prices.ts` — WS giá realtime MEXC.
- `apps/web/src/widgets/mexc-history/mexc-history-feed.tsx` — tab Lịch sử & PnL.
- `apps/web/src/shared/api/types.ts` — khối type `Mexc*`.
- `apps/web/src/shared/api/client.ts` — khối method `*Mexc*` gọi `/mexc/*`.
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — mục "MEXC" ngay dưới "Bitget".

**API**
- `apps/api/src/modules/mexc/mexc-trade.client.ts` — client MEXC có ký (ký, đổi symbol, đổi contracts↔base, đọc/đặt/huỷ lệnh + TP/SL).
- `apps/api/src/modules/mexc/mexc.service.ts` — vị thế, lịch sử, mở/đóng lệnh, TP/SL, log `system`.
- `apps/api/src/modules/mexc/mexc-setup.service.ts` — cấu hình đòn bẩy/ký quỹ + sao ưu tiên + watchlist thủ công (`GET/POST/DELETE /mexc/setup/watchlist`).
- `apps/api/src/modules/mexc/mexc-setup-chart.service.ts` — chart Setup/trade, QQE, đổi giá; **dùng lại** `../bitget/setup-chart-renderer`.
- `apps/api/src/modules/mexc/mexc-journal.service.ts` — nhật ký từng lệnh.
- `apps/api/src/modules/mexc/mexc.controller.ts` + `dto/` — route `/mexc/*`.
- `apps/api/src/app.module.ts` — đăng ký `MexcModule`.

**Worker**
- `apps/worker/src/modules/mexc-history/mexc-history.service.ts` — sync vị thế/lịch sử + mốc ROE (tự ký, độc lập).
- `apps/worker/src/modules/mexc-history/mexc-history.module.ts`
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — cron 15s (`runMexcHistorySync`) + 1 phút (`runMexcMilestoneSync`).

**Shared**
- `packages/core/src/analysis/mexc-closed.ts` — chuẩn hoá row lịch sử MEXC; `summarizeMexcClosed` dùng lại phép tính chung.
- `packages/db/prisma/schema.prisma` — `MexcTrade`, `MexcSyncState`, `MexcTradeJournal`, `MexcSetupConfig`, `MexcSymbolPriority`, `MexcTradeChart`, `MexcWatchlistSymbol`.
- `packages/db/prisma/migrations/20260728120000_add_mexc_tables/migration.sql`
- `packages/db/prisma/migrations/20260729150000_add_mexc_watchlist_symbols/migration.sql`
- `packages/db/src/repositories/mexc-*.repository.ts`
- `packages/db/src/repositories/asset.repository.ts` — `balanceByKey('mexc')`: vốn gốc của MEXC lấy từ số dư danh mục `mexc` trên [/my-asset](../my-asset/my-asset.md) (tổng vào − tổng ra), nên nó tự cập nhật khi nạp/chuyển vốn. `MEXC_INITIAL_CAPITAL_USD` chỉ còn là fallback khi danh mục `mexc` bị xoá.
- `.env.example` — `MEXC_API_KEY`, `MEXC_API_SECRET`, `MEXC_API_BASE_URL`, `MEXC_INITIAL_CAPITAL_USD` (fallback).
