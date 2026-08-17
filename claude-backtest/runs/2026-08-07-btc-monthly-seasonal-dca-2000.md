# BTC — DCA theo tháng $2,000, chốt lời ≥5% trên giá trung bình (mùa 2022 → nay)

**Date:** 2026-08-07
**Symbol:** BTC/USD (Bitstamp daily, public API) · **Giai đoạn chính:** 2022-01-01 → 2026-08-07 (4.60y)
**OOS đối chứng:** 2017-01-01 → 2021-12-31 (5.00y)
**Yêu cầu user:** dựa vào thống kê BTC performance theo tháng (coinglass.com/today), xây chiến lược
DCA BTC theo tháng, vốn $2,000, target chỉ cần lãi ≥5%. Chỉ backtest mùa gần nhất (2022 → nay).

> Bảng monthly returns trên coinglass là chart JS, WebFetch không lấy được số. Đã dựng lại bảng
> từ dữ liệu gốc Bitstamp BTC/USD daily → monthly candle (open ngày đầu, close ngày cuối tháng),
> nên mọi con số dưới đây tái lập được.

## Commands

```bash
# 1. bảng seasonality theo tháng
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-monthly-seasonality.ts 2022

# 2. quét cycle DCA (số tranche x TP x dip-gate) + benchmark B&H
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-monthly-dca-2000-sweep.ts 2022-01-01 2000 0.05

# 3. kế hoạch lịch mùa vụ (bộ tháng mua x TP x cỡ lệnh) — script cho ra chiến lược cuối
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-seasonal-calendar-dca.ts 2022-01-01 2000 0.05

# 4. trade log của config được chọn
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-seasonal-calendar-dca.ts 2022-01-01 2000 0.05 "May/Jun/Aug/Dec|6|2"

# 5. out-of-sample 2017–2021
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-seasonal-calendar-dca.ts 2017-01-01 2000 0.05 "" 2022-01-01
```

## Seasonality BTC 2022 → 2026 (return % theo tháng)

| year | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec | YEAR |
|------|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|------|
| 2022 | -16.7 | 12.2 | 5.3 | -17.3 | -15.6 | -37.3 | 16.8 | -13.9 | -3.1 | 5.6 | -16.2 | -3.7 | -64.2 |
| 2023 | 39.9 | 0.0 | 23.0 | 2.7 | -7.0 | 11.9 | -4.1 | -11.3 | 4.0 | 28.5 | 8.8 | 12.0 | 155.6 |
| 2024 | 0.7 | 43.7 | 16.6 | -15.0 | 11.3 | -7.2 | 3.1 | -8.7 | 7.4 | 10.9 | 37.4 | -3.2 | 121.0 |
| 2025 | 9.7 | -17.7 | -2.1 | 14.1 | 11.1 | 2.4 | 8.0 | -6.5 | 5.4 | -4.0 | -17.5 | -3.2 | -6.3 |
| 2026 | -10.1 | -14.8 | 1.8 | 11.9 | -3.6 | -20.4 | 7.3 | 2.5 | — | — | — | — | -26.4 |

| tháng | n | mean% | median% | win% |
|-------|---|-------|---------|------|
| Jan | 5 | 4.69 | 0.71 | 60 |
| Feb | 5 | 4.69 | 0.01 | 60 |
| **Mar** | 5 | **8.92** | 5.31 | **80** |
| Apr | 5 | -0.73 | 2.67 | 60 |
| **May** | 5 | **-0.74** | **-3.59** | 40 |
| **Jun** | 5 | **-10.11** | **-7.16** | 40 |
| **Jul** | 5 | **6.24** | 7.33 | **80** |
| **Aug** | 5 | **-7.57** | **-8.74** | **20** |
| Sep | 4 | 3.40 | 4.68 | 75 |
| **Oct** | 4 | **10.26** | 8.23 | 75 |
| Nov | 4 | 3.12 | -3.71 | 50 |
| Dec | 4 | 0.47 | -3.19 | 25 |

Tháng yếu (mua): **Jun, Aug, May** — Aug chỉ 20% win (4/5 năm âm), Jun mean -10.1%.
Tháng mạnh (bán vào): **Oct, Mar, Jul**. Dec mean +0.5% nhưng median -3.2%, 25% win → cũng là điểm mua.

## Luật test

Một chu kỳ: mua 1 tranche tại **open ngày 1** của các tháng đã lên lịch → gom tiếp tháng lịch kế
nếu chưa chốt → **bán sạch khi high chạm avgCost × (1+TP)** → chờ tháng lịch kế mở chu kỳ mới.
Không SL. Spot. Fee 0.05%/side. Vốn compound: `tranche = vốn hiện tại / div`.

## Kết quả 2022-01-01 → 2026-08-07

**Benchmark BUY & HOLD: $2,000 → $2,782 (+39.1%, 7.4%/yr, maxDD -67.9%)**

| tháng mua | div (tranche) | TP% | equity | total% | %/yr | lệnh | med ngày | max ngày | eqMaxDD |
|-----------|------|-----|--------|--------|------|------|----------|----------|---------|
| May/Jun/Aug/Dec | 2 ($1,000) | **6** | **$3,026** | **+51.3** | **9.4** | 14 | 12 | 292 | **-42.6** |
| May/Jun/Aug/Sep | 2 ($1,000) | 6 | $3,021 | +51.1 | 9.4 | 12 | 12 | 292 | -42.6 |
| May/Jun/Aug/Dec | 2 ($1,000) | 5 | $2,801 | +40.1 | 7.6 | 14 | 8 | 291 | -42.8 |
| May/Jun/Aug/Sep | 2 ($1,000) | 5 | $2,798 | +39.9 | 7.6 | 12 | 9 | 291 | -42.8 |
| Apr..Aug (5) | 2 ($1,000) | 8 | $3,253 | +62.7 | 11.2 | 9 | 39 | 616 | -63.2 |
| May/Jun/Aug/Dec | 4 ($500) | 6 | $2,502 | +25.1 | 5.0 | 14 | 12 | 246 | **-21.3** |
| May/Jun/Aug/Dec | 4 ($500) | 5 | $2,400 | +20.0 | 4.0 | 14 | 8 | 238 | -21.5 |
| all 12 months | 4 ($500) | 5 | $2,082 | +4.1 | 0.9 | 23 | 8 | 570 | -50.2 |
| all 12 months | 12 ($167) | 5 | $2,130 | +6.5 | 1.4 | 28 | 10 | 299 | -25.3 |

Thêm từ script `run-btc-monthly-dca-2000-sweep.ts` (cycle model, không compound):
- **dip-gate (chỉ gom thêm khi giá < avg cost) không giúp gì** — mọi ô đều bằng hoặc kém hơn.
- Ở mọi số tranche, **TP 5% cho tổng lợi nhuận thấp nhất**, TP 8–10% luôn cao hơn 2–4×.

## Trade log — May/Jun/Aug/Dec · TP 6% · $1,000/tranche

| type | date | price | usd | avgCost | #buys | held | profit |
|------|------|-------|-----|---------|-------|------|--------|
| BUY | 2022-05-01 | 37,639 | $1,000 | 37,658 | 1 | | |
| SELL | 2022-05-04 | 39,917 | $1,059 | | 1 | 3 | +$59 |
| BUY | 2022-06-01 | 31,777 | $1,030 | 31,793 | 1 | | |
| BUY | 2022-08-01 | 23,287 | $1,030 | 26,891 | 2 | | |
| SELL | 2023-03-20 | 28,505 | $2,182 | | 2 | **292** | +$122 |
| BUY | 2023-05-01 | 29,254 | $1,091 | 29,269 | 1 | | |
| BUY | 2023-06-01 | 27,220 | $1,091 | 28,214 | 2 | | |
| SELL | 2023-06-21 | 29,907 | $2,312 | | 2 | 51 | +$130 |
| BUY | 2023-08-01 | 29,221 | $1,156 | 29,236 | 1 | | |
| SELL | 2023-10-23 | 30,990 | $1,225 | | 1 | 83 | +$69 |
| BUY | 2023-12-01 | 37,731 | $1,190 | 37,750 | 1 | | |
| SELL | 2023-12-03 | 40,015 | $1,261 | | 1 | 2 | +$71 |
| BUY | 2024-05-01 | 60,611 | $1,226 | 60,641 | 1 | | |
| SELL | 2024-05-04 | 64,280 | $1,299 | | 1 | 3 | +$73 |
| BUY | 2024-06-01 | 67,513 | $1,262 | 67,547 | 1 | | |
| SELL | 2024-06-05 | 71,600 | $1,337 | | 1 | 4 | +$75 |
| BUY | 2024-08-01 | 64,612 | $1,300 | 64,644 | 1 | | |
| SELL | 2024-10-18 | 68,523 | $1,377 | | 1 | 78 | +$77 |
| BUY | 2024-12-01 | 96,471 | $1,338 | 96,519 | 1 | | |
| SELL | 2024-12-05 | 102,310 | $1,418 | | 1 | 4 | +$80 |
| BUY | 2025-05-01 | 94,181 | $1,378 | 94,228 | 1 | | |
| SELL | 2025-05-08 | 99,882 | $1,460 | | 1 | 7 | +$82 |
| BUY | 2025-06-01 | 104,646 | $1,419 | 104,698 | 1 | | |
| SELL | 2025-07-09 | 110,980 | $1,503 | | 1 | 38 | +$84 |
| BUY | 2025-08-01 | 115,749 | $1,461 | 115,807 | 1 | | |
| SELL | 2025-08-13 | 122,755 | $1,548 | | 1 | 12 | +$87 |
| BUY | 2025-12-01 | 90,369 | $1,505 | 90,414 | 1 | | |
| SELL | 2026-01-13 | 95,839 | $1,594 | | 1 | 43 | +$89 |
| BUY | 2026-05-01 | 76,310 | $1,549 | 76,348 | 1 | | |
| SELL | 2026-05-05 | 80,929 | $1,642 | | 1 | 4 | +$92 |
| BUY | 2026-06-01 | 73,568 | $1,595 | 73,605 | 1 | | |
| BUY | 2026-08-01 | 62,818 | $1,595 | **67,803** | 2 | | |

**Trạng thái hiện tại (2026-08-07):** đang ôm 2 tranche, vốn vào $3,191, avgCost **67,803**,
lệnh bán chờ tại **71,871** (+6%). Giá 64,351 → đang -5.1%. Equity $3,026.

**14/14 lệnh đã đóng đều thắng** (không có lệnh lỗ vì không có SL) — cái giá là 1 lần phải ôm
292 ngày (2022-08 → 2023-03) và equity drawdown -42.6%.

## Out-of-sample 2017–2021 — chỗ chiến lược gãy

**B&H: $2,000 → $95,600 (+4,680%, 116.8%/yr, maxDD -84.1%)**

| tháng mua | div | TP% | equity | total% | %/yr | eqMaxDD |
|-----------|-----|-----|--------|--------|------|---------|
| May/Jun/Aug/Sep | 2 | 6 | $3,383 | +69.2 | 11.1 | -59.0 |
| May/Jun/Aug/Dec | 2 | 6 | $3,061 | +53.1 | 8.9 | -42.6 |
| **all 12 months** | 2 | 6 | **$7,349** | **+267.4** | **29.8** | -58.5 |
| all 12 months | 2 | 10 | $14,387 | +619.4 | 48.4 | -63.7 |

Trong bull market 2017–2021 bộ lọc mùa vụ **thua đậm** DCA đều 12 tháng (+53% vs +267%), và cả hai
đều thua xa B&H. Bộ tháng May/Jun/Aug/Dec là sản phẩm của regime đi ngang 2022–2026, **không phải
quy luật bền**.

## Takeaway

Với đúng ràng buộc user đưa ra (vốn $2,000, DCA theo tháng, chỉ cần ≥5%), config tốt nhất giai đoạn
2022→nay là **mua ngày 1 của May / Jun / Aug / Dec, mỗi lần 50% vốn (tối đa 2 lệnh/chu kỳ),
bán sạch khi chạm avgCost × 1.06**: $2,000 → $3,026 (+51.3%, 9.4%/yr) so với B&H +39.1%, và
drawdown -42.6% so với -67.9% của B&H. Median 12 ngày là chạm target, 14/14 lệnh thắng.

Hai điều chỉnh quan trọng so với đề bài:

1. **TP 5% là mức tệ nhất trong mọi mức đã quét.** Ở TP 5% cùng config chỉ ra $2,801 (+40.1%) —
   ngang B&H. Nâng lên **6%** thêm +$225 mà median chờ chỉ tăng từ 8 lên 12 ngày. Lý do: 5% chạm
   quá nhanh nên phần lớn thời gian vốn nằm không, trong khi chu kỳ lỗ dài (292 ngày) thì mức TP
   nào cũng phải ôm như nhau. Đây là đúng hiệu ứng đã thấy ở
   [`2026-08-04-eth-daily-dca-tp-sweep-8-10-15.md`](./2026-08-04-eth-daily-dca-tp-sweep-8-10-15.md).
2. **Lọc mùa vụ chỉ ăn được trong regime đi ngang.** OOS 2017–2021 nó thua DCA đều 5×. Nếu BTC vào
   bull run trở lại, luật này sẽ bỏ lỡ phần lớn con sóng — cần định kỳ kiểm lại bảng seasonality,
   đừng coi May/Jun/Aug/Dec là hằng số.

Rủi ro chưa xử lý: luật không có cơ chế cho chu kỳ **không bao giờ đóng**. Ở 2022 nó thoát được sau
292 ngày, nhưng nếu BTC giảm sâu và không hồi 6% trên giá trung bình, $2,000 sẽ bị khoá vô hạn —
đúng vấn đề cấu trúc đã ghi ở run ETH ngày 2026-08-04.

**Đã test tiếp** ở [`2026-08-07-btc-seasonal-dca-exit-rules.md`](./2026-08-07-btc-seasonal-dca-exit-rules.md):
trần thời gian giữ, TP giảm dần theo tháng và chốt từng phần — **cả ba đều kém baseline TP 6%** ở
cả 2022–26 lẫn OOS 2017–21. Trần thời gian là tệ nhất (cap 180d ép bán 2022-11-28, cách đáy 7 ngày).
Rủi ro cấu trúc vẫn còn nguyên; cách kiểm soát là cỡ vị thế, không phải luật thoát.
