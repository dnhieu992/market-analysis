# LONG FOMO + M30 UTBot trend FILTER — altcoin, TP +2%, force-close 08:00 UTC

## Strategy
- **Trend gate:** M30 UTBot (Wilder ATR trailing stop). At entry time, đọc trend của cây M30 đã đóng gần nhất.
  - **bull** (close > stop) → vào LONG.
  - **bear** → **bỏ qua** (long-only; UTBot là bộ lọc, không đảo chiều short).
- **Entry:** open cây 00:00 UTC (07:00 giờ VN).
- **TP:** +2% intra-candle. **Không stop-loss.**
- **Force close:** 08:00 UTC (15:00 giờ VN) = open cây 08:00.
- **Size:** $100/lệnh cố định, không nén lãi. **Fee:** 0.05%/side.
- **Symbols:** TAO, BNB, POL, XRP, SOL, SUI, ARB.

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-long-fomo-m30utbot-filter-backtest.ts 365 0.05 100 2 8 <kv> 10 0
```

## keyValue sweep (UTBot ATR multiplier), 365d, TOTAL 7 altcoin

| kv | trades taken / signals | skipped bear | winRate | GROSS $ | NET $ | net/trade |
|----|-----------------------:|-------------:|--------:|--------:|------:|----------:|
| **1** | 1267 / 2555 | 1288 | **59.4%** | +$193.13 | **+$66.27** | +$0.05 |
| 2 | 1242 / 2555 | 1313 | 57.3% | +$166.33 | +$42.00 | +$0.03 |
| 3 | 1175 / 2555 | 1380 | 55.1% | +$97.18 | -$20.39 | -$0.02 |
| 4 | 1166 / 2555 | 1389 | 52.7% | +$89.95 | -$26.71 | -$0.02 |

**kv=1 tốt nhất** — UTBot nhạy (stop sát giá) → bắt trend đảo nhanh, lọc chính xác hơn. kv càng lớn → win rate & net giảm dần.

## Per-symbol @ kv=1 (best), ATR10, 365d

| symbol | trades | skip | winRate | GROSS $ | NET $ | net/trade |
|--------|-------:|-----:|--------:|--------:|------:|----------:|
| TAOUSDT | 174 | 191 | 61.5% | +$22.34 | +$4.92 | +$0.03 |
| BNBUSDT | 204 | 161 | 57.4% | +$14.73 | -$5.68 | -$0.03 |
| POLUSDT | 203 | 162 | 61.6% | +$58.93 | **+$38.58** | +$0.19 |
| XRPUSDT | 164 | 201 | 62.8% | +$51.53 | **+$35.08** | +$0.21 |
| SOLUSDT | 184 | 181 | 58.7% | +$32.83 | +$14.40 | +$0.08 |
| SUIUSDT | 173 | 192 | 57.8% | +$10.07 | -$7.23 | -$0.04 |
| ARBUSDT | 165 | 200 | 56.4% | +$2.70 | -$13.80 | -$0.08 |
| **TOTAL** | **1267** | **1288** | **59.4%** | **+$193.13** | **+$66.27** | **+$0.05** |

## Rổ lọc 4 mã dương — POL + XRP + SOL + TAO (kv=1)

```bash
SYMBOLS=POLUSDT,XRPUSDT,SOLUSDT,TAOUSDT TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node \
  --project apps/api/tsconfig.json \
  scripts/run-long-fomo-m30utbot-filter-backtest.ts 365 0.05 100 2 8 1 10 0
```

| symbol | trades | skip | winRate | GROSS $ | NET $ | net/trade | % trên $100/mã |
|--------|-------:|-----:|--------:|--------:|------:|----------:|---------------:|
| POLUSDT | 203 | 162 | 61.6% | +$58.93 | +$38.58 | +$0.19 | +38.6% |
| XRPUSDT | 164 | 201 | 62.8% | +$51.53 | +$35.08 | +$0.21 | +35.1% |
| SOLUSDT | 184 | 181 | 58.7% | +$32.83 | +$14.40 | +$0.08 | +14.4% |
| TAOUSDT | 174 | 191 | 61.5% | +$22.34 | +$4.92 | +$0.03 | +4.9% |
| **TOTAL** | **725** | **735** | **61.1%** | **+$165.63** | **+$92.98** | **+$0.13** | — |

**Trên vốn rổ $400** (4 × $100, mở đồng thời mỗi sáng): NET +$92.98 = **+23.2%/năm**. Win rate 61.1%, +$0.13/lệnh — gấp ~2.6× edge của rổ 7 mã (+$0.05/lệnh). Bỏ 3 mã âm (BNB/SUI/ARB) nâng cả win rate lẫn net/trade rõ rệt.

## Thêm lệnh SHORT (clock: bull→long / bear→short) — rổ 4 mã, kv=1

```bash
SYMBOLS=POLUSDT,XRPUSDT,SOLUSDT,TAOUSDT TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node \
  --project apps/api/tsconfig.json \
  scripts/run-m30-utbot-clock-backtest.ts 365 0.05 100 2 8 1 10 2
```

| symbol | trades | L / S | winRate | GROSS $ | fees | NET $ | net/trade |
|--------|-------:|------:|--------:|--------:|-----:|------:|----------:|
| POLUSDT | 365 | 203/162 | 57.8% | +$80.58 | -$36.57 | +$44.01 | +$0.12 |
| XRPUSDT | 365 | 164/201 | 60.5% | +$90.89 | -$36.58 | +$54.31 | +$0.15 |
| SOLUSDT | 365 | 184/181 | 56.4% | +$39.31 | -$36.53 | +$2.78 | +$0.01 |
| TAOUSDT | 365 | 174/191 | 58.6% | +$23.16 | -$36.51 | -$13.36 | -$0.04 |
| **TOTAL** | **1460** | **725/735** | **58.4%** | **+$233.94** | **-$146.19** | **+$87.74** | **+$0.06** |

**Thêm short KHÔNG cải thiện — còn hơi tệ hơn.** Long-only NET +$92.98 (725 lệnh); long+short NET +$87.74 (1460 lệnh). Phần short đóng góp ≈ **-$5.24 net** — gross của short có dương nhưng số lệnh gấp đôi → fee gấp đôi ($146 vs $73) nuốt hết. Alt có xu hướng trôi lên nên short những sáng bear-trend không có edge sau phí. Net/lệnh tụt từ +$0.13 → +$0.06, win rate 61.1% → 58.4%.

## Takeaway
**Bộ lọc M30 UTBot lật chiến lược từ âm sang dương.** Bản long-mọi-ngày (entry 00:00, exit 08:00) là -$100.16; thêm gate "chỉ long khi M30 UTBot bull" → **+$66.27** ở kv=1, win rate 59.4%. Filter bỏ ~half số ngày (1288/2555 bị skip vì bear) — tránh đúng những ngày giảm. POL (+$38.58) và XRP (+$35.08) gánh phần lớn lợi nhuận; SOL/TAO dương nhẹ; BNB/SUI/ARB vẫn âm nhỏ. Edge dương nhưng mỏng (+0.05$/lệnh ≈ +0.05%/lệnh), chưa tính slippage/funding — **chưa đủ dày để trade live tự tin trên cả rổ**. Hướng nâng cấp: chỉ trade POL+XRP+SOL+TAO (4 mã dương), hoặc kết hợp lọc thêm + thêm stop để cắt đuôi forced (883/1267 lệnh là forced-close).
