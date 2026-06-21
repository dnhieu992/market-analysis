# LONG FOMO @ 23:00 UTC — altcoin only, TP +2%, force-close 15:00 UTC

## Strategy
- **Entry:** LONG at open of the 23:00 UTC 1h candle (06:00 giờ Việt Nam), every day.
- **TP:** +2% — if any candle in the holding window touches entry×1.02, exit at TP.
- **Force close:** at 15:00 UTC next day (22:00 giờ VN) = open of the 15:00 candle, if TP not hit.
- **No stop-loss.** Holding window crosses midnight (23:00 → 15:00 = 16h).
- **Size:** fixed $100/trade, NO compounding. One trade per day.
- **Fee:** 0.05%/side (0.1% round-trip).
- **Symbols (altcoin only):** TAO, BNB, POL, XRP, SOL, SUI, ARB.

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-long-fomo-2300-altcoin-backtest.ts 365 0.05 100 2
```

## Results — 365 days, $100/trade fixed, fee 0.05%/side

| symbol | trades | TP hit | forced | forced green | TP% | NET $ | avg $/trade |
|--------|-------:|-------:|-------:|-------------:|----:|------:|------------:|
| TAOUSDT | 365 | 199 | 166 | 26 | 55% | -$62.78 | -$0.17 |
| BNBUSDT | 364 | 83 | 281 | 96 | 23% | -$94.60 | -$0.26 |
| POLUSDT | 365 | 169 | 196 | 45 | 46% | -$34.89 | -$0.10 |
| XRPUSDT | 364 | 128 | 236 | 61 | 35% | -$96.91 | -$0.27 |
| SOLUSDT | 365 | 155 | 210 | 49 | 42% | -$47.61 | -$0.13 |
| SUIUSDT | 364 | 182 | 182 | 25 | 50% | -$127.22 | -$0.35 |
| ARBUSDT | 364 | 192 | 172 | 24 | 53% | -$108.58 | -$0.30 |
| **TOTAL** | **2551** | **1108** | **1443** | **326** | **43.4%** | **-$572.58** | **-$0.22** |

## Variant — force-close @ 08:00 UTC (15:00 VN)

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-long-fomo-2300-altcoin-backtest.ts 365 0.05 100 2 8
```

Holding window 23:00 → 08:00 = 9h (ngắn hơn → ít TP-hit hơn nhưng đuôi giảm cũng nhỏ hơn).

| symbol | trades | TP hit | forced | forced green | TP% | NET $ | avg $/trade |
|--------|-------:|-------:|-------:|-------------:|----:|------:|------------:|
| TAOUSDT | 365 | 151 | 214 | 60 | 41% | -$51.16 | -$0.14 |
| BNBUSDT | 365 | 49 | 316 | 151 | 13% | -$50.17 | -$0.14 |
| POLUSDT | 365 | 117 | 248 | 102 | 32% | **+$15.62** | +$0.04 |
| XRPUSDT | 365 | 71 | 294 | 109 | 19% | -$62.71 | -$0.17 |
| SOLUSDT | 365 | 95 | 270 | 107 | 26% | -$13.67 | -$0.04 |
| SUIUSDT | 365 | 121 | 244 | 78 | 33% | -$85.65 | -$0.23 |
| ARBUSDT | 365 | 141 | 224 | 60 | 39% | -$67.06 | -$0.18 |
| **TOTAL** | **2555** | **745** | **1810** | **667** | **29.2%** | **-$314.80** | **-$0.12** |

Đóng sớm hơn (08:00 UTC) **giảm lỗ gần một nửa** (-$314.80 vs -$572.58) — cửa sổ ngắn cắt bớt đuôi giảm của phiên Mỹ. POL nhích lên dương nhẹ, SOL ~hòa vốn. Nhưng tổng vẫn âm; edge không tồn tại.

## Entry-hour sweep — 00:00 / 01:00 / 02:00 UTC (exit 08:00 UTC, TP +2%)

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-long-fomo-2300-altcoin-backtest.ts 365 0.05 100 2 8 0-2
```

**TOTAL net theo giờ vào lệnh (7 altcoin, 365d):**

| entry UTC | entry VN | trades | TP% | NET $ | avg/lệnh |
|-----------|----------|-------:|----:|------:|---------:|
| **00:00** | 07:00 | 2555 | 28.9% | **-$100.16** | -$0.04 |
| 01:00 | 08:00 | 2555 | 24.9% | -$174.76 | -$0.07 |
| 02:00 | 09:00 | 2555 | 20.6% | -$265.69 | -$0.10 |

**Per-symbol @ entry 00:00 UTC (tốt nhất):**

| symbol | TP% | NET $ |
|--------|----:|------:|
| TAOUSDT | 44% | -$0.02 (hòa) |
| BNBUSDT | 14% | -$24.34 |
| POLUSDT | 29% | **+$27.25** |
| XRPUSDT | 19% | -$16.18 |
| SOLUSDT | 25% | -$15.62 |
| SUIUSDT | 32% | -$43.89 |
| ARBUSDT | 39% | -$27.35 |

**Vào lệnh sớm thắng rõ rệt:** entry 00:00 UTC gần hòa vốn (-$100), càng vào muộn (01:00, 02:00) càng âm sâu vì TP-hit rate tụt nhanh (28.9% → 24.9% → 20.6%) — đà tăng tập trung ngay đầu ngày UTC. POL dương ổn ở 00:00 & 01:00, TAO hòa vốn ở 00:00. Dù vậy tổng vẫn âm → vẫn chưa có edge dương net of fee.

## Takeaway
Chiến lược **thua lỗ trên cả 7 altcoin** trong 1 năm — tổng NET **-$572.58** (≈ -0.22$/lệnh, tức -0.22% mỗi lệnh trên vốn $100). Vấn đề cốt lõi giống các test long FOMO trước: **TP +2% cố định + không có stop-loss** tạo payoff bất đối xứng — thắng thì chốt +2% nhưng các lệnh forced-close ôm trọn đuôi giảm (chỉ 326/1443 lệnh forced là xanh). Ngay cả TAO/ARB/SUI có TP-hit rate >50% vẫn âm vì vài lệnh forced lỗ sâu nuốt hết lợi nhuận, cộng fee 0.1%/vòng × 2551 lệnh ≈ -$255 drag. Khung 23:00 UTC (qua đêm sang phiên Âu/đầu phiên Mỹ) không tạo edge tăng giá đủ lớn. **Không nên trade live ở cấu hình này.** Nếu muốn cứu, hướng tiếp theo là thêm stop-loss (cắt đuôi forced) hoặc filter xu hướng (chỉ long khi 1D bullish) — nhưng bản gốc không có edge.
