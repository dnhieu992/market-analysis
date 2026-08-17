# BTC seasonal DCA — ba luật thoát cho chu kỳ "không bao giờ đóng"

**Date:** 2026-08-07
**Symbol:** BTC/USD (Bitstamp daily) · **Chính:** 2022-01-01 → 2026-08-07 (4.60y) · **OOS:** 2017-01-01 → 2021-12-31 (5.00y)
**Nối tiếp:** [`2026-08-07-btc-monthly-seasonal-dca-2000.md`](./2026-08-07-btc-monthly-seasonal-dca-2000.md)

Run trước chốt config **mua ngày 1 của May/Jun/Aug/Dec, tranche = vốn/2, bán sạch tại
avgCost × 1.06** (+51.3%, 9.4%/yr) và để hở đúng một rủi ro: luật **không có lối thoát**
cho chu kỳ lỗ. Năm 2022 nó phải ôm 292 ngày; nếu BTC không hồi 6% trên giá trung bình thì
$2,000 bị khoá vô hạn. Run này test 3 phương án đã ghi là "chưa test".

## Commands

```bash
# 2022 → nay
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-seasonal-dca-exit-rules.ts 2022-01-01 2000 0.05

# OOS 2017–2021
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-seasonal-dca-exit-rules.ts 2017-01-01 2000 0.05 2022-01-01
```

## Luật test

Giữ nguyên mọi thứ của baseline (spot, không SL, compound, fee 0.05%/side, TP khớp khi
**high** chạm target). Chỉ thay cơ chế thoát:

1. **Trần thời gian (cap N ngày)** — bag đủ N ngày tuổi thì bán market tại **close**, bất kể lãi lỗ.
2. **TP giảm dần** — target bắt đầu ở X%, mỗi 30 ngày ôm trừ đi `step`%, sàn ở `floor`
   (có thể âm = chấp nhận cắt lỗ).
3. **Chốt từng phần** — thang: bán một phần ở nấc thấp, phần còn lại ở nấc cao hơn.

Ngày ôm tính từ **lần mua đầu của chu kỳ**, không phải lần mua cuối.

## Kết quả 2022-01-01 → 2026-08-07 (B&H: $2,781, +39.1%, maxDD -67.9%)

| luật thoát | equity | total% | %/yr | fills | lệnh lỗ | bị ép bán | med d | max d | eqMaxDD |
|------------|--------|--------|------|-------|---------|-----------|-------|-------|---------|
| **baseline TP6** | **$3,025** | **+51.3** | **9.4** | 14 | **0** | 0 | 12 | 292 | -42.6 |
| baseline TP8 | $3,018 | +50.9 | 9.4 | 10 | 0 | 0 | 39 | 557 | -56.5 |
| TP6 cap 60d | $2,325 | +16.3 | 3.3 | 17 | 4 | 4 | 12 | 60 | **-22.5** |
| TP6 cap 90d | $2,166 | +8.3 | 1.7 | 15 | 1 | 1 | 12 | 90 | -33.6 |
| TP6 cap 120d | $2,141 | +7.1 | 1.5 | 15 | 1 | 1 | 12 | 120 | -34.4 |
| **TP6 cap 180d** | **$1,772** | **-11.4** | **-2.6** | 15 | 1 | 1 | 12 | 180 | -45.7 |
| TP6 cap 270d | $2,501 | +25.0 | 5.0 | 14 | 1 | 1 | 12 | 270 | -42.6 |
| TP6 cap 365d | $3,025 | +51.3 | 9.4 | 14 | 0 | 0 | 12 | 292 | -42.6 |
| TP8 cap 180d | $1,948 | -2.6 | -0.6 | 13 | 1 | 1 | 42 | 180 | -50.5 |
| TP10 cap 180d | $1,526 | -23.7 | -5.7 | 11 | 2 | 2 | 42 | 180 | -50.5 |
| TP8 −1%/30d sàn 0 | $2,639 | +32.0 | 6.2 | 10 | 1 | 0 | 38 | 541 | -56.5 |
| TP8 −2%/30d sàn 0 | $2,489 | +24.4 | 4.9 | 10 | 2 | 0 | 38 | 541 | -56.5 |
| TP10 −2%/30d sàn 0 | $2,363 | +18.1 | 3.7 | 9 | 1 | 0 | 39 | 541 | -56.5 |
| TP12 −2%/30d sàn 0 | $2,221 | +11.0 | 2.3 | 8 | 1 | 0 | 39 | 541 | -56.5 |
| TP8 −2%/30d sàn −5 | $2,364 | +18.2 | 3.7 | 10 | 2 | 0 | 38 | 540 | -56.5 |
| TP10 −2%/30d sàn −10 | $2,364 | +18.2 | 3.7 | 11 | 1 | 0 | 44 | 348 | -56.5 |
| ½@5 còn lại@10 | $2,076 | +3.8 | 0.8 | 15 | 0 | 0 | 15 | 540 | -49.7 |
| ½@6 còn lại@12 | $2,239 | +11.9 | 2.5 | 15 | 0 | 0 | 19 | 540 | -49.5 |
| ½@8 còn lại@15 | $2,424 | +21.2 | 4.3 | 11 | 0 | 0 | 158 | 582 | -56.5 |
| ⅓@5/10/20 | $2,546 | +27.3 | 5.4 | 13 | 0 | 0 | 222 | 557 | -51.9 |
| ½@6 @12 + cap180 | $1,974 | -1.3 | -0.3 | 23 | 2 | 2 | 43 | 180 | -40.8 |
| ½@8 @15 + cap180 | $1,978 | -1.1 | -0.2 | 18 | 2 | 2 | 158 | 180 | -50.5 |
| TP10 −2%/30d + cap365 | $2,080 | +4.0 | 0.9 | 11 | 1 | 1 | 39 | 365 | -56.5 |
| TP8 −2%/30d + cap270 | $1,795 | -10.3 | -2.3 | 12 | 2 | 1 | 43 | 270 | -56.5 |

**Không một biến thể nào thắng baseline.** Baseline $3,025 là ô cao nhất bảng.

## Kết quả OOS 2017-01-01 → 2021-12-31 (B&H: $95,600, +4,680%, maxDD -84.1%)

| luật thoát | equity | total% | %/yr | lệnh lỗ | max d | eqMaxDD |
|------------|--------|--------|------|---------|-------|---------|
| baseline TP6 | $3,061 | +53.1 | 8.9 | 0 | 265 | -42.6 |
| baseline TP8 | $3,237 | +61.8 | 10.1 | 0 | 394 | -63.7 |
| TP6 cap 60d | $2,069 | +3.5 | 0.7 | 2 | 60 | -38.0 |
| TP6 cap 90d | $2,437 | +21.9 | 4.0 | 2 | 90 | -38.0 |
| TP6 cap 180d | $1,887 | -5.6 | -1.2 | 1 | 180 | -49.7 |
| TP6 cap 270d / 365d | $3,061 | +53.1 | 8.9 | 0 | 265 | -42.6 |
| TP8 −1%/30d sàn 0 | $2,900 | +45.0 | 7.7 | 1 | 378 | -63.7 |
| TP10 −1%/30d sàn 0 | $3,252 | +62.6 | 10.2 | 1 | 378 | -63.7 |
| TP12 −2%/30d sàn 0 | $3,492 | +74.6 | 11.8 | 1 | 378 | -63.7 |
| ½@6 còn lại@12 | $3,624 | +81.2 | 12.6 | 0 | 391 | -62.4 |
| ½@8 còn lại@15 | $4,194 | +109.7 | 16.0 | 0 | 416 | -63.7 |
| **⅓@5/10/20** | **$4,654** | **+132.7** | **18.4** | 0 | 416 | -62.7 |
| ½@6 @12 + cap180 | $2,854 | +42.7 | 7.4 | 1 | 180 | -38.2 |
| TP8 −2%/30d + cap270 | $1,252 | -37.4 | -9.0 | 1 | 270 | -64.7 |

## Đọc kết quả

### 1. Trần thời gian giữ — hỏng ở cả hai regime, và hỏng vì lý do cấu trúc

Đây là phương án duy nhất thực sự **chặn được** thời gian khoá vốn, và nó là phương án tệ nhất.
Ở 2022–2026 nó biến 0 lệnh lỗ thành 1–4 lệnh lỗ và ăn mất 35–63 điểm lợi nhuận; ở OOS cũng vậy.

Lý do rất cụ thể. Chu kỳ lỗ duy nhất bắt đầu **2022-06-01**, avgCost 26,891 (2 tranche). Trần
N ngày ép bán tại:

| trần | ngày bán | close BTC | so với avgCost |
|------|----------|-----------|----------------|
| 120d | 2022-09-29 | ~19,425 | **-28%** |
| **180d** | **2022-11-28** | **~16,434** | **-39%** |
| 270d | 2023-02-26 | 23,562 | -12% |
| 292d (baseline) | 2023-03-20 | 28,505 (target) | **+6%** |

Đáy 2022 là **15,479 ngày 2022-11-21**. Trần 180 ngày bán ngày **2022-11-28** — cách đáy tuyệt
đối đúng 7 ngày. Đó không phải xui: chu kỳ lỗ *bắt đầu* khi giá bắt đầu rơi, nên "N tháng sau
khi bắt đầu rơi" gần như luôn rơi vào vùng đáy. **Trần thời gian là một máy bán đáy có hệ thống.**

Trần 365 ngày cho kết quả **y hệt baseline** ở cả hai cửa sổ — vì chu kỳ dài nhất là 292d (2022–26)
và 265d (2017–21), nó không bao giờ kích hoạt. Nếu muốn có trần cho yên tâm thì chỉ **365 ngày trở
lên** mới không phá chiến lược, và khi đó nó chỉ là bảo hiểm danh nghĩa, chưa từng được test bởi
dữ liệu thật.

### 2. TP giảm dần — luôn kém hơn TP cố định cùng mức xuất phát

So sánh đúng cặp (cùng TP khởi điểm), decay thua ở cả hai cửa sổ:

| | 2022–26 | OOS 2017–21 |
|---|---|---|
| TP8 cố định | **+50.9%** | **+61.8%** |
| TP8 −1%/30d | +32.0% | +45.0% |
| TP8 −2%/30d | +24.4% | — |

Ở OOS, dòng TP12 −2%/30d (+74.6%) trông thắng baseline TP6 — nhưng đó là công của **mức xuất
phát 12%**, không phải của decay. Hạ sàn xuống âm (−5%, −10%) chỉ thêm lệnh lỗ mà không rút ngắn
được thời gian ôm (max d vẫn 540). Decay bán rẻ đúng lúc bag đang chờ hồi.

### 3. Chốt từng phần — không phải luật thoát, mà là đòn bẩy theo regime

Đây là biến thể duy nhất có cửa thắng, nhưng nó **phụ thuộc regime còn nặng hơn cả bộ tháng mùa vụ**:

| | 2022–26 (đi ngang) | OOS 2017–21 (bull) |
|---|---|---|
| baseline TP6 | **+51.3%** | +53.1% |
| ⅓@5/10/20 | +27.3% | **+132.7%** |
| ½@8 còn lại@15 | +21.2% | +109.7% |

Bull thì nấc trên khớp và ăn to; đi ngang thì nấc trên không bao giờ tới, phần đuôi nằm chết.
Quan trọng hơn cho câu hỏi của run này: chốt từng phần **làm rủi ro khoá vốn nặng thêm**. Ở
2022–26 nó để lại một bag dư ôm **371 ngày** tính đến hôm nay và max d lên **540–582 ngày**, so
với 292 của baseline. Nó chia nhỏ chu kỳ chứ không kết thúc được chu kỳ.

## Takeaway

**Cả ba phương án đều không giải quyết được rủi ro, giữ nguyên baseline TP 6%.**

- Cái duy nhất chặn được thời gian khoá vốn (trần thời gian) trả giá bằng việc bán gần đáy một
  cách có hệ thống — chi phí lớn hơn rủi ro nó gỡ.
- TP giảm dần thua thuần tuý ở mọi cặp so sánh công bằng.
- Chốt từng phần là một canh bạc regime, và còn kéo dài thời gian ôm.

Nếu vẫn muốn một trần cho yên tâm tâm lý: **365 ngày**, vì mức đó chưa từng kích hoạt trong 9.6
năm dữ liệu nên không phá gì — nhưng phải hiểu nó chưa được kiểm chứng.

**Cảnh báo về sức mạnh thống kê:** kết luận "cứ ôm" dựa trên đúng **2 chu kỳ lỗ dài** (292 ngày
năm 2022, 265 ngày năm 2018) — cả hai đều hồi. n=2 không chứng minh được BTC *luôn* hồi 6% trên
giá trung bình. Rủi ro cấu trúc **vẫn còn nguyên**, run này chỉ chứng minh được rằng ba cách vá
phổ biến đều đắt hơn rủi ro. Cách kiểm soát đúng ở đây không nằm trong luật thoát mà nằm ở
**cỡ vị thế** — chỉ đưa vào chiến lược này số tiền chấp nhận bị khoá vài năm.
