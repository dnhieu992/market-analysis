# Review cách tính tín hiệu /tracking-coins (2026-07-12)

Kết quả review code tính tín hiệu của page `/tracking-coins` — pipeline, công thức, và các vấn đề phát hiện được.

## Pipeline

- Worker cron chạy **mỗi 4 tiếng** (`5 */4 * * *` UTC) qua `TrackingCoinScanService.scanAll()`, cộng thêm nút re-scan thủ công qua API (`TrackingCoinsService.triggerScan()`). Hai bản scan gần như copy nhau.
- Mỗi lần scan fetch klines Binance công khai: **D1 ×220, H4 ×200, M30 ×300, W1 ×300** (worker fetch thêm H1 ×72), tính chỉ báo, lưu 1 row signal/ngày (`upsertSignal`).
- UI chỉ đọc row signal mới nhất; page cần tối thiểu 210 nến D1, ít hơn thì bỏ qua coin.

Page hiển thị 2 tín hiệu DCA chính, theo triết lý **không stop-loss — chọn coin thay cho stop-loss**:

## 1. DCA Score (0–100) — "coin này có an toàn để gom không"

Nguồn: `packages/core/src/analysis/dca-signal.ts` → `computeDcaScore()`.

| Thành phần | Tối đa | Cách tính |
|---|---|---|
| Market cap | 50 | ≥$1B=50 · ≥$300M=40 · ≥$100M=30 · ≥$30M=20 · ≥$10M=10 · dưới/không rõ=**0** |
| Cấu trúc tuần | 50 | Trend W1: StrongUp 20 / Up 15 / Neutral 8 / Down 2 / StrongDown 0, cộng: close > EMA200 W1 **+15**, > EMA89 W1 **+8**, UT Bot W1 bullish **+7** (cắt trần 50) |

Bucket hiển thị (`dcaQualityBucket`): ≥70 safe · ≥50 ok · ≥30 risky · <30 avoid.

Trend W1 (`computeTimeframeTrend` trong `small-cap-signal.ts`) là swing structure: pivot 1 nến trên toàn series, so 2 đỉnh/2 đáy gần nhất — HH+HL = bullish, LH+LL = bearish — rồi overlay EMA89 để ra 5 mức (bullish trên EMA89 = StrongUp, bearish dưới EMA89 = StrongDown, …).

## 2. DCA Zone (GOM / Chờ / CHỐT) — hành động mỗi ngày trên D1

Nguồn: `dca-signal.ts` → `dcaZone()`. Thứ tự check:

1. **CHỐT**: close D1 > EMA34 (reclaim → chốt lời) — check đầu tiên, thắng mọi điều kiện khác.
2. **GOM**: RSI(14) D1 ≤ 35 **và** giá cách đáy 20 ngày (`low20Pct`) ≤ 8%.
3. **Chờ**: còn lại (dưới EMA34 nhưng chưa đủ sâu để gom).

Ghi chú:

- Zone khi list coin được **tính lại từ dữ liệu scan đã lưu** (`tracking-coins.service.ts` `listCoins()`), tức phản ánh giá lúc scan gần nhất — có thể trễ tối đa ~4 tiếng so với giá live.
- Zone quyết định tag **SIGNAL/FOMO** khi log một lớp gom: mua lúc zone = GOM → SIGNAL, còn lại → FOMO (feed vào holding review history).
- Lớp gom kế tiếp gợi ý ở mức −8% so với lần gom cuối (khớp bước −8% đã backtest).

## Nhận xét

### Điểm tốt

- Tách bạch rõ "an toàn" (score — khung tuần + market cap) và "thời điểm" (zone — khung ngày), đúng triết lý coin selection thay stop-loss đã backtest (`claude-backtest/runs/2026-06-26-dca-dip-d1-no-sl`).
- Fail-safe hợp lý: RSI null → mặc định 50 nên không bao giờ rơi vào GOM khi thiếu dữ liệu; market cap không rõ → 0 điểm (coi như rủi ro chết cao).
- GOM **không** bị gate cứng bởi dcaScore — đúng kết luận backtest trước (gate cứng cho kết quả tệ hơn, giữ advisory).
- UT Bot được feed nến open=close nhưng thuật toán chỉ dùng close + high/low (ATR) nên vô hại.

### Vấn đề phát hiện

1. **Lệch tham số UT Bot W1 giữa hai chỗ** — `dca-signal.ts` `computeDcaTimingSignal()` (dùng cho page /dca-ladder) gọi `calcUtBotResult(wCandles, 10, 2)` trong khi scan thật của /tracking-coins dùng `(10, 3)` (`tracking-coins.service.ts` và `tracking-coin-scan.service.ts`). Comment trong file nói "Mirrors tracking-coin-scan.service exactly" nhưng thực tế không — sai keyValue có thể lệch ±7 điểm dcaScore giữa hai page cho cùng một coin. **Chưa sửa.**

2. **marketCap không bao giờ được cập nhật tự động** — chỉ được set nếu `repo.addCoin` nhận marketCap, nhưng API `addCoin` không truyền, và không có job CoinGecko nào refresh cho tracking coins (small-cap-radar và meme-radar thì có). Coin nào marketCap = null mất trọn 50 điểm → score tối đa 50 ("ok"), dù là coin $10B. Ảnh hưởng trực tiếp độ tin cậy của score. **Chưa sửa.**

3. **Trùng lặp code scan** — `scanOneCoin` (API, ~240 dòng) và `scanOne` (worker) gần như giống hệt. Vụ lệch tham số ở mục 1 là hệ quả của kiểu copy này; nên gom về một hàm chung trong `@app/core` để hai đường scan không thể lệch nhau.

4. (Nhỏ) Ngưỡng GOM (RSI ≤ 35, cách đáy 20d ≤ 8%) và bước gom −8% là hard-code, chưa có config per-coin.

## Related Files (FE / BE / Worker)

- `packages/core/src/analysis/dca-signal.ts` — `computeDcaScore`, `dcaZone`, `dcaQualityBucket`, `computeDcaTimingSignal`
- `packages/core/src/analysis/small-cap-signal.ts` — `computeSmallCapSignal`, `computeTimeframeTrend` (trend swing-structure + EMA89)
- `packages/core/src/indicators/ut-bot.ts` — UT Bot trailing stop
- `apps/api/src/modules/tracking-coins/tracking-coins.service.ts` — `scanOneCoin` (re-scan thủ công), `listCoins` (tính lại zone từ signal đã lưu), tag SIGNAL/FOMO khi add DCA buy
- `apps/worker/src/modules/tracking-coin-scan/tracking-coin-scan.service.ts` — `scanAll`/`scanOne` (cron mỗi 4h)
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — cron `5 */4 * * *` UTC
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — render score/bucket/zone, filter GOM/Chờ/CHỐT
