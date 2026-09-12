# BTC D1 cách đường UTBot giảm bao nhiêu % thì có cú hồi?

**Date:** 2026-09-03
**Symbol:** BTCUSDT spot, 1d
**Window:** 2020-01-01 → 2026-09-03 (2,438 nến)
**Indicator:** UTBot = Wilder ATR(10) trailing stop, keyValue 1 / 2 / 3
**Đo:** `gap% = (stop − close) / close × 100`, chỉ tính nến trong xu hướng BEAR (đường nằm TRÊN giá)

Đây là scan thống kê, không phải chiến lược — không tính phí.

## Command

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-utbot-gap-bounce-stats.ts BTCUSDT 2020 "1,2,3"
```

Script: `scripts/run-utbot-gap-bounce-stats.ts`

## 1. Phát hiện cơ học phải biết trước khi đọc mọi con số

Trong bear, công thức là `stop = min(stop_trước, close + kv × ATR)`. Nên khi giá tạo đáy mới,
gap **đúng bằng** `kv × ATR`. Đo thực tế xác nhận: gap lớn nhất trong 6.7 năm là

| keyValue | gap max (%) | gap max (ATR) |
|---|---|---|
| 1 | 16.41% | **1.00 ATR** |
| 2 | 32.82% | **2.00 ATR** |
| 3 | 49.24% | **3.00 ATR** |

**Gap% không phải chỉ báo độc lập — nó là `kv × ATR%` trá hình.** Hỏi "giá cách đường bao nhiêu %"
về bản chất là hỏi "biến động đang nở tới đâu". Mọi kết luận bên dưới phải đọc qua lăng kính đó.

## 2. Phân phối gap% trong bear

| kv | % thời gian bear | p10 | p25 | **median** | p75 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 47% | 1.04% | 2.08% | **3.20%** | 4.60% | 6.01% | 7.25% | 10.87% | 16.41% |
| 2 | 50% | 2.40% | 4.03% | **6.32%** | 8.92% | 12.36% | 15.95% | 21.74% | 32.82% |
| 3 | 48% | 3.55% | 6.44% | **9.85%** | 13.90% | 19.50% | 23.60% | 34.95% | 49.24% |

## 3. Theo khoảng gap: giá làm gì sau đó

Cửa sổ forward chồng lấn (mỗi nến một quan sát) → đọc như phân phối có điều kiện, không phải chuỗi lệnh.

### keyValue = 2

| gap% | nến | MFE 5d | MFE 10d | MFE 20d | P(hồi ≥5% / 10d) | P(hồi ≥10% / 20d) | P(lật bull / 20d) |
|---|---|---|---|---|---|---|---|
| 0-2% | 88 | 4.7% | 7.0% | 11.9% | 45% | 49% | 86% |
| 2-4% | 211 | 4.0% | 6.2% | 11.3% | 43% | 41% | 76% |
| 4-6% | 257 | 4.2% | 6.6% | 9.6% | 47% | 38% | 69% |
| 6-8% | 250 | 4.8% | 7.4% | 10.7% | 58% | 39% | 66% |
| 8-12% | 281 | 5.3% | 7.8% | 11.6% | 57% | 38% | 49% |
| **≥12%** | 135 | **9.3%** | **12.0%** | **18.0%** | **82%** | **67%** | 55% |

### keyValue = 1

| gap% | nến | MFE 10d | P(hồi ≥5% / 10d) | P(hồi ≥10% / 20d) |
|---|---|---|---|---|
| 2-4% | 473 | 6.2% | 47% | 29% |
| 4-6% | 288 | 8.0% | 56% | 43% |
| **6-8%** | 76 | **11.9%** | **91%** | **76%** |
| ≥8% | 39 | 12.0-18.6% | 76-100% | 58-83% |

### keyValue = 3

| gap% | nến | MFE 10d | P(hồi ≥5% / 10d) | P(hồi ≥10% / 20d) |
|---|---|---|---|---|
| 4-6% | 109 | 6.7% | 54% | 39% |
| 6-8% | 158 | 5.1% | 38% | 36% |
| 8-12% | 330 | 6.8% | 51% | 38% |
| ≥12% | 428 | 9.5% | 67% | 45% |

kv=3 phân tách kém nhất — gần như không có ngưỡng nào tách bạch.

## 4. Gap tại ĐÁY khởi đầu cú hồi (zigzag, cú hồi đo tối đa 30 ngày)

| kv | ngưỡng hồi | số cú | gap tại đáy p25 | **median** | p75 | p90 | hồi med / p90 | % chạm lại đường |
|---|---|---|---|---|---|---|---|---|
| 1 | ≥5% | 499 | 2.85% | **4.26%** | 5.60% | 7.34% | 7.1% / 29.0% | 51% |
| 1 | ≥10% | 172 | 3.25% | **5.13%** | 6.67% | 9.87% | 15.4% / 35.7% | 73% |
| 1 | ≥20% | 59 | 3.48% | **5.15%** | 7.32% | 10.87% | 27.3% / 64.4% | 92% |
| 2 | ≥5% | 512 | 6.20% | **8.68%** | 11.87% | 16.39% | 8.0% / 31.4% | 38% |
| 2 | ≥10% | 182 | 6.74% | **10.80%** | 15.14% | 20.17% | 15.9% / 48.9% | 58% |
| 2 | ≥20% | 62 | 8.13% | **11.33%** | 16.32% | 21.74% | 28.2% / 66.0% | 77% |
| 3 | ≥10% | 174 | 10.16% | **14.89%** | 22.92% | 31.90% | 15.8% / 52.8% | 46% |
| 3 | ≥20% | 55 | 12.28% | **16.20%** | 26.25% | 33.31% | 29.3% / 67.9% | 65% |

## 5. Đáy có giãn xa hơn nền không — và vì sao

| kv | gap median tại đáy hồi ≥10% | gap median mọi nến bear | ATR% tại đáy | ATR% nền |
|---|---|---|---|---|
| 1 | 5.13% | 3.20% | 5.86% | 4.17% |
| 2 | 10.80% | 6.32% | 6.36% | 4.35% |
| 3 | 14.89% | 9.85% | 6.33% | 4.41% |

Đáy giãn xa hơn nền ~1.6-1.7 lần. Nhưng ATR% tại đáy cũng cao hơn nền ~1.45 lần —
tức **phần lớn "giãn xa" đến từ biến động nở, không phải từ một lực kéo về đường trung bình nào.**

## Takeaway

**Trả lời trực tiếp (keyValue = 2, thiết lập giữa):** BTC D1 thường nằm dưới đường UTBot giảm
khoảng **6.3% (trung vị)**, và **~12% là ngưỡng mà xác suất đổi hẳn**. Ở nhóm gap ≥12%: xác suất
hồi ≥5% trong 10 ngày là **82%** và hồi ≥10% trong 20 ngày là **67%** — so với chỉ 47% / 38% ở
nhóm gap 4-6%. Các cú hồi ≥10% thực tế khởi đầu ở gap trung vị **10.8%**, nửa số lần nằm trong
khoảng **6.7% - 15.1%**.

Quy đổi theo keyValue bạn dùng: ngưỡng đó là **~6%** với kv=1, **~12%** với kv=2, **~12-15%** với
kv=3 (nhưng kv=3 phân tách kém, gần như không dùng được).

**Ba điều làm số này kém đẹp hơn vẻ ngoài:**

1. **Gap% chỉ là kv × ATR% viết cách khác.** Giới hạn cứng đo được đúng 1.00/2.00/3.00 ATR. Nên
   "cách đường 12%" với kv=2 nghĩa là "ATR đang ~6% giá" — tức là bạn đang đọc một chỉ báo biến
   động chứ không phải một thước đo khoảng cách. Và ATR% tại các đáy hồi (6.36%) cao hơn nền
   (4.35%) đúng theo tỷ lệ đó.
2. **Gap rộng cũng là lúc rủi ro lớn nhất.** Cùng nhóm ≥12% cho MFE 20 ngày +18% thì cũng là vùng
   biến động gấp rưỡi bình thường — cú hồi 15% và cú thủng tiếp 15% đến từ cùng một trạng thái thị trường.
3. **Hồi không có nghĩa là đảo chiều.** Với kv=2, cú hồi ≥10% chỉ chạm lại được đường UTBot 58%
   số lần; cú hồi ≥5% chỉ 38%. Trung vị của một cú hồi ≥5% là **+8.0%** trong 30 ngày — đa số là
   nhịp giật trong xu hướng giảm, không phải điểm đảo.

**Dùng thế nào cho hợp lý:** gap ≥12% (kv=2) là tín hiệu *ngừng bán đuổi / cân nhắc chốt short*,
không phải tín hiệu mua đảo chiều. Nếu muốn vào long thì nó chỉ là điều kiện lọc thứ nhất, còn
tín hiệu vào phải đến từ việc lật trend thật — xem `2026-09-03-btc-d1-downtrend-break-20pct.md`.
