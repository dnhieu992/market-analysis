## Description

Bộ lọc thô hàng ngày: quét **các coin trong danh sách `/tracking-coins`**, tính **Supertrend(10, 3)** trên khung **D1** (nến đã đóng) và gửi **danh sách tên coin đang bullish** qua Telegram. Mục đích là thu hẹp số chart phải mở tay — không phải tín hiệu vào lệnh.

Kết quả **không lưu DB và không hiển thị trên dashboard**. Chỉ có Telegram.

Kích hoạt duy nhất: **cron 00:10 UTC hàng ngày** — chạy 10 phút sau khi nến D1 đóng. `POST /supertrend-scan/run` vẫn tồn tại cho lượt chạy tay (Swagger/curl) nhưng không còn nút nào trên UI gọi tới.

Trước 2026-09-08 trang `/portfolio` có nút `Scan` chạy thủ công cả scan D1 này lẫn scan 4H Supertrend + QQE song song — nút đó và toàn bộ scan H4 đã bị xoá theo yêu cầu (không cần gửi Telegram mỗi khi nến H4 đóng nữa).

## Main Flow

1. Trigger: cron `0 10 0 * * *` (UTC) trong `SupertrendScanService`.
2. `TrackingScanSymbolsService.list()` đọc bảng `TrackingCoin` (danh sách theo dõi ở trang `/tracking-coins`), chuẩn hoá symbol về dạng bare rồi ghép thành cặp Binance (`ADA` → `ADAUSDT`), khử trùng lặp. Trước 2026-08-11 bước này quét toàn bộ ≈470 cặp spot USDT của Binance.
3. Với mỗi symbol (8 symbol song song): lấy 200 nến `1d`, **bỏ nến đang chạy** (`closeTime > now`).
4. Coin có dưới 60 nến D1 đã đóng bị bỏ qua — quá ít lịch sử thì hướng Supertrend chỉ phản ánh bar khởi tạo.
5. `isSupertrendBullish(candles, 10, 3)` từ `@app/core` — thuật toán bám sát `ta.supertrend` của Pine Script nên hướng trùng với chart TradingView.
6. Gom base asset bullish, sort A→Z, gửi Telegram dạng:
   ```
   🟢 Supertrend(10,3) D1 Bullish — 2026-08-05 UTC
   12/40 coins theo dõi

   1INCH, AAVE, ADA, ...
   ```
7. Trả về `{ scanned, bullish[], skipped, failed, telegramSent, durationMs }`. Nút `Scan` chỉ dùng con số để hiện một dòng trạng thái rồi thôi.

Với vài chục coin theo dõi, lượt quét xong trong vài giây (bản quét toàn sàn trước đây mất ~12–20 giây cho 469 cặp).

## Edge Cases

- **Quét chồng lượt** — cờ `scanning` chặn: một lượt chạy tay (Swagger/curl) trong lúc cron đang chạy sẽ ném lỗi thay vì chạy chồng.
- **Nến chưa đóng** — luôn lọc theo `closeTime <= now`, nên chạy lúc 00:10 UTC hay giữa ngày đều đọc cùng một nến D1 đã đóng.
- **Coin mới list** (< 60 nến D1) — bỏ qua, đếm vào `skipped`, không báo lỗi.
- **Một symbol lỗi klines** — bắt riêng từng symbol, đếm vào `failed`, lượt quét vẫn hoàn tất.
- **Rate limit Binance** — 8 request song song, vài chục cặp × weight 2, dư an toàn.
- **Telegram lỗi / thiếu token** — không throw; `telegramSent: false`, log warn, UI báo "gửi Telegram thất bại".
- **Danh sách quá dài** — `TelegramService` tự cắt khúc ở 4000 ký tự (list ~124 coin ≈ 800 ký tự nên hiếm khi chạm).
- **Không coin nào bullish** — vẫn gửi tin, nội dung "Không có coin nào bullish."
- **Danh sách theo dõi trống** — `scanned = 0`, tin Telegram nói rõ "Danh sách theo dõi đang trống — thêm coin ở trang /tracking-coins."
- **Coin theo dõi không có cặp USDT trên Binance** — klines lỗi, đếm vào `failed`, lượt quét vẫn hoàn tất.

## Related Files (FE / BE / Worker)

- `packages/core/src/indicators/supertrend.ts` — indicator Supertrend dùng chung (`calcSupertrend`, `isSupertrendBullish`)
- `packages/core/src/indicators/supertrend.spec.ts` — test uptrend/downtrend/đảo chiều/warm-up
- `packages/core/src/index.ts` — export indicator
- `apps/api/src/modules/supertrend-scan/supertrend-scan.service.ts` — cron 00:10 UTC + logic quét + format tin nhắn
- `apps/api/src/modules/supertrend-scan/supertrend-scan.controller.ts` — `POST /supertrend-scan/run`
- `apps/api/src/modules/supertrend-scan/supertrend-scan.module.ts` — module wiring
- `apps/api/src/modules/telegram/telegram.service.ts` — gửi Telegram phía API (chunk 4000 ký tự, không throw)
- `apps/api/src/modules/telegram/telegram.module.ts` — module wiring
- `apps/api/src/modules/supertrend-scan/tracking-scan-symbols.service.ts` — nguồn symbol: danh sách `/tracking-coins` → cặp Binance
- `packages/db/src/repositories/tracking-coins.repository.ts` — `findAllCoins()`
- `apps/api/src/app.module.ts` — đăng ký `SupertrendScanModule`

## Notes

Cron nằm ở **API** chứ không phải worker vì API vốn đã chạy `ScheduleModule` và các cron khác (`bitget-auto-trade`, `pnl`).

Nút `Scan` trên `/portfolio` và scan 4H Supertrend + QQE song song (`SupertrendH4ScanService`, `POST /supertrend-scan/run-h4`) đã bị xoá hoàn toàn ngày 2026-09-08 — Telegram không cần báo mỗi khi nến H4 đóng nữa. `SupertrendScanController` giờ chỉ còn route `run` (D1); FE không còn wrapper hay type nào cho scan này (`runSupertrendScan`, `SupertrendScanResult` đã bị xoá khỏi `client.ts`/`types.ts`).
