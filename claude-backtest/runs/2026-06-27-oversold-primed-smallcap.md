# Backtest — "Oversold / Primed" pre-pump signal for small-cap radar

> Ngày: 2026-06-27 · Universe: 40 low-cap Binance USDT pairs (gồm PIVX) · TF: 1d, ~1000 nến/coin
> Mục tiêu: kiểm định giả thuyết từ ca PIVX — *capitulation quá bán có báo trước cú bounce/pump không?*
> Script: `scripts/run-oversold-primed-backtest.ts` (public Binance klines, no auth)

## Command
```bash
npx tsx scripts/run-oversold-primed-backtest.ts
```

## Định nghĩa
- **Signal "Oversold/Primed"**: `RSI14 < t` **và** `close < EMA200` **và** `drop ≥ X% trong N ngày`.
- **Forward max-return**: lãi tối đa (theo high) trong cửa sổ 14d/30d sau ngày tín hiệu (giả định bán đúng đỉnh → lạc quan, nhưng baseline dùng cùng thước đo nên *mức chênh* mới là tín hiệu thật).
- **Pump event**: ngày có forward max-return ≥ **+50% trong 14d** (de-dup các ngày liên tiếp cùng sóng).
- **Recall**: % pump event có tín hiệu nổ trong **10 ngày trước** đó.

## Kết quả

**BASELINE (mọi ngày, mọi coin):**
| Window | median | mean | %≥+20% | %≥+50% |
|---|--:|--:|--:|--:|
| 14d | 11.5% | 19.6% | 30% | 8% |
| 30d | 16.8% | 30.1% | 44% | 16% |

**Theo config (FWD = forward max-return):**
| Config | #signal-days | FWD30 median | FWD30 mean | FWD30 %≥+50% | Recall (pumps bắt được) |
|---|--:|--:|--:|--:|--:|
| RSI<30 + drop≥20%/7d | 659 | 28.6% | 45.1% | 28% | **65/389 = 17%** |
| RSI<30 + drop≥30%/7d | 257 | 31.6% | 50.3% | 33% | 11% |
| **RSI<25 + drop≥25%/7d** | 228 | **40.7%** | **60.3%** | **43%** | 9% |
| RSI<35 + drop≥25%/10d | 897 | 26.0% | 45.2% | 26% | **19%** |
| RSI<30 + drop≥30%/14d | 570 | 25.8% | 45.5% | 28% | 13% |

## Takeaway

1. **Edge có thật nhưng vừa phải.** Khi tín hiệu nổ, forward return vượt baseline rõ rệt. Config chặt nhất (RSI<25 + drop≥25%/7d): **43% số tín hiệu chạm +50% trong 30d so với 16% baseline (~2.7×)**; median 40.7% vs 16.8%. Capitulation quá bán *đúng là* có lợi thế thống kê cho cú bật.

2. **Nhưng recall thấp.** Ngay cả config lỏng nhất chỉ bắt được **~19%** các cú pump ≥+50%; config chặt chỉ 9–11%. Tức tín hiệu **bỏ lỡ 80–90%** số pump — phần lớn pump đến từ breakout/tin tức ở vùng giá cao, KHÔNG phải từ đáy quá bán. PIVX chỉ là **một nhánh** (bounce-from-capitulation) chứ không đại diện mọi pump.

3. **Đây là tín hiệu WATCHLIST có kỳ vọng dương, không phải bộ đếm thời điểm chính xác.** 43% chạm +50% nghĩa là **đa số tín hiệu KHÔNG pump** → phải dùng kiểu rổ/DCA, chấp nhận "dao rơi" (quá bán còn bán sâu hơn). Hợp với triết lý no-SL DCA của bạn.

4. **Đánh đổi rõ ràng:** lỏng (RSI<35) → recall cao hơn (19%) nhưng edge mỗi tín hiệu yếu hơn; chặt (RSI<25) → edge mạnh nhưng bắt ít pump hơn. **Khuyến nghị RSI<30 + drop≥25–30%/7d** làm điểm cân bằng cho stage `Oversold/Primed`.

5. **PIVX (ca gốc):** ngày 26/06 (RSI 24.3, dưới EMA200, -32%/14d) **nổ tín hiệu** ở các config lỏng/14d → lead time 1 ngày trước cú +84%. Đúng kiểu setup mà stage này nhắm tới.

### Cảnh báo phương pháp
- Forward max-return giả định bán đúng đỉnh → lạc quan; lãi thực thấp hơn (mức *chênh* so với baseline mới đáng tin).
- Survivorship bias: 40 coin này vẫn còn niêm yết hôm nay; coin đã chết/delist sẽ kéo số xuống.
- Universe 40 coin là đại diện, KHÔNG phải đúng rổ small-cap thật trong DB (rổ thật nằm ở DB, không có seed trong code).

## Việc làm tiếp (chưa làm)
- Thêm stage `Oversold/Primed` vào `computeSmallCapSignal` (`packages/core/src/analysis/small-cap-signal.ts`) với RSI<30 + dưới EMA200 + drop≥25–30%/7d.
- Backtest lại trên **đúng rổ coin trong DB** (export symbols từ DB rồi nạp vào script) để có recall sát thực tế.
- Kết hợp scan intraday + alert Telegram khi tín hiệu nổ, để vào sớm trong sóng.
