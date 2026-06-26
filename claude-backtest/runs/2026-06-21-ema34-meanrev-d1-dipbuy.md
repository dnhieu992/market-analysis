# D1 EMA34 mean-reversion (dip-buy LONG) — sweep độ lệch 5→10%

**Date:** 2026-06-21
**Script:** `scripts/run-ema34-meanrev-d1-backtest.ts` (mới)

## Chiến lược (theo yêu cầu user)
- Khung **D1**, **LONG only**.
- **Entry:** nến D1 đóng cửa thấp hơn **EMA34** ít nhất `devPct`% → mua, vào tại close.
  Sweep `devPct` ∈ {5,6,7,8,9,10}% để tìm vùng tối ưu.
- **Take profit:** nến sau **chạm lại EMA34** (high ≥ EMA34) → thoát tại EMA34.
- **Stop loss:** cố định **10%** dưới entry (kiểm tra SL trước TP trong cùng 1 nến = worst case).
- 1 lệnh tại một thời điểm, $1000 compounded, fee **0.05%/side**, không đòn bẩy.

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-ema34-meanrev-d1-backtest.ts "POLUSDT,XRPUSDT,SOLUSDT,TAOUSDT" 1d 2200 1000 0.05 34 "5,6,7,8,9,10" 10
```

## Dữ liệu
| Symbol | Candles | Khoảng |
|---|---|---|
| POLUSDT | 647 | 2024-09-13 → 2026-06-21 |
| XRPUSDT | 2200 | 2020-06-13 → 2026-06-21 |
| SOLUSDT | 2141 | 2020-08-11 → 2026-06-21 |
| TAOUSDT | 802 | 2024-04-11 → 2026-06-21 |

## Kết quả (return % trên $1000, net phí)

| devPct | POL | XRP | SOL | TAO |
|---|---|---|---|---|
| **-5%** | −73.7 | −13.4 | −86.6 | −43.0 |
| **-6%** | −68.8 | −26.3 | −87.7 | −4.2 |
| **-7%** | −72.4 | −27.0 | −85.2 | **+11.9** |
| **-8%** | −65.2 | −21.3 | −88.8 | **+19.0** |
| **-9%** | −55.4 | −17.5 | −88.3 | **+18.7** |
| **-10%** | −44.6 | −14.8 | −86.7 | **+18.3** |

Win rate dao động 34–57%; số lệnh SL > số lệnh TP ở hầu hết cấu hình (vd SOL @-5%: 59 TP / 82 SL).

## Takeaway
**Chiến lược lỗ ở 3/4 coin tại mọi ngưỡng.** Nguyên nhân gốc là **cấu trúc R:R âm**: TP = "chạm lại EMA34" chỉ cách entry đúng bằng độ lệch (5–10%), trong khi SL cố định **10%**. Tức là ở ngưỡng -5%, bạn rủi ro 10% để ăn ~5% → cần thắng >67% mới hòa vốn, nhưng win rate thực tế chỉ ~40–55%. Đây là kiểu "bắt dao rơi" — vào lệnh khi giá đang ở dưới EMA34 trong các nhịp downtrend, giá tiếp tục rơi và quét SL hàng loạt (SOL/POL thảm họa −85→−88%).

**Vùng "tối ưu" trong phạm vi yêu cầu:** càng sâu càng đỡ tệ — **-9% đến -10%** tốt hơn -5% trên mọi coin (vì R:R tiến gần 1:1 hơn). Nhưng "ít lỗ hơn" vẫn là lỗ.

**Ngoại lệ TAOUSDT (+12→+19%):** chỉ dương vì lịch sử TAO ngắn (từ 04/2024) rơi đúng giai đoạn tăng giá — không đủ mẫu để tin cậy, dễ là may mắn regime.

**Đề xuất nếu muốn cứu ý tưởng này** (chưa chạy, có thể test tiếp):
1. **Siết SL ≤ TP** để R:R ≥ 1 (vd SL = độ lệch entry, hoặc SL 5%) — sửa gốc kỳ vọng âm.
2. **Lọc xu hướng:** chỉ dip-buy khi EMA34 đang dốc lên / giá > EMA200 (tránh bắt dao trong downtrend — chính là thứ giết SOL & POL).
3. **TP xa hơn EMA34** (vd EMA34 + k×ATR) để tăng reward.

---

## Mở rộng: entry sâu hơn -11→-15% (SL vẫn 10%)

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-ema34-meanrev-d1-backtest.ts "POLUSDT,XRPUSDT,SOLUSDT,TAOUSDT" 1d 2200 1000 0.05 34 "11,12,13,14,15" 10
```

| devPct | POL | XRP | SOL | TAO |
|---|---|---|---|---|
| -11% | −41.5 | +0.3 | −88.3 | **+37.6** |
| -12% | −50.7 | **+49.1** | −83.4 | +0.6 |
| -13% | −59.3 | **+53.7** | −77.2 | +7.7 |
| -14% | −59.7 | **+50.7** | −52.3 | −15.1 |
| -15% | −48.6 | **+97.9** | −59.9 | −27.8 |

**Nhận xét:**
- Entry càng sâu thì **R:R càng tốt** (vào -15% → mục tiêu về EMA34 ~+17.6% so với SL 10% → R:R ~1.76:1), nên **XRP bật mạnh lên +98%** ở -15%.
- Nhưng **SOL & POL vẫn lỗ nặng ở mọi ngưỡng** — đây là các coin có nhịp sập sâu, giá ở xa dưới EMA34 rất lâu và quét SL liên tục; vào sâu hơn không cứu được vì sau khi vào giá còn rơi tiếp >10%.
- Đường cong **không đơn điệu** và **số lệnh tụt mạnh** (XRP -15% chỉ còn 34 lệnh, win 47%) → kết quả dương dễ là **overfit / phụ thuộc 1-2 sóng hồi lớn**, không bền.

**Kết luận chung:** đẩy ngưỡng xuống -15% chỉ giúp coin nào *chịu mean-revert* (XRP), còn coin *trend giảm kéo dài* (SOL/POL) vẫn chết. Vấn đề gốc là **SL 10% chặt hơn biên độ giá có thể đi tiếp sau khi đã -15% dưới EMA** + **thiếu lọc trend**. Muốn dùng thật phải sửa 2 điểm 1 & 2 ở trên, không phải chỉ chỉnh ngưỡng entry.

---

## Mở rộng 2: nới SL lên 20%

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-ema34-meanrev-d1-backtest.ts "POLUSDT,XRPUSDT,SOLUSDT,TAOUSDT" 1d 2200 1000 0.05 34 "5,7,10,12,15" 20
```

| devPct | POL | XRP | SOL | TAO |
|---|---|---|---|---|
| -5% | −75.2 | −30.0 | −91.6 | −54.0 |
| -7% | −75.0 | −18.1 | −91.8 | −27.1 |
| -10% | −57.6 | **+29.6** | −84.7 | −21.9 |
| -12% | −54.2 | **+79.7** | −81.7 | −4.2 |
| -15% | −44.7 | **+170.9** | −49.1 | −27.9 |

Win rate tăng rõ (SL ít bị quét hơn): XRP/TAO ~60–70%, nhưng **mỗi lệnh thua nay −20%** thay vì −10%.

**Nhận xét:**
- Nới SL 20% **đẩy win rate lên cao** (XRP -5%: 70.6% thắng) nhưng **không cứu được P&L** vì lệnh thua to gấp đôi. Đây là đánh đổi cổ điển: SL rộng = thắng nhiều ván nhỏ, thua vài ván lớn.
- **XRP lại là coin duy nhất ăn đậm** (-15% → +171%) — củng cố thêm: chiến lược này chỉ là **cú đặt cược coin sẽ mean-revert**. XRP đi ngang/hồi tốt trong lịch sử nên hợp; SOL/POL sập theo trend nên vẫn lỗ 45–92% ở mọi cấu hình.
- Kể cả khi return dương, **maxDD vẫn 49–66%** (XRP +171% nhưng sụt vốn 49% giữa đường) → đường cong vốn rất xấu, khó chịu đựng thật.

**Tổng kết toàn bộ thí nghiệm:** chỉnh ngưỡng entry (5→15%) và SL (10→20%) đều **không biến chiến lược thành robust**. Nó thắng/thua theo *bản chất từng coin* (range vs downtrend), không theo tham số. Đòn bẩy thật sự để cải thiện vẫn là **lọc trend (chỉ long khi giá > EMA200 / EMA34 dốc lên)** — chưa test.
