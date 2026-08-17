## Description
Trang `/okx` — bản sao độc lập của `/bitget` (và của `/mexc`) cho sàn **OKX USDT perpetual swaps**. Cùng 3 tab (Vị thế đang mở · Lịch sử & PnL · Setup), cùng nhật ký lệnh, chart và TP/SL, nhưng chạy trên **bảng DB riêng, module API riêng, worker sync riêng**.

Tách rời hoàn toàn là chủ ý: `/bitget` và `/mexc` đang chạy, nên một thay đổi ở tích hợp OKX không được phép làm hỏng chúng (và ngược lại). Thứ duy nhất dùng chung là `setup-chart-renderer.ts` — bộ vẽ chart thuần Binance, không dính gì tới sàn.

**Khác biệt so với Bitget/MEXC (do OKX trả dữ liệu khác):**
| Mục | Bitget | MEXC | OKX |
|---|---|---|---|
| Ký request | HMAC base64, có passphrase | HMAC hex, không passphrase | HMAC **base64** của `timestamp + METHOD + requestPath + body`, timestamp **ISO-8601 có mili giây** (không phải epoch), **có** passphrase |
| Symbol | `BTCUSDT` | `BTC_USDT` | `BTC-USDT-SWAP` (đổi ở biên client) |
| Size | base asset | số hợp đồng (`contractSize`) | **số hợp đồng** (× `ctVal` → base asset) |
| Mark price | có trong position | không có | **có** trong position (`markPx`) → không cần call thêm |
| Giá hoà vốn | có | không có → cột hiện `—` | **có** (`bePx`) |
| TP/SL | nằm trong position | đọc từ `stoporder/open_orders` | là **algo order** (`/trade/order-algo`), đọc từ `orders-algo-pending`, **không mang position id** → ghép theo `(instId, posSide)` |
| Phí đóng lệnh | tách open/close | chỉ có `totalFee` gộp | chỉ có `fee` gộp (âm) → dồn hết vào `closeFee` |
| Cột đổi giá | "Hôm nay" (00:00 UTC) | "24h" | **"Hôm nay"** (`sodUtc0` trong ticker) |
| Đóng lệnh | endpoint `close-positions` | lệnh market ngược chiều | endpoint `/trade/close-position` (không cần size/giá) |
| Chế độ vị thế | — | — | **net_mode** (một vị thế ròng, `posSide = "net"`, `pos` có dấu) hoặc **long_short_mode** (long/short tách riêng). Cả hai đều được hỗ trợ; chế độ đọc 1 lần từ `/account/config` rồi cache |

## Main Flow
1. **SSR** — `/okx` gọi `fetchOkxPositions()` + `fetchOkxHistory({limit:200})`; lỗi thì rơi về snapshot rỗng để trang vẫn render.
2. **Tab Vị thế** — `OkxPositionsFeed` refresh REST mỗi 15s, xen giữa là giá realtime từ WS công khai `wss://ws.okx.com:8443/ws/v5/public` (kênh `tickers`, subscribe gộp 1 message, ping chuỗi `ping` mỗi 20s). uPnL/ROE/notional được tính lại client-side theo giá live.
3. **Đóng lệnh** — `POST /okx/positions/close` → đọc vị thế, rồi gọi `/api/v5/trade/close-position` với `mgnMode` + `posSide` (bỏ `posSide` khi tài khoản ở net mode) và `autoCxl: true` để lệnh chờ trên instrument không chặn việc đóng.
4. **TP/SL** — `POST /okx/positions/tpsl` → validate hướng giá, rồi tuỳ trạng thái: chưa có algo order → `/trade/order-algo` với `closeFraction: "1"` (đóng **toàn bộ** vị thế, kể cả phần thêm sau này), `ordType` = `oco` khi đặt cả TP lẫn SL và `conditional` khi chỉ một chiều, trigger theo **Mark Price**; đã có → **sửa giá ngay trên order đang live** (`/trade/amend-algos`); xoá cả hai chiều → chỉ huỷ (`/trade/cancel-algos`). Ghi 1 log `system` vào nhật ký lệnh.
5. **Mở lệnh (tab Setup)** — `POST /okx/positions/open` → `sz = margin × leverage ÷ giá ÷ ctVal`, làm tròn xuống theo bội số `lotSz`; đặt đòn bẩy khi đang flat, rồi `/trade/order` market cross. Bảng Setup có **cả hai cột LONG và SHORT**, mỗi hướng một nút mở lệnh và một cấu hình (đòn bẩy / margin) riêng.
6. **Worker sync** — `OkxHistoryService` chạy mỗi 15s: vị thế mới → insert `status=open` + log "Đã mở lệnh"; vị thế đóng (có `closeAvgPx`/`closeTotalPos`) → flip sang `closed` + log "Đã đóng lệnh". Mốc ROE (+50…+200 / −50…−500) ghi mỗi phút, ratchet 1 chiều như Bitget.
7. **Thêm coin theo dõi (tab Setup)** — nút **+ Thêm coin** mở dialog: gõ mã (không cần đuôi `USDT`) → `POST /okx/setup/watchlist` kiểm tra mã có instrument SWAP trên OKX (`/public/instruments`, public) rồi lưu vào `okx_watchlist_symbols`. Dialog liệt kê các coin đã thêm thủ công kèm nút ✕ để bỏ theo dõi. Danh sách coin của bảng = pin (BTC/ETH) + watchlist hardcode + coin thêm tay + mọi coin đã từng giao dịch, dedupe.
8. **Chart / nhật ký / sao ưu tiên** — giống hệt Bitget, chỉ khác bảng DB (`okx_*`) và route (`/okx/*`).

## Edge Cases
- **Chưa cấu hình key** (`OKX_API_KEY` / `OKX_API_SECRET` / `OKX_API_PASSPHRASE` — cần **cả ba**): `configured: false`, trang hiện hướng dẫn thêm env thay vì bảng rỗng khó hiểu. Worker sync tự bỏ qua, không log lỗi.
- **Demo trading**: `OKX_SIMULATED=true` gắn header `x-simulated-trading: 1` vào mọi request. Giá trị này **phải giống nhau giữa API và worker**, nếu không trang đọc tài khoản thật còn nhật ký lệnh lại ghi từ tài khoản demo (hoặc ngược lại).
- **Net mode vs long/short mode**: ở net mode OKX chỉ trả **một** vị thế ròng cho mỗi instrument (`posSide = "net"`, `pos` âm = short) — nên tab Setup vẫn có 2 nút LONG/SHORT nhưng mở chiều ngược lại sẽ **giảm/đảo** vị thế đang có thay vì mở thêm một vị thế mới. Muốn giữ long và short cùng lúc thì bật long/short mode trong cài đặt OKX; app tự nhận ra qua `/account/config` (cache theo vòng đời process, đổi mode cần restart).
- **Thêm coin không tồn tại**: `/public/instruments` không có mã → 400 "OKX không có hợp đồng futures cho X", không ghi DB. Thêm lại coin đã có = no-op (upsert), không lỗi trùng unique.
- **Instrument không `live`** (tạm ngưng/hết hạn) → chặn ngay ở `openPosition` với thông báo tiếng Việt, không tốn round-trip.
- **`clOrdId` tối đa 32 ký tự chữ-số**: `buildClOrdId()` ghép side + timestamp base36 + hậu tố ngẫu nhiên (độ dài cố định) rồi cắt symbol theo phần còn lại, nên ID luôn ≤ 32 ký tự kể cả với symbol dài như `1000PEPEUSDT`.
- **Ký quỹ quá nhỏ**: `sz` làm tròn xuống theo `lotSz`; nếu kết quả < `minSz` thì trả 400 kèm số hợp đồng tính được và mức tối thiểu, thay vì để OKX từ chối bằng mã lỗi khó hiểu.
- **Ticker/balance/TP-SL lỗi** → non-fatal, bảng vẫn render: mark price rơi về giá vào (PnL hiện 0 thay vì một số sai), ô equity hiện "—".
- **`ctVal` lookup lỗi** → fallback 1 (coi như đã là base asset); size ghi vào DB sai thang nhưng lệnh vẫn được ghi nhận, không mất dấu.
- **Row lịch sử chưa đóng hẳn**: bỏ qua row có `closeTotalPos` hoặc `closeAvgPx` = 0 — đó không phải một lệnh đã kết thúc.
- **Đóng/mở giữa 2 lần poll**: insert thẳng `status=closed` kèm cả log mở lẫn log đóng.
- **Trùng nhịp sync**: cờ `syncing` chặn chạy chồng; `positionId` (`posId`) unique nên close là idempotent.
- **Cập nhật TP/SL khi đã có algo order**: ưu tiên `amend-algos` để vị thế **không có khoảng trống không được bảo vệ**. Chỉ rơi về huỷ-rồi-đặt-lại khi phải **thêm hoặc bỏ hẳn một chiều** (amend chỉ đổi được giá đã có trên order), khi có >1 order live, hoặc khi amend lỗi.
- **Algo order không mang position id**: OKX chỉ trả `(instId, posSide)`, nên TP/SL được ghép về vị thế theo symbol + chiều. Ở net mode `posSide = "net"`, chiều được suy ra từ `side` của lệnh đóng (bán = đang long).
- **Nhật ký bắt đầu từ lúc golive, không backfill**: lần sync đầu neo mốc vào `okx_sync_state.historyStartAt` — `cTime` nhỏ nhất của vị thế đang mở, hoặc **`now`** nếu tài khoản đang flat — rồi xoá mọi lệnh đóng trước mốc kèm journal của chúng. Golive 17/08/2026 với tài khoản flat: nhánh flat trước đây để mốc trống và fallback `now − 90 ngày`, nên lần sync đầu đã kéo về 5 lệnh cũ (12/06 → 16/08, tổng +0.90 USDT); nay nhánh đó neo vào `now` nên không còn backfill. OKX vẫn chỉ giữ ~3 tháng lịch sử vị thế phía sàn, đó là lý do worker mirror vào DB.
- **Mốc ROE khi thiếu `upl` hoặc margin**: bỏ qua vị thế đó thay vì đoán — thà thiếu log còn hơn log sai.
- **Chưa chạy thật**: tích hợp này **chưa được kiểm chứng với tài khoản OKX live** — cần `OKX_API_KEY` / `OKX_API_SECRET` / `OKX_API_PASSPHRASE` để xác nhận đầu-cuối.

## Related Files (FE / BE / Worker)
**Web**
- `apps/web/src/app/okx/page.tsx` — route `/okx` (re-export mỏng).
- `apps/web/src/_pages/okx-page/okx-page.tsx` — Server Component, SSR 2 nguồn dữ liệu.
- `apps/web/src/widgets/okx/okx-tabs.tsx` — khung 3 tab + đếm số dòng.
- `apps/web/src/widgets/okx/okx-setup-feed.tsx` — tab Setup (mở lệnh, sao ưu tiên, QQE, Hôm nay/7d/30d/90d).
- `apps/web/src/widgets/okx/{setup-chart-dialog,bulk-setup-dialog,add-coin-dialog,chart-note-dialog,qqe-cell,star-rating,symbol-filter-input,chart-icon}.tsx` — UI phụ trợ của tab Setup.
- `apps/web/src/widgets/okx-positions/okx-positions-feed.tsx` — bảng vị thế đang mở.
- `apps/web/src/widgets/okx-positions/{tpsl-dialog,okx-journal-drawer}.tsx` — dialog TP/SL + drawer nhật ký.
- `apps/web/src/widgets/okx-positions/use-okx-live-prices.ts` — WS giá realtime OKX (kênh `tickers`, đổi giá theo `sodUtc0`).
- `apps/web/src/widgets/okx-history/okx-history-feed.tsx` — tab Lịch sử & PnL.
- `apps/web/src/shared/api/types.ts` — khối type `Okx*`.
- `apps/web/src/shared/api/client.ts` — khối method `*Okx*` gọi `/okx/*`.
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — mục "OKX" ngay dưới "MEXC".

**API**
- `apps/api/src/modules/okx/okx-trade.client.ts` — client OKX V5 có ký (ký base64, đổi instId, đổi contracts↔base, net/long-short mode, đọc/đặt/huỷ lệnh + algo TP/SL).
- `apps/api/src/modules/okx/okx.service.ts` — vị thế, lịch sử, mở/đóng lệnh, TP/SL, log `system`.
- `apps/api/src/modules/okx/okx-setup.service.ts` — cấu hình đòn bẩy/ký quỹ + sao ưu tiên + watchlist thủ công (`GET/POST/DELETE /okx/setup/watchlist`).
- `apps/api/src/modules/okx/okx-setup-chart.service.ts` — chart Setup/trade, QQE, đổi giá; **dùng lại** `../bitget/setup-chart-renderer`.
- `apps/api/src/modules/okx/okx-journal.service.ts` — nhật ký từng lệnh.
- `apps/api/src/modules/okx/okx.controller.ts` + `dto/` — route `/okx/*`.
- `apps/api/src/app.module.ts` — đăng ký `OkxModule`.

**Worker**
- `apps/worker/src/modules/okx-history/okx-history.service.ts` — sync vị thế/lịch sử + mốc ROE (tự ký, độc lập).
- `apps/worker/src/modules/okx-history/okx-history.module.ts`
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — cron 15s (`runOkxHistorySync`) + 1 phút (`runOkxMilestoneSync`).

**Shared**
- `packages/core/src/analysis/okx-closed.ts` — chuẩn hoá row `positions-history` của OKX; `summarizeOkxClosed` dùng lại phép tính chung.
- `packages/db/prisma/schema.prisma` — `OkxTrade`, `OkxSyncState`, `OkxTradeJournal`, `OkxSetupConfig`, `OkxSymbolPriority`, `OkxTradeChart`, `OkxWatchlistSymbol`.
- `packages/db/prisma/migrations/20260816120000_add_okx_tables/migration.sql`
- `packages/db/src/repositories/okx-*.repository.ts`
- `packages/db/src/repositories/asset.repository.ts` — `balanceByKey('okx')`: vốn gốc của OKX lấy từ số dư danh mục `okx` trên [/my-asset](../my-asset/my-asset.md) (tổng vào − tổng ra). Danh mục này được seed bởi migration `20260817130000_seed_okx_asset_category`; khi chưa có, `OKX_INITIAL_CAPITAL_USD` là fallback. Cùng số dư đó giờ cũng là một lát riêng trên donut Capital Allocation ở trang chủ — xem [/my-asset](../my-asset/my-asset.md).
- `.env.example` — `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE`, `OKX_API_BASE_URL`, `OKX_SIMULATED`, `OKX_INITIAL_CAPITAL_USD` (fallback).
