## Description
P5 — Backtest harness đo lường khách quan logic sinh lệnh limit (swing + day-trade) của
tracking-coins trên dữ liệu lịch sử, thay vì chỉ dựa vào vài lệnh live. Mục tiêu: trả lời
"P1–P4 có thực sự tăng tỉ lệ thắng không, điểm yếu nằm ở đâu" bằng số liệu.

Là **script CLI** (không phải module/UI). Tái dùng **nguyên** các hàm core đang chạy production
(`computeSwingLimitOrder`, `evaluateLimitOrder`) nên đo đúng logic thật, không phải bản sao.

> Cập nhật 2026-06-14: day-trade đã bị gỡ khỏi tracking-coins → harness giờ **chỉ backtest
> swing**. Tham số `--day-min-rr` và việc fetch H1 đã bỏ.
>
> Kết quả 365 ngày (5 coin): trước khi siết LONG → OVERALL E[R] +0.060, PF 1.13, swing LONG
> −0.041 (MDD −49.6R). Sau khi siết LONG về `StrongUp` → OVERALL **E[R] +0.116, PF 1.26,
> MDD −21.9R**, swing LONG về hòa (−0.001), swing SHORT +0.144. No-trade ~38%.

## Cách chạy
```bash
# Mặc định: tất cả coin trong watchlist (DB), 180 ngày
pnpm --filter worker backtest:orders -- --days=180

# Chỉ định coin + xuất CSV
pnpm --filter worker backtest:orders -- --days=120 --symbols=BTC,ETH,SOL --csv=/tmp/bt.csv

# Quét thử cổng minRR (P3)
pnpm --filter worker backtest:orders -- --days=365 --swing-min-rr=1.5 --day-min-rr=2
```
Args: `--days` (số nến D1 test, mặc định 180), `--symbols` (mặc định = watchlist DB),
`--swing-min-rr` / `--day-min-rr` (cổng minRR tùy chọn), `--csv` (xuất chi tiết từng lệnh).

## Main Flow (walk-forward, KHÔNG lookahead)
1. Fetch lịch sử D1/H4/H1 từ Binance (phân trang qua `startTime`, gộp + khử trùng theo openTime).
2. Duyệt từng nến D1 từ index `WARMUP_D1` (210) trở đi. Tại mỗi nến đóng lúc `T`:
   - Cắt mọi mảng **tới `T`** (`closeTime ≤ T`) → dựng `OrderSigSnapshot` bằng đúng các hàm
     core (`computeSmallCapSignal`, `computeTimeframeTrend`, `computeLongShortScore`,
     `calcUtBotResult`, `calculateRsi`) — mirror `TrackingCoinScanService.scanOne`.
   - Tính ATR H4/H1, sinh lệnh swing + day-trade (qua cổng minRR nếu có).
3. Chấm điểm bằng nến **sau `T`** (`closeTime > T`): swing dùng 30 nến H4 (5 ngày), day-trade
   24 nến H1 (1 ngày) — khớp cửa sổ hết hạn P4. Gọi `evaluateLimitOrder`.
4. Phân loại mỗi lệnh: `unfilled` (giá không chạm entry — không tính), `tp1/tp2`, `sl`, hoặc
   `expired` (đã vào nhưng hết cửa sổ, thoát ≈ hòa = 0R).
5. Tổng hợp metrics theo coin và theo {swing/daytrade} × {LONG/SHORT} + tổng.

## Metrics
- **win%** = wins / (wins + losses) — chỉ trên lệnh đã khớp.
- **E[R]** = kỳ vọng R mỗi lệnh đã khớp (SL = −1R, TP = +rrRatio, expired = 0R). **Chỉ số
  quan trọng nhất** — quyết định lời/lỗ dài hạn.
- **PF** = profit factor = Σ(R thắng) / Σ(R thua).
- **MDD** = max drawdown của đường cong R cộng dồn.
- **unfilled / no-trade rate** = tỉ lệ lệnh không khớp / số phiên regime gate chặn cả 2 chiều.

## Kết quả lần chạy đầu (2026-06-14, 5 coin, 180 ngày, 1623 lệnh)
```
OVERALL        filled=1310  W/L=418/589  win%=41.5  E[R]=+0.086  PF=1.19  MDD=-42.4R
swing LONG     filled= 243  win%=35.9    E[R]=-0.033  PF=0.94          ← yếu
swing SHORT    filled= 414  win%=43.2    E[R]=+0.111  PF=1.25
daytrade LONG  filled= 226  win%=39.5    E[R]=+0.053  PF=1.12
daytrade SHORT filled= 427  win%=44.2    E[R]=+0.148  PF=1.35
ADA            E[R]=-0.084  PF=0.84  MDD=-41.4R                        ← coin tệ nhất
No-trade bars: 10.6%
```
**Đọc kết quả:**
- Tổng thể **kỳ vọng dương** (E[R] +0.086, PF 1.19) → P1–P4 cho lợi thế thống kê trên mẫu lớn.
- **Side LONG kém SHORT một cách nhất quán** (cả run 120 ngày lẫn 180 ngày). Khả năng do giai
  đoạn test thiên giảm + chiến lược "mua tại hỗ trợ" bị quét trong downtrend → ứng viên tinh
  chỉnh tiếp (gate chặt hơn cho LONG, hoặc chỉ LONG khi D1 thực sự StrongUp).
- MDD tổng −42R đáng kể → cần quản trị rủi ro / lọc bớt lệnh.

> ⚠️ Kết quả phụ thuộc **giai đoạn thị trường** của cửa sổ test. Nên chạy nhiều `--days` khác
> nhau và nhiều coin trước khi kết luận. Đây là công cụ đo lường, không phải lời hứa lợi nhuận.

## Edge Cases / Giả định
- **No-lookahead**: chỉ dùng nến `closeTime ≤ T` để dựng tín hiệu; nến `> T` để chấm điểm.
- **m30Trend ≈ h4Trend** (xấp xỉ): fetch M30 cả giai đoạn quá nặng, trọng số m30 trong score
  nhỏ (0.5/2.5). Ghi rõ ở header script.
- **unfilled không tính** vào win%/E[R] (không có vị thế).
- **expired = 0R** (xấp xỉ thoát ≈ giá entry) — gần đúng, có thể tinh chỉnh sau.
- **Phí/slippage**: chưa tính (v1). Thêm khoản trừ cố định là cải tiến tiếp theo.
- **Param sweep đầy đủ** (ATR mult, regime margin) cần biến hằng số core thành tham số —
  hiện chỉ sweep được `minRR` qua CLI. Là việc làm tiếp nếu cần tối ưu.

## Related Files (Worker)
- `apps/worker/src/scripts/backtest-tracking-orders.ts` — toàn bộ harness.
- `apps/worker/package.json` — script `backtest:orders`.
- Tái dùng: `packages/core/src/orders/tracking-coin-orders.ts`, `binance-market-data.service.ts`,
  `@app/db` repo (lấy watchlist).
