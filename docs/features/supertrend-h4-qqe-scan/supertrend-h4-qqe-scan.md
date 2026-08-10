## Description

Bộ lọc khung **4H**, chạy song song với [scan D1](../supertrend-daily-scan/supertrend-daily-scan.md): quét **toàn bộ cặp spot USDT của Binance**, giữ lại coin thỏa **cả hai** điều kiện trên nến 4H đã đóng gần nhất:

1. **Supertrend(10, 3)** đang **bullish**, và
2. **QQE** (QQE Signals của colinmck, `14 / 5 / 4.238`) đang **bullish** — đường trailing nằm **dưới** `rsiMa`.

Coin nào có Supertrend **vừa đảo chiều bearish → bullish đúng ở nến vừa đóng** thì được tách ra một mục riêng và **in đậm** trong tin Telegram — đó là nhóm mới vào trend, đáng mở chart trước.

Scan D1 trả lời "coin nào đang trong uptrend"; scan này trả lời "trong số đó coin nào đang có momentum 4H ngay lúc này".

Kết quả **không lưu DB, không hiển thị trên dashboard**. Chỉ có Telegram.

Hai đường kích hoạt:
- **Cron mỗi 4 giờ** (`0 5 */4 * * *` UTC) — 5 phút sau khi nến 4H đóng (00:05, 04:05, 08:05, 12:05, 16:05, 20:05 UTC).
- **Nút `Scan`** trên trang `/portfolio` — bấm một lần chạy **cả hai** scan (D1 + H4), mỗi scan gửi một tin Telegram riêng.

## Main Flow

1. Trigger: cron `0 5 */4 * * *` (UTC) trong `SupertrendH4ScanService`, hoặc `POST /supertrend-scan/run-h4` từ nút `Scan`.
2. `MarketDataService.getSpotUsdtSymbols()` — cặp `status = TRADING`, `quoteAsset = USDT`, quyền `SPOT`, bỏ base stablecoin/fiat. Thực tế ≈ 470 cặp.
3. Với mỗi symbol (8 symbol song song): lấy **400 nến `4h`**, **bỏ nến đang chạy** (`closeTime > now`).
4. Coin có dưới **200 nến 4H đã đóng** bị bỏ qua — QQE double-smooth bằng EMA 27 kỳ nên cần warm-up dài hơn nhiều so với ATR 10 kỳ.
5. `calcSupertrend(candles, 10, 3)` → đọc **hai** bar cuối:
   - bar cuối không bullish → loại luôn (không tính QQE).
   - `flipped = last.bullish && !previous.bullish`.
6. `calculateQqe(closes, 14, 5, 4.238)` → bullish khi `signal[last] < rsiMa[last]`. Đọc **trạng thái** chứ không chỉ bar có cross, nên coin ở lại danh sách suốt thời gian còn momentum, thay vì chỉ hiện đúng một nến lúc cắt.
7. Gom base asset, sort A→Z, gửi Telegram (`parse_mode: HTML`):
   ```
   🟢 Supertrend(10,3) + QQE H4 Bullish — 2026-08-10 12:05 UTC
   37/468 coins

   🔥 Vừa đảo chiều bearish → bullish (3):
   ARB, LINK, SOL          ← in đậm

   Đang bullish (34):
   AAVE, ADA, ATOM, ...
   ```
8. Trả về `{ scanned, bullish[], flipped[], skipped, failed, telegramSent, durationMs }`. Nút `Scan` chỉ dùng con số để hiện dòng trạng thái.

Lượt quét mất ~15–30 giây (nặng hơn D1 vì mỗi coin tải 400 nến thay vì 200).

## Edge Cases

- **Quét chồng lượt** — cờ `scanning` riêng cho scan H4 (độc lập với D1): bấm `Scan` khi cron 4H đang chạy sẽ ném `ConflictException`, UI hiện "H4: scan thất bại — thử lại sau." còn dòng D1 vẫn báo kết quả bình thường.
- **Nút `Scan` chạy hai scan** — dùng `Promise.allSettled`, một scan lỗi không kéo scan kia xuống; mỗi scan một dòng trạng thái riêng.
- **Nến chưa đóng** — luôn lọc theo `closeTime <= now`, nên bấm giữa khung giờ vẫn đọc đúng nến 4H đã đóng gần nhất; cùng một nến ⇒ cùng kết quả với lượt cron.
- **`flipped` ở nến warm-up** — bar warm-up của Supertrend có `bullish: false`, nên coin quá ít lịch sử có thể bị đọc nhầm là "vừa flip"; ngưỡng 200 nến đã chặn trường hợp này từ trước.
- **Coin mới list** (< 200 nến 4H) — bỏ qua, đếm vào `skipped`, không báo lỗi.
- **Một symbol lỗi klines** — bắt riêng từng symbol, đếm vào `failed`, lượt quét vẫn hoàn tất.
- **Rate limit Binance** — 8 request song song; khi bấm `Scan` thì hai scan chạy cùng lúc ⇒ 16 request song song, ~940 × 2 weight/phút, vẫn dư so với hạn mức 6000/phút.
- **Chunk cắt giữa thẻ HTML** — danh sách coin được xuống dòng mỗi 12 coin và `<b>` chỉ bọc trong **một dòng**; `TelegramService` cắt khúc tại ký tự xuống dòng nên không bao giờ cắt đôi thẻ.
- **Telegram lỗi / thiếu token** — không throw; `telegramSent: false`, log warn.
- **Không coin nào thỏa** — vẫn gửi tin, nội dung "Không có coin nào bullish."

## Related Files (FE / BE / Worker)

- `apps/api/src/modules/supertrend-scan/supertrend-h4-scan.service.ts` — cron 4H + logic quét Supertrend + QQE + format tin nhắn
- `apps/api/src/modules/supertrend-scan/supertrend-scan.controller.ts` — `POST /supertrend-scan/run-h4` (cạnh `POST /supertrend-scan/run` của scan D1)
- `apps/api/src/modules/supertrend-scan/supertrend-scan.module.ts` — đăng ký `SupertrendH4ScanService`
- `apps/api/test/supertrend-h4-scan.service.spec.ts` — test lọc bullish, đánh dấu flip, skipped/failed, Telegram lỗi, chặn quét chồng
- `apps/api/src/modules/telegram/telegram.service.ts` — thêm `sendMessage(text, { parseMode })` để in đậm bằng HTML
- `packages/core/src/indicators/supertrend.ts` — `calcSupertrend` (đọc 2 bar cuối để phát hiện flip)
- `packages/core/src/indicators/qqe.ts` — `calculateQqe` (`rsiMa` / `signal` / `cross`)
- `apps/api/src/modules/market/market-data.service.ts` — `getSpotUsdtSymbols()`, `getCandles(symbol, '4h', …)`
- `apps/web/src/widgets/portfolios-list/portfolios-list.tsx` — nút `Scan` chạy cả hai scan + hai dòng trạng thái
- `apps/web/src/shared/api/client.ts` — `runSupertrendH4Scan()`
- `apps/web/src/shared/api/types.ts` — `SupertrendH4ScanResult`

## Notes

Cron đặt ở **API** (không phải worker) vì cùng lý do với scan D1: worker không mở cổng HTTP nên không nhận được trigger từ nút `Scan`, đặt chung một service để cron và nút bấm dùng đúng một đường code.

Ngưỡng `MIN_CLOSED_CANDLES = 200` (so với 60 của scan D1) là do QQE: `dar` là EMA 27 kỳ chồng EMA 27 kỳ của ATR-RSI, dưới ~150 nến thì đường trailing vẫn còn bám giá trị khởi tạo.
