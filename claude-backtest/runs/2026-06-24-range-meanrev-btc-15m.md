# 2026-06-24 — Range / mean-reversion (fade-the-edges) — BTCUSDT 15m

**Mục tiêu:** tìm chiến lược đánh trong vùng sideway để bổ trợ cho bot `/day-trading`
(breakout/trend, đứng ngoài khi chop). Ý tưởng: fade biên của hộp khi BTC đi ngang.

**Script:** `scripts/run-range-meanrev-btc-15m-backtest.ts` (mới, self-contained, Binance klines).

## Luật
- **Regime gate (phải đang range):** `ADX(14) < adxMax` và độ rộng Donchian(N)/giá ≥ `minWidth%`.
- **Entry:**
  - `edge` mode: giá vào vùng `edge` cuối của biên (pos ≤ edge / ≥ 1−edge) + RSI lệch + nến xác nhận.
  - `reclaim` mode: nến **thủng biên rồi đóng cửa ngược vào trong** (failed breakout) + RSI + nến xác nhận.
- **SL** ngoài biên `slAtr×ATR`; **TP** = giữa hộp (`mid`) hoặc biên đối diện (`opp`).
- SL kiểm tra trước TP trong cùng nến (pessimistic). 1 lệnh/lúc, time-stop `maxBars`.
- Fee **0.05%/side**, risk **$5/lệnh** (size = risk/khoảng-SL). Chấm điểm theo **R** và **$**.
- Dữ liệu: BTCUSDT 15m, **35,520 nến (2025-06-19 → 2026-06-24)**.

## Lệnh chạy
```bash
# edge entry, sweep SL 0.3 / 1.0 / 1.5 ×ATR
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-range-meanrev-btc-15m-backtest.ts 365 0.05 5 24 0.8 15 1.0 192 mid
# reclaim entry (failed breakout)
... 365 0.05 5 24 0.8 15 1.0 192 mid reclaim
```
Mỗi lần sweep lưới `adxMax ∈ {18,22,25,off}` × `edge ∈ {0.10,0.15,0.20}`.

## Kết quả (chọn cấu hình tốt nhất mỗi biến thể)

| Biến thể | adxMax | trades | winRate | PF | exp (R) | NET $ |
|---|---|---|---|---|---|---|
| edge, SL 0.3×ATR, TP mid | 22 | 37 | 13.5% | 0.27 | −1.02 | −$188 |
| edge, SL 1.0×ATR, TP mid | 18 | 13 | 38.5% | 0.71 | −0.22 | −$14 |
| edge, SL 1.5×ATR, TP mid | 18 | 13 | 46.2% | 0.74 | −0.16 | −$11 |
| reclaim, SL 1.0×ATR, TP mid | 18 | 11 | 45.5% | 0.75 | −0.17 | −$9 |
| reclaim, SL 1.0×ATR, TP opp | 100 | 319 | 26.3% | 0.82 | −0.15 | −$243 |

**Toàn bộ ~70 cấu hình đều ÂM.** PF cao nhất = **0.82** (vẫn < 1). Không một tổ hợp nào
(entry edge/reclaim × SL 0.3–1.5 × TP mid/opp × ADX 18–off × edge 0.10–0.20) cho expectancy dương.

## Takeaway
**Fade biên range trên BTC 15m là negative-expectancy, kể cả sau khi thử đúng bài.**

1. **SL sát biên (0.3×ATR) là thảm họa** — win rate 13–23%, bị quét râu liên tục (đúng bài học
   cũ của bot day-trading: flat stop bị wick). Nới SL lên 1.0–1.5×ATR kéo win rate lên ~45% nhưng
   mỗi lần SL mất nhiều hơn → net **vẫn âm**.
2. **Lọc ADX càng chặt (ADX<18 = range "sạch") thì per-trade càng tốt** (PF ~0.75, WR 45%) —
   nhưng chỉ ~11–13 lệnh/năm và **vẫn lỗ nhẹ sau phí**. Nới lọc để có nhiều lệnh thì tệ hẳn
   (trend lọt vào, mình fade đúng breakout thật → cháy).
3. **Nguyên nhân gốc:** ở biên hộp, BTC 15m thiên về **đi tiếp (momentum)** hơn là bật lại; "range"
   đủ thường xuyên kết thúc bằng breakout khiến fade thua. Cộng phí round-trip 0.1% trên scalp 15m
   bào mòn phần reversion mỏng còn lại → ngay cả trong range sạch nhất cũng chỉ hòa-trừ-phí.

**Kết luận:** không nên đưa luật fade-range này vào bot. Cách "tìm vùng sideway có quy luật để vào lệnh"
nghe hợp lý nhưng dữ liệu 1 năm cho thấy không có edge cơ giới trên BTC 15m.

**Hướng còn có thể thử (nếu muốn tiếp):**
- Đổi khung/tài sản: mean-reversion thường sống hơn ở khung thấp các **altcoin biến động mạnh**, hoặc
  ở khung cao hơn (1H/4H) nơi phí ít cắn hơn.
- Không fade mà **chờ breakout-rồi-retest** (theo momentum) — cùng "regime range" nhưng giao dịch
  *cú phá* thay vì *cú bật*; hợp với việc bot hiện tại đã là breakout.
- Bổ sung bộ lọc phiên (giờ Á/Âu/Mỹ) hoặc volatility-compression (BB squeeze) để chỉ đánh range
  trong điều kiện hẹp thật sự — nhưng rủi ro overfit cao, cần walk-forward.
