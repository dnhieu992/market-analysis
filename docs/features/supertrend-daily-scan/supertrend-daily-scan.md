## Description

Bộ lọc thô hàng ngày: quét **các coin trong danh sách `/tracking-coins`**, tính **Supertrend(10, 3)** trên khung **D1** (nến đã đóng) và gửi **danh sách tên coin đang bullish** qua Telegram. Mục đích là thu hẹp số chart phải mở tay — không phải tín hiệu vào lệnh.

Kết quả **không lưu DB và không hiển thị trên dashboard**. Chỉ có Telegram.

Hai đường kích hoạt:
- **Cron 00:10 UTC hàng ngày** — chạy 10 phút sau khi nến D1 đóng.
- **Nút `Scan`** trên trang `/portfolio` (cạnh `+ New Portfolio`) — chạy thủ công, cũng chỉ gửi Telegram. Từ 2026-08-10 nút này chạy **cả** scan D1 lẫn [scan 4H Supertrend + QQE](../supertrend-h4-qqe-scan/supertrend-h4-qqe-scan.md); hai scan độc lập, mỗi cái một tin Telegram và một dòng trạng thái.

## Main Flow

1. Trigger: cron `0 10 0 * * *` (UTC) trong `SupertrendScanService`, hoặc `POST /supertrend-scan/run` từ nút `Scan`.
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

- **Quét chồng lượt** — cờ `scanning` chặn: bấm `Scan` khi cron đang chạy (hoặc bấm hai lần) sẽ ném lỗi, UI hiện "Scan thất bại — thử lại sau."
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
- `apps/web/src/widgets/portfolios-list/portfolios-list.tsx` — nút `Scan` + dòng trạng thái
- `apps/web/src/shared/api/client.ts` — `runSupertrendScan()`
- `apps/web/src/shared/api/types.ts` — `SupertrendScanResult`

## Notes

Cron nằm ở **API** chứ không phải worker: worker không mở cổng HTTP nên không nhận được trigger từ nút `Scan`, còn API vốn đã chạy `ScheduleModule` và các cron khác (`bitget-auto-trade`, `pnl`). Đặt chung một chỗ để cron và nút bấm dùng đúng một service, không nhân đôi logic.
