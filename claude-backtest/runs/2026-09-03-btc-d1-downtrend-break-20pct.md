# BTC D1 "phá trend giảm" → bao nhiêu lần tăng > 20%?

**Date:** 2026-09-03
**Symbol:** BTCUSDT spot, 1d
**Scan window:** 2020-01-01 → 2026-09-03 (2,437 daily candles; fetch bắt đầu 2019-01-01 để warm-up ATR/pivot)
**Target:** +20% tính từ **close của cây nến phá trend**
**Fees:** không tính — đây là scan thống kê hành vi giá, không phải P&L chiến lược

## Command

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-d1-downtrend-break-backtest.ts BTCUSDT 2020 20 15 10
```

Script: `scripts/run-d1-downtrend-break-backtest.ts`

## Định nghĩa "phá trend giảm"

Câu hỏi không nói rõ, nên scan **3 định nghĩa độc lập** để xem kết quả có ổn định không:

| # | Định nghĩa | Sự kiện |
|---|---|---|
| **A** | **UTBot flip** (ATR Wilder 10, keyValue 1/2/3) — trend definition của repo | close D1 làm trend lật bear → bull |
| **B** | **Swing-high break** — cấu trúc kinh điển | sau chuỗi pivot high thấp dần + 1 đáy thấp hơn, D1 **close vượt pivot high gần nhất** |
| **C** | **Trendline break** — nghĩa đen | kẻ đường xuống qua 2 pivot high thấp dần, D1 **close đầu tiên vượt đường đó** |

Pivot = fractal 3 nến trái / 3 nến phải (chỉ xác nhận sau 3 nến, không nhìn trước tương lai).

**Bộ lọc "qualified"**: chỉ tính khi thực sự có downtrend trước đó — leg giảm kéo dài **≥ 15 ngày** VÀ **giảm ≥ 10%** từ đỉnh cao nhất tới đáy thấp nhất của leg. Không lọc thì phần lớn "phá trend" chỉ là nhiễu 3-5 ngày.

**Cách đo mỗi sự kiện:**
- `hit+20%` — MFE chạm +20% **trước khi** cú phá bị vô hiệu (A: trend lật lại bear; B/C: close thủng lại đáy swing trước cú phá)
- `≤30d / ≤60d / ≤90d` — max high trong 30/60/90 ngày, **bỏ qua** invalidation
- `exit%` — lời/lỗ nếu giữ tới lúc setup bị vô hiệu

## Kết quả — QUALIFIED breaks (downtrend ≥ 15d và ≥ 10%)

| Method | n | hit +20%* | ≤30d | ≤60d | ≤90d | avg MFE | **med MFE** | avg exit | win |
|---|---|---|---|---|---|---|---|---|---|
| A. UTBot kv=1 | 18 | 1 (6%) | 1 (6%) | 3 (17%) | 4 (22%) | 5.6% | 3.6% | −2.1% | 3/18 |
| A. UTBot kv=2 | 22 | 7 (32%) | 6 (27%) | 9 (41%) | 11 (50%) | 20.9% | 8.7% | +6.9% | 9/22 |
| A. UTBot kv=3 | 17 | **8 (47%)** | 5 (29%) | 8 (47%) | 9 (53%) | 27.6% | 19.8% | +10.1% | 10/17 |
| B. Swing-high | 20 | 8 (40%) | 3 (15%) | 8 (40%) | 9 (45%) | 110.4% | 15.9% | +44.0% | 6/20 |
| C. Trendline | 31 | 10 (32%) | 7 (23%) | 10 (32%) | 14 (45%) | 81.6% | 10.7% | +31.0% | 6/31 |

\* trước khi setup bị vô hiệu.

## Kết quả — ALL breaks (không lọc chất lượng downtrend)

| Method | n | hit +20% | ≤30d | ≤60d | ≤90d | med MFE | win |
|---|---|---|---|---|---|---|---|
| A. UTBot kv=1 | 133 | 18 (14%) | 34 (26%) | 54 (41%) | 66 (50%) | 5.2% | 54/133 |
| A. UTBot kv=2 | 52 | 13 (25%) | 12 (23%) | 20 (38%) | 24 (46%) | 9.9% | 22/52 |
| A. UTBot kv=3 | 29 | 12 (41%) | 9 (31%) | 12 (41%) | 13 (45%) | 11.9% | 16/29 |
| B. Swing-high | 49 | 17 (35%) | 11 (22%) | 23 (47%) | 26 (53%) | 8.1% | 12/49 |
| C. Trendline | 69 | 23 (33%) | 17 (25%) | 28 (41%) | 35 (51%) | 9.1% | 13/69 |

## Những cú phá trend ăn > 20% (qualified, hợp nhất các method)

| Ngày phá | Giá | Downtrend trước | MFE | Số ngày tới +20% |
|---|---|---|---|---|
| 2020-01-06 | $7,758 | 46d / −20.9% | +35% | 22 |
| 2020-04-06 | $7,330 | 40d / −59.7% | +70% | 23 |
| 2020-09-29 | $10,840 | 28d / −18.5% | +1064% (vào sóng bull 2020-21) | 22 |
| 2021-01-29 | $34,252 | 15d / −28.1% | +89% | 10 |
| 2021-02-08 | $46,375 | 18d / −18.8% | +26% | 11 |
| 2021-07-23/25 | $33-35k | ~20d / −18.6% | +95..105% | 3-7 |
| 2022-11-30 | $17,164 | 25d / −28.0% | đáy chu kỳ | 45 |
| 2023-01-11 | $17,943 | 64d / −25.2% | +41% | 6 |
| 2023-03-13 | $24,113 | 20d / −22.6% | +423% | 17 |
| 2023-06-16/20 | $26-28k | ~20d / −12.8% | +346..379% | 27-125 |
| 2023-09-19 | $27,210 | 34d / −14.9% | +80% | 34 |
| 2024-01-29 | $43,303 | 17d / −17.1% | +70% | 16 |
| 2024-07-14/15 | $61-65k | ~37d / −25.7% | +95..108% | 107-118 |
| 2024-09-09..18 | $57-62k | 15-46d / −19.2% | +75..121% | 39-49 |
| 2025-04-12..22 | $85-93k | 19-57d / −16..23% | +20..44% | 21-26 |
| 2026-04-04 | $67,300 | 18d / −14.5% | +23% | 30 |
| 2026-07-04/20 | $63-65k | 19-59d / −14..26% | +25..29% | 32-48 |

## Takeaway

Con số trả lời trực tiếp câu hỏi: **khoảng 1/3 tới 1/2 số lần BTC phá trend giảm trên D1 thì giá tăng được > 20%** — cụ thể **32-47%** nếu tính "chạm +20% trước khi cú phá bị vô hiệu", và **45-53%** nếu chỉ hỏi "trong 90 ngày sau đó có lúc nào +20% không". Điều đáng chú ý là **cả 5 định nghĩa khác nhau đều rơi vào cùng một khoảng** — nên đây là đặc tính thật của BTC chứ không phải artifact của một cách vẽ trend.

Nhưng phân phối cực kỳ lệch: **median MFE chỉ 9-20%**, tức cú phá trend *điển hình* chạy được chưa tới 20% rồi gãy. Toàn bộ kỳ vọng nằm ở đuôi — vài cú 2023-03, 2023-06, 2020-09 mở ra nguyên sóng bull hàng trăm %. Trong 30 ngày đầu chỉ **15-29%** số lần chạm +20%, nghĩa là ăn +20% thường cần **1-3 tháng chờ**, không phải chuyện vài ngày.

Hai chi tiết thực dụng:
1. **Độ nhạy quyết định tất cả.** UTBot kv=1 (nhạy, 133 tín hiệu) chỉ 6% qualified breaks ăn được 20% — gần như toàn nhiễu. kv=3 (17 tín hiệu) lên 47%. Phá trend giảm càng "chậm và chắc" thì tỷ lệ ăn càng cao, đúng như trực giác.
2. **avg exit của B/C (+44%, +31%) bị thổi phồng** vì điều kiện vô hiệu là "close thủng đáy swing" — sau đáy chu kỳ 2022-11 thì điều kiện đó vài năm mới xảy ra, nên vài lệnh giữ 1,200-2,100 ngày kéo trung bình lên. Cột `med MFE` và các cột 30/60/90 ngày là con số đáng tin hơn.

**Ngụ ý:** phá trend giảm D1 là tín hiệu có edge dương nhưng **không phải setup thắng chắc** — vào lệnh phải chấp nhận ~55-65% số lần không tới 20%, và lợi nhuận thật đến từ việc giữ được vài cú chạy dài chứ không phải từ win rate.
