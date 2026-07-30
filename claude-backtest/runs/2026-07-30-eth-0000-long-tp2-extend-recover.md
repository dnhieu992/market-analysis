# ETH — LONG 00:00 UTC, TP +2%, chia 2 batch (batch 2 = damage control tới 16:00)

**Date:** 2026-07-30
**Scope:** 2025-01-01 → 2026-07-30 · ETHUSDT · 576 trades · $1000/lệnh · fee 0.06%/side · no leverage
**Tiếp nối:** [`2026-07-30-eth-0000-long-tp2-close0800.md`](./2026-07-30-eth-0000-long-tp2-close0800.md)

## Rule tested

- **Entry:** LONG tại open nến 00:00 UTC, 1x, $1000 cố định.
- **BATCH 1** (00:00 → 08:00):
  - TP **+2%** khớp intra-candle trên `high` → **chốt hết**.
  - Tới **08:00 UTC** mà đang **lãi / hoà / âm không quá 0.5%** → **chốt hết**.
- **BATCH 2** — chỉ kích hoạt khi tại 08:00 lệnh **âm quá 0.5%**:
  - Mục tiêu duy nhất là **giảm thiểu thiệt hại**, không còn nhắm lợi nhuận.
  - Chốt ngay khi giá hồi về **mốc damage-control**:
    - **Case A:** mốc = **entry** (hồi vốn)
    - **Case B:** mốc = **entry − 0.5%** (chính mức ngưỡng)
  - Không hồi tới mốc → **force close bắt buộc 16:00 UTC**.
- Không stop-loss. 1 lệnh/ngày, không qua ngày.

### Ba điểm thiết kế cần nói rõ

1. **Dải [−0.5%, 0) chốt ở 08:00**, không vào batch 2 — vì rule chỉ gia hạn khi "âm quá 0.5%".
   Đây là điểm khác biệt then chốt so với biến thể "âm bất kỳ thì gia hạn".
2. **TP +2% không kiểm tra lại trong batch 2** — hệ quả logic, không phải lựa chọn tuỳ ý. Batch 2
   chỉ bắt đầu khi giá dưới entry−0.5%, còn mốc damage-control nằm **dưới** mốc TP +2%. Giá muốn
   lên +2% thì **buộc đi qua mốc damage-control trước**, nên mốc đó luôn khớp sớm hơn. Kiểm tra TP
   trong batch 2 là double-count. (Cũng khớp với ý "batch 2 không chú ý tới lợi nhuận nữa".)
3. **Nếu tại 08:00 giá đã ở trên mốc damage-control** (chỉ xảy ra khi mốc sâu hơn ngưỡng, ví dụ
   lệnh −0.7% mà mốc −1%), điều kiện chốt đã thoả sẵn → chốt ngay tại giá 08:00.

## Command

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-0000-long-tp2-extend-recover-backtest.ts ETHUSDT 2025-01-01 2 8 16 0.06 1000 -0.5
```

Script: `scripts/run-0000-long-tp2-extend-recover-backtest.ts` (tham số cuối = ngưỡng kích hoạt batch 2).

## KẾT QUẢ — cả 2 case vẫn tệ hơn baseline

| Variant | Win% | R:R | **PF** | Cần hòa | **NET $** | **Comp. $1000** | **Max DD** | Avg hold |
|---|---|---|---|---|---|---|---|---|
| **Baseline** (chốt hết 08:00) | 51.9% | **0.77** | **0.83** | **56.5%** | **−$645.87** | **$482.56** | **53.7%** | 7.2h |
| **Case A** (batch 2 → entry) | 51.9% | 0.71 | 0.76 | 58.6% | **−$998.76** | $328.70 | **68.6%** | 9.3h |
| **Case B** (batch 2 → −0.5%) | 51.9% | 0.72 | 0.78 | 58.1% | **−$899.18** | $366.09 | 64.7% | 8.9h |

Case A xấu thêm **$353**, Case B xấu thêm **$253**. Max DD phình 53.7% → 68.6% / 64.7%.

## Win rate vẫn KHÔNG đổi — 51.9%, đúng 299/576 ở cả 3 biến thể

**Tất yếu toán học**, không phải trùng hợp: batch 2 chỉ tác động lên các lệnh đang âm quá 0.5% ở
08:00, và đó **đã là lệnh thua trong baseline**. Kết quả **tốt nhất** batch 2 có thể đạt là hồi
đúng về entry → gross 0% → **net −0.12% sau phí, vẫn thua**. Case B còn thấp hơn: −0.5% → net −0.62%.

→ **Batch 2 không thể biến lệnh thua thành lệnh thắng** — đúng theo thiết kế của bạn ("không chú ý
tới lợi nhuận nữa"). Nó chỉ đổi **độ lớn** khoản thua. Và độ lớn đó **to hơn**.

## Breakdown kết cục từng lệnh

| Kết cục | Case A | Case B |
|---|---|---|
| TP +2% khớp trước 08:00 | 119 (20.7%) · net **+$2,234.39** | 119 (20.7%) · net **+$2,234.39** |
| Chốt 08:00 (lãi/hoà/âm ≤ 0.5%) | 284 (49.3%) · net **+$622.80** | 284 (49.3%) · net **+$622.80** |
| **Batch 2 hồi tới mốc** | 58 (10.1%) · net **−$69.58** | 83 (14.4%) · net **−$514.07** |
| **Batch 2 force close 16:00** | 115 (20.0%) · net **−$3,786.37** | 90 (15.6%) · net **−$3,242.30** |
| → tổng vào batch 2 | **173 (30.0%)** | **173 (30.0%)** |

Ngưỡng −0.5% lọc tốt hơn hẳn ngưỡng "âm bất kỳ": chỉ **30.0%** số lệnh vào batch 2 (so với 44.4%),
và **49.3%** chốt gọn ở 08:00.

Nhưng trong 173 lệnh vào batch 2:
- **Case A:** chỉ **58/173 = 33.5%** hồi được về entry (thua đúng bằng phí, ~−$1.20/lệnh),
  còn **115/173 = 66.5%** không hồi và bị force close với **trung bình −$32.92/lệnh**.
- **Case B:** 83/173 = 48.0% hồi được (mỗi lệnh vẫn thua ~−$6.19), 90/173 = 52.0% force close,
  **trung bình −$36.03/lệnh**.

**Tỉ lệ cứu được chỉ 1/3 (Case A).** Lệnh đã âm quá 0.5% ở 08:00 thì phần lớn tiếp tục xấu đi,
không hồi.

### Tính riêng nhóm 173 lệnh vào batch 2

| | Tổng net nhóm 173 | Trung bình/lệnh |
|---|---|---|
| Baseline (chốt hết ở 08:00) | −$3,254.28 | **−$18.81** |
| Case A | **−$3,855.95** | **−$22.29** |
| Case B | **−$3,756.37** | **−$21.71** |

Cầm thêm 8 giờ khiến nhóm này lỗ thêm **$602 (A)** / **$502 (B)** — tức **−$3.48/lệnh (A)** so với
chốt thẳng ở 08:00. Worst trade phình **−$88.41 → −$106.94**, avg loss $13.84 → $15.11 (A) / $14.75 (B).

## Sweep mốc damage-control của batch 2 (ngưỡng −0.5%, deadline 16:00)

| Mốc | Win% | PF | NET $ | Comp. $1000 | Max DD | Batch 2 | Hồi được | Force close |
|---|---|---|---|---|---|---|---|---|
| entry **0.00%** (Case A) | 51.9% | 0.76 | −$998.76 | $328.70 | 68.6% | 173 | 58 | 115 |
| entry **−0.50%** (Case B) | 51.9% | 0.78 | −$899.18 | $366.09 | 64.7% | 173 | 83 | 90 |
| entry −1.00% | 51.9% | 0.82 | −$676.44 | $462.12 | 55.3% | 173 | 115 | 58 |
| entry −1.50% | 51.9% | 0.84 | −$589.62 | $506.60 | 52.0% | 173 | 137 | 36 |
| entry **−2.00%** | 51.9% | **0.88** | **−$454.89** | **$585.06** | **49.6%** | 173 | 150 | 23 |
| entry −3.00% | 51.9% | 0.85 | −$552.18 | $530.04 | 49.5% | 173 | 158 | 15 |

**Mốc càng sâu (thoát càng sớm, kỳ vọng càng thấp) → càng ít tệ.** Đặt mục tiêu hồi vốn (Case A)
là mốc **tệ nhất** — vì đòi hỏi nhiều nhất nên chỉ 33.5% đạt được, phần còn lại bị cầm tới 16:00.

## Sweep ngưỡng kích hoạt batch 2 (mốc = chính ngưỡng, deadline 16:00)

| Ngưỡng | Win% | PF | NET $ | Comp. $1000 | Max DD | Batch 2 | Hồi được | Force close |
|---|---|---|---|---|---|---|---|---|
| P&L < 0.00% | 51.9% | 0.77 | −$953.49 | $343.54 | 67.2% | 256 (44%) | 130 | 126 |
| P&L < −0.25% | 51.9% | 0.76 | −$1,020.67 | $322.18 | 69.6% | 216 (38%) | 106 | 110 |
| **P&L < −0.50%** | 51.9% | 0.78 | −$899.18 | $366.09 | 64.7% | 173 (30%) | 83 | 90 |
| P&L < −1.00% | 51.9% | 0.82 | −$676.44 | $462.12 | 55.3% | 118 (20%) | 60 | 58 |
| P&L < −1.50% | 51.9% | 0.84 | −$589.62 | $506.60 | 52.0% | 77 (13%) | 41 | 36 |
| **P&L < −2.00%** | 51.9% | **0.88** | **−$454.89** | **$585.06** | **49.6%** | **53 (9%)** | 30 | 23 |
| P&L < −3.00% | 51.9% | 0.85 | −$552.18 | $530.04 | 49.5% | 32 (6%) | 17 | 15 |

📌 **Đây là phát hiện đáng chú ý nhất.** Xu hướng đơn điệu: **càng ít lệnh vào batch 2 thì càng
tốt**, và biến thể **ngưỡng −2% / mốc −2%** là **biến thể DUY NHẤT vượt được baseline** trên mọi
chỉ số: NET −$455 (vs −$646), PF 0.88 (vs 0.83), comp $585 (vs $483), max DD 49.6% (vs 53.7%).

Ý nghĩa thực tế: *chốt hết ở 08:00 trừ khi lệnh âm hơn 2%, khi đó chờ nảy về −2% hoặc force close
16:00.* Tức chỉ gia hạn cho các lệnh **âm rất sâu** — nơi có mean-reversion thật.

⚠️ **Nhưng chưa đủ bằng chứng để dùng.** Chỉ **53/576 lệnh (9.2%)** thực sự khác baseline; phần
lời thêm $191 chia cho 576 lệnh = **$0.33/lệnh**, so với sai số chuẩn ≈ **$1.00/lệnh** → **0.33 SE,
không có ý nghĩa thống kê**. Trên riêng 53 lệnh khác biệt thì n quá nhỏ để kết luận. Và **PF 0.88
vẫn < 1.0**, tức vẫn lỗ. Đây là hướng đáng test thêm (nhiều coin, nhiều năm), không phải config
để chạy thật.

## Biến thể "KHÔNG có mốc damage-control" — rule cuối user chốt

Ở lần chốt rule cuối, user **không nêu mốc chốt trong batch 2**, chỉ nói *"cho chạy tiếp, force đóng
tại 16:00 UTC"*. Diễn giải áp dụng: **batch 2 giữ tới 16:00, TP +2% vẫn là cửa lãi duy nhất**, không
có mốc hồi vốn nào. Đây là biến thể **tệ nhất trong tất cả** đã test.

| Metric | Giá trị |
|---|---|
| Trades | 576 |
| Win rate | **56.3%** (cao nhất mọi biến thể) |
| **Profit factor** | **0.75** |
| **NET P&L** | **−$1,176.40** |
| **Compounded $1000** | **$271.97** |
| **Max DD** | **75.4%** |

### Kết cục các lệnh

| Kết cục | n | % tổng |
|---|---|---|
| TP +2% trước 08:00 | 119 | **20.7%** |
| Chốt ở 08:00 (lãi/hoà/âm ≤ 0.5%) | 284 | **49.3%** |
| Chạy tiếp rồi ăn được TP +2% | 12 | **2.1%** |
| **Force đóng 16:00** | **161** | **28.0%** |

### 🔴 Force đóng 16:00 = 28.0% (161/576) — 93.1% của batch 2

| | Giá trị |
|---|---|
| % tổng lệnh | **28.0%** (161/576) — ~2 trong mỗi 7 ngày |
| % batch 2 | **93.1%** (161/173) |
| Net nhóm | **−$4,258.91** |
| Avg/lệnh | **−$26.45** |
| Worst | **−$106.94** |
| Lệnh xanh | **13/161 = 8.1%** |

Chỉ **12/173 = 6.9%** lệnh trong batch 2 ăn được TP +2%. Tức khi đã âm hơn 0.5% ở 08:00 thì
**93.1% không hồi nổi** và bị force đóng.

Khác với Case A/B (0 lệnh xanh), biến thể này có **13 lệnh xanh** trong nhóm force đóng — giá về
trên entry lúc 16:00 nhưng chưa tới +2%. Đó cũng là lý do win rate nhảy lên 56.3%.

⚠️ **Win rate trap lần thứ tư:** biến thể này có **win rate cao nhất (56.3%)** trong toàn bộ loạt
test nhưng đồng thời **lỗ nặng nhất (−$1,176)** và **drawdown tệ nhất (75.4%)**.

### Force đóng 16:00 theo năm / tháng

| Kỳ | Force đóng |
|---|---|
| 2025 | 97 / 365 = **26.6%** |
| 2026 YTD | 64 / 211 = **30.3%** |

Theo tháng dao động **16% – 40%**: thấp nhất 2025-10 và 2025-12 (16%), cao nhất 2026-06 (40%),
2026-04 và 2025-02 (36–37%). Rất ổn định quanh mức ~28%, không phải hiện tượng của riêng giai đoạn nào.

### So với baseline

| Variant | Win% | PF | NET | Comp. $1000 | Max DD |
|---|---|---|---|---|---|
| Baseline (chốt hết 08:00) | 51.9% | **0.83** | **−$645.87** | **$482.56** | **53.7%** |
| **Rule cuối (không mốc, tới 16:00)** | **56.3%** | 0.75 | **−$1,176.40** | $271.97 | **75.4%** |

Phần "cho chạy tiếp" làm xấu thêm **$531**.

### Đã ghi vào field Đánh giá của ETH

Note cũ của ETHUSDT (bản auto-gen "reference vào lệnh" từ 7 lệnh đã đóng, 771 chars) đã bị **thay
thế hoàn toàn** bằng bản tóm tắt backtest này (2401 chars) trong bảng `bitget_symbol_notes`
(2026-07-30 08:52 UTC), qua script mới `packages/db/write-note-from-file.mjs`.

## Bao nhiêu % lệnh bị FORCE ĐÓNG ở 16:00 (các biến thể có mốc damage-control)

| Variant | Force close 16:00 | % **tổng lệnh** | % **batch 2** | Net nhóm này | Avg/lệnh | Worst | **Lệnh xanh** |
|---|---|---|---|---|---|---|---|
| **Case A** (mốc = entry) | **115 / 576** | **20.0%** | 66.5% | −$3,786.37 | −$32.92 | −$106.94 | **0** |
| **Case B** (mốc = −0.5%) | **90 / 576** | **15.6%** | 52.0% | −$3,242.30 | −$36.03 | −$106.94 | **0** |

🔴 **Không một lệnh force close nào xanh — 0/115 và 0/90.** Đây là tất yếu: lệnh chỉ đi tới 16:00
vì giá **chưa bao giờ** hồi lên tới mốc (entry / −0.5%), nên đến deadline nó vẫn nằm dưới mốc đó →
**100% là lệnh lỗ**. Nhóm này chính là nơi gánh toàn bộ thiệt hại: −$3,786 (A) trên tổng NET −$999.

### Theo năm — tỉ lệ rất ổn định

| Year | Case A | Case B |
|---|---|---|
| 2025 | 71 / 365 = **19.5%** | 54 / 365 = **14.8%** |
| 2026 YTD | 44 / 211 = **20.9%** | 36 / 211 = **17.1%** |

Không phải hiện tượng của riêng một giai đoạn — cả hai năm đều ~20% (A) / ~15–17% (B).

### Theo mốc damage-control (ngưỡng −0.5%, deadline 16:00)

| Mốc | Force close | % tổng lệnh | % batch 2 | Avg/lệnh | Xanh |
|---|---|---|---|---|---|
| entry 0.00% (Case A) | 115 | **20.0%** | 66.5% | −$32.92 | 0 |
| entry −0.50% (Case B) | 90 | **15.6%** | 52.0% | −$36.03 | 0 |
| entry −1.00% | 58 | 10.1% | 33.5% | −$41.39 | 0 |
| entry −1.50% | 36 | 6.3% | 20.8% | −$49.38 | 0 |
| entry −2.00% | 23 | **4.0%** | 13.3% | −$53.13 | 0 |
| entry −3.00% | 15 | **2.6%** | 8.7% | −$59.88 | 0 |

⚠️ **Quan hệ nghịch:** mốc càng sâu → **càng ít lệnh** bị force close, nhưng **mỗi lệnh càng nặng**
(−$32.92 → −$59.88). Lệnh không hồi nổi tới cả mốc −3% là lệnh sập thảm.

### Theo deadline (Case A, mốc = entry)

| Deadline | Force close | % tổng lệnh | % batch 2 | **Net nhóm** | Avg/lệnh | Worst |
|---|---|---|---|---|---|---|
| 10:00 | 153 | **26.6%** | 88.4% | −$3,606.60 | −$23.57 | −$105.19 |
| 12:00 | 141 | 24.5% | 81.5% | −$3,452.60 | −$24.49 | −$101.53 |
| 14:00 | 128 | 22.2% | 74.0% | −$3,649.28 | −$28.51 | −$103.15 |
| **16:00** | 115 | **20.0%** | 66.5% | −$3,786.37 | −$32.92 | −$106.94 |
| 20:00 | 100 | 17.4% | 57.8% | −$3,938.15 | −$39.38 | **−$163.13** |
| 00:00 (+24h) | 92 | 16.0% | 53.2% | −$3,659.56 | −$39.78 | −$147.60 |

📌 **Kéo deadline dài ra KHÔNG giảm tổng thiệt hại — chỉ đóng gói lại.** Số lệnh force close giảm
26.6% → 16.0%, nhưng avg mỗi lệnh phình −$23.57 → −$39.78, nên **tổng net nhóm gần như đứng yên
(−$3.45k … −$3.94k) và thực ra hơi xấu đi**. Worst trade thì phình hẳn: −$105 → **−$163** ở deadline
20:00. Đổi "nhiều lệnh lỗ nhỏ" thành "ít lệnh lỗ to" — tổng vẫn thế, đuôi rủi ro thì dài hơn.

## Sweep deadline batch 2

| Deadline | Case A: Win% / PF / NET / Comp | Case B: Win% / PF / NET / Comp |
|---|---|---|
| 10:00 | 51.9% / 0.80 / −$773.40 / $421.48 | 51.9% / 0.80 / −$778.10 / $419.79 |
| **12:00** | 51.9% / **0.83** / **−$633.80** / **$485.95** | 51.9% / 0.82 / −$688.26 / $460.44 |
| 14:00 | 51.9% / 0.79 / −$846.08 / $389.60 | 51.9% / 0.79 / −$865.30 / $382.98 |
| **16:00** | 51.9% / 0.76 / −$998.76 / $328.70 | 51.9% / 0.78 / −$899.18 / $366.09 |
| 20:00 | 51.9% / 0.73 / −$1,168.53 / $269.03 | 51.9% / 0.77 / −$928.23 / $348.64 |
| 00:00 (+24h) | 51.9% / 0.78 / −$899.54 / $355.44 | 51.9% / 0.83 / −$673.60 / $453.18 |

**Deadline 16:00 là một trong những lựa chọn tệ nhất.** Deadline 12:00 (gia hạn 4h) gần như bằng
baseline; kéo tới 16:00 hay 20:00 thì lỗ thêm rõ rệt. Không deadline nào vượt baseline.

## Per year

| Year | Baseline | Case A | Case B |
|---|---|---|---|
| 2025 | −$249.45 | −$350.95 | **−$210.22** |
| 2026 YTD | **−$396.42** | −$647.81 | −$688.96 |

Case B nhích hơn baseline ở 2025 nhưng thua đậm ở 2026 → **đảo dấu theo năm, không nhất quán**.

## Fee sensitivity

| Fee/side | Baseline | Case A | Case B |
|---|---|---|---|
| **0.00% (gross)** | **+$45.17** | **−$308.13** | **−$208.44** |
| 0.02% | −$185.22 | −$538.39 | −$438.73 |
| 0.05% | −$530.73 | −$883.68 | −$784.08 |
| **0.06%** | **−$645.87** | **−$998.76** | **−$899.18** |
| 0.10% | −$1,106.34 | −$1,458.94 | −$1,359.44 |

Baseline gross còn **+$45**, nhưng cả hai case batch 2 đều **gross âm** (−$308 / −$208) — batch 2
**xoá luôn phần edge gross ít ỏi**, lỗ ngay cả khi sàn miễn phí.

Buy & hold ETH cùng kỳ: −42.6%.

## Takeaway

Ngưỡng **−0.5%** lọc tốt hơn hẳn ngưỡng "âm bất kỳ" — chỉ **30.0%** số lệnh vào batch 2 thay vì
44.4%, và **49.3%** chốt gọn ở 08:00. Nhưng **cả hai case vẫn tệ hơn baseline**: NET −$646 →
**−$999 (A)** / **−$899 (B)**, PF 0.83 → 0.76 / 0.78, compound $483 → $329 / $366, max DD 53.7% →
**68.6% / 64.7%**.

Nguyên nhân gốc: **batch 2 về mặt toán học không thể tăng win rate** — đứng nguyên **51.9%
(299/576)** ở cả ba biến thể, vì kết quả tốt nhất của nó (hồi đúng entry) vẫn là net −0.12% sau
phí. Nó chỉ đổi độ lớn khoản thua, và làm khoản thua **to hơn**: trong 173 lệnh vào batch 2, Case A
chỉ **cứu được 33.5%** (hồi về entry, thua đúng phí) còn **66.5% bị force close ở 16:00 với trung
bình −$32.92/lệnh**. Tính gộp riêng nhóm này: baseline −$18.81/lệnh → Case A **−$22.29**, Case B
**−$21.71**. Worst trade phình −$88.41 → −$106.94.

Điều đáng chú ý là mục tiêu "hồi vốn" (Case A) lại là **mốc tệ nhất trong cả sweep** — vì nó đòi
hỏi nhiều nhất nên tỉ lệ đạt thấp nhất (33.5%), phần còn lại bị cầm tới 16:00 và bleed thêm. Mốc
càng sâu, thoát càng sớm, càng ít tệ. Deadline cũng vậy: **16:00 là một trong những lựa chọn tệ
nhất**, 12:00 mới gần bằng baseline.

**Một hướng có triển vọng, nhưng chưa đủ bằng chứng:** biến thể **ngưỡng −2% / mốc −2%** là biến
thể duy nhất vượt baseline trên mọi chỉ số (NET −$455, PF 0.88, comp $585, DD 49.6%) — tức *chỉ gia
hạn cho lệnh âm rất sâu, nơi mean-reversion là thật*. Nhưng chỉ 53/576 lệnh (9.2%) khác baseline,
phần lời thêm $0.33/lệnh so với sai số chuẩn $1.00/lệnh (**0.33 SE — không có ý nghĩa thống kê**),
và **PF 0.88 vẫn < 1.0 nên vẫn lỗ**. Đáng test thêm trên nhiều coin / nhiều năm, chưa phải config
để chạy thật.

Xuyên suốt cả loạt test: quản lý thời gian thoát không sửa được rule không có edge. Baseline gross
chỉ +$45 trên 576 lệnh, và mọi cách cầm lâu hơn đều đẩy gross xuống âm. Nút cần xoay vẫn là
**stop-loss** (cắt đuôi −$88 vốn không đổi ở mọi biến thể) hoặc **filter điều kiện thị trường** để
tạo drift.
