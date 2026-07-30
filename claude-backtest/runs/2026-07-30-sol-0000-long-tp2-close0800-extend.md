# SOL — LONG 00:00 UTC, TP +2%, close 08:00 + biến thể chia 2 batch tới 16:00

**Date:** 2026-07-30
**Scope:** 2025-01-01 → 2026-07-30 · SOLUSDT · 576 trades · $1000/lệnh · fee 0.06%/side · no leverage
**Song song với:** [`2026-07-30-eth-0000-long-tp2-close0800.md`](./2026-07-30-eth-0000-long-tp2-close0800.md) ·
[`2026-07-30-eth-0000-long-tp2-extend-recover.md`](./2026-07-30-eth-0000-long-tp2-extend-recover.md)

## Commands

```bash
# rule gốc: TP +2%, chốt cứng 08:00
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-0000-long-tp-close-backtest.ts SOLUSDT 2025-01-01 2 8 0.06 1000 0

# biến thể chia 2 batch, gia hạn tới 16:00 khi âm quá 0.5%
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-0000-long-tp2-extend-recover-backtest.ts SOLUSDT 2025-01-01 2 8 16 0.06 1000 -0.5
```

## PHẦN 1 — Rule gốc: LONG 00:00, TP +2%, chốt cứng 08:00

### Win rate

| Metric | SOL | (ETH để so sánh) |
|---|---|---|
| Trades | 576 | 576 |
| **TP +2% khớp** | **155 (26.9%)** | 119 (20.7%) |
| Force close 08:00 | 421 (73.1%) | 457 (79.3%) |
| …trong đó còn xanh | 139 (33.0%) | 180 (39.4%) |
| **WIN RATE (net > 0)** | **294 / 576 = 51.0%** | 51.9% |
| Win rate trước phí | 54.0% | 55.6% |

### Payoff

| Metric | SOL | (ETH) |
|---|---|---|
| Avg WIN | +$12.45 | +$10.66 |
| Avg LOSS | −$15.54 | −$13.84 |
| **R:R thực tế** | **0.80** | 0.77 |
| **Profit factor** | **0.84** | 0.83 |
| **Win rate cần để hòa** | **55.5%** | 56.5% |
| **Thiếu** | **−4.5 điểm** | −4.6 điểm |

### P&L

| Metric | Giá trị |
|---|---|
| **NET P&L** | **−$722.28** (−72.2% size một lệnh) |
| Avg / trade | −$1.25 (−0.125%) |
| Gross profit / gross loss | +$3,658.98 / −$4,381.25 |
| Best / worst | +$18.78 / **−$93.13** |
| Max win / loss streak | 11 / 9 ngày |
| **Compounded $1000** | **$439.74** (−56.0%), max DD **57.0%** |
| **Gross (fee = 0)** | **−$31.32** |
| SOL buy & hold cùng kỳ | **−60.9%** |

**SOL biên độ lớn hơn ETH** (avg win $12.45 vs $10.66, avg loss $15.54 vs $13.84) nên TP +2% khớp
nhiều hơn (26.9% vs 20.7%) — nhưng kết quả gần y hệt: PF 0.84 vs 0.83, thiếu 4.5 vs 4.6 điểm win
rate. Gross ≈ 0 (−$31), toàn bộ lỗ là phí.

### Per year / per month

| Year | Trades | TP hit | Win% | NET $ | PF |
|---|---|---|---|---|---|
| 2025 | 365 | 123 (34%) | **55%** | −$259.45 | 0.91 |
| 2026 YTD | 211 | 32 (15%) | 44% | −$462.83 | 0.66 |

**Green months: 5 / 19 (26%).**

### Sensitivity NET $ — 40/40 ô đều âm

| TP \ close | 04:00 | 06:00 | 08:00 | 10:00 | 12:00 | 16:00 | 20:00 | 24:00 |
|---|---|---|---|---|---|---|---|---|
| +1.0% | **−286** | −455 | −516 | −496 | −428 | −542 | −846 | −484 |
| +1.5% | −314 | −493 | −569 | −547 | −430 | −827 | −1,224 | −974 |
| **+2.0%** | −361 | −542 | **−722** | −682 | −578 | −1,037 | −1,617 | −1,318 |
| +2.5% | −318 | −435 | −550 | −483 | −399 | −761 | −1,317 | −1,003 |
| **+3.0%** | −316 | **−288** | −406 | −370 | −437 | −861 | −1,435 | −1,076 |

⚠️ **Khác ETH ở đây:** trên SOL, **TP +3% tốt hơn TP +2%** ở hầu hết giờ chốt (ô tốt nhất cả bảng là
TP+3%/close 06:00 = −$288), còn trên ETH thì TP +2% mới là mức tốt nhất. Biên độ SOL lớn hơn nên TP
rộng hơn có lý. Nhưng **vẫn 40/40 ô âm** → vẫn không phải vấn đề tuning.

### Entry hour scan — 01:00 tốt nhất, KHÁC với ETH

| Entry | Window | TP hit | Win% | NET $ | PF | Comp. $1000 |
|---|---|---|---|---|---|---|
| 00:00 | 8h | 26.9% | **51.0%** | −$722.28 | 0.84 | $439.74 |
| **01:00** | 7h | 24.0% | 49.5% | **−$446.31** | **0.89** | **$590.78** |
| 02:00 | 6h | 18.4% | 47.7% | −$820.89 | 0.78 | $409.28 |
| 03:00 | 5h | 14.6% | 44.1% | **−$1,118.75** | 0.69 | $306.62 |
| 04:00 | 4h | 11.6% | 44.8% | −$952.67 | 0.70 | $365.73 |
| 05:00 | 3h | 7.5% | 43.9% | −$955.69 | 0.67 | $369.17 |

Trên ETH thứ tự là 00:00 tốt nhất và xấu dần đơn điệu. Trên SOL thì **01:00** tốt nhất và 03:00 tệ
nhất — **thứ tự khác hoàn toàn**. Đây là bằng chứng thứ ba (sau khi thứ tự đã đảo giữa TP 1% và TP
2% trên ETH) rằng **xếp hạng giờ vào là nhiễu, không phải tín hiệu**.

### Raw drift 8h theo giờ vào (gross, bỏ TP, bỏ phí)

| Entry | Mean | Median | Up% | **t-stat** |
|---|---|---|---|---|
| 00:00 | +0.0137% | +0.1115% | 52.4% | 0.16 |
| **01:00** | **+0.0694%** | +0.0218% | 50.2% | **0.79** |
| 02:00 | +0.0317% | −0.0082% | 49.9% | 0.39 |
| 03:00 | −0.0109% | −0.0699% | 48.5% | −0.13 |
| 04:00 | −0.0015% | +0.0124% | 50.4% | −0.02 |
| 05:00 | −0.0475% | +0.0158% | 50.8% | −0.63 |

01:00 có t-stat cao nhất (0.79) — vẫn **rất xa mốc 2.0** cần để có ý nghĩa thống kê. Không giờ nào
có drift thật.

## PHẦN 2 — Biến thể chia 2 batch (gia hạn tới 16:00 khi âm quá 0.5%)

| Variant | Win% | R:R | PF | Cần hòa | **NET $** | Comp. $1000 | Max DD | Avg hold |
|---|---|---|---|---|---|---|---|---|
| Baseline (chốt hết 08:00) | 51.0% | 0.80 | 0.84 | 55.5% | −$722.28 | $439.74 | **57.0%** | 6.9h |
| **Case A** (batch2 → entry) | 51.0% | 0.81 | 0.84 | 55.3% | **−$675.84** | $448.72 | 60.4% | 9.1h |
| **Case B** (batch2 → −0.5%) | 51.0% | 0.81 | **0.85** | 55.2% | **−$661.31** | **$458.20** | 58.2% | 8.7h |
| **Rule cuối** (không mốc, tới 16:00) | **57.5%** | — | 0.83 | — | **−$842.70** | $373.92 | **67.8%** | — |

📌 **Đây là điểm SOL khác ETH rõ nhất.** Trên ETH, gia hạn làm **xấu thêm** ($646 → $953/$899).
Trên SOL, gia hạn **có mốc damage-control lại nhích tốt hơn** baseline: −$722 → **−$676 (A)** /
**−$661 (B)**, PF 0.84 → 0.85. Nhưng:

- Mức cải thiện chỉ **$61 trên 576 lệnh = $0.11/lệnh**, so với sai số chuẩn ≈ **$1.05/lệnh**
  → **0.10 SE, hoàn toàn là nhiễu**. Không thể kết luận gia hạn giúp ích trên SOL.
- **Max DD lại xấu hơn** (57.0% → 60.4% / 58.2%) — trả bằng rủi ro để đổi lấy $61 không đáng tin.
- **Rule cuối user chốt (không mốc damage-control) vẫn tệ hơn baseline rõ rệt**: −$843, DD 67.8%.

### Fee sensitivity — chi tiết đáng chú ý

| Fee/side | Baseline | Case A | Case B |
|---|---|---|---|
| **0.00% (gross)** | **−$31.32** | **+$15.17** | **+$29.72** |
| 0.05% | −$607.15 | −$560.70 | −$546.16 |
| **0.06%** | **−$722.28** | **−$675.84** | **−$661.31** |
| 0.10% | −$1,182.68 | −$1,136.28 | −$1,121.76 |

Trên SOL gia hạn **có mốc** làm gross từ −$31 lên **+$15 / +$30** (ngược với ETH, nơi gia hạn kéo
gross từ +$45 xuống −$308 / −$208). Nhưng +$30 gross trên 576 lệnh vẫn là zero về mặt kinh tế, và
phí 0.12%/lệnh xoá sạch.

### Per year — đảo dấu

| Year | Baseline | Case A | Case B |
|---|---|---|---|
| 2025 | −$259.45 | **−$103.45** | **−$120.61** |
| 2026 YTD | **−$462.83** | −$572.39 | −$540.69 |

Gia hạn tốt hơn ở 2025 nhưng tệ hơn ở 2026 → **không nhất quán**, đúng như đã thấy trên ETH.

## 🔴 Tỉ lệ force đóng tại 16:00 UTC

### Rule cuối user chốt (batch 2 không có mốc, TP +2% là cửa lãi duy nhất)

| | SOL | (ETH) |
|---|---|---|
| **% tổng lệnh** | **30.4%** (175/576) | 28.0% (161/576) |
| **% batch 2** | **90.7%** (175/193) | 93.1% (161/173) |
| Vào batch 2 | 193 (33.5%) | 173 (30.0%) |
| Chạy tiếp rồi ăn TP +2% | 18 (**9.3%** của batch 2) | 12 (6.9%) |
| Net nhóm force đóng | **−$4,564.60** | −$4,258.91 |
| Avg/lệnh | **−$26.08** | −$26.45 |
| Worst | **−$118.23** | −$106.94 |
| Lệnh xanh | 19/175 = **10.9%** | 13/161 = 8.1% |

**Theo năm:** 2025 **28.2%** (103/365) · 2026 **34.1%** (72/211)
**Theo tháng:** dao động **19% – 43%** (thấp nhất 2025-07/08/12 = 19%, cao nhất 2026-04 = 43%)

### Các biến thể có mốc damage-control

| Mốc | Force đóng | % tổng | % batch 2 | Avg/lệnh | Xanh |
|---|---|---|---|---|---|
| NO target (rule cuối) | 175 | **30.4%** | 90.7% | −$26.08 | 19 |
| entry 0.00% (Case A) | 118 | **20.5%** | 61.1% | −$33.64 | 0 |
| entry −0.50% (Case B) | 89 | **15.5%** | 46.1% | −$38.21 | 0 |
| entry −1.00% | 60 | 10.4% | 31.1% | −$43.14 | 0 |
| entry −1.50% | 39 | 6.8% | 20.2% | −$49.94 | 0 |
| entry −2.00% | 27 | 4.7% | 14.0% | −$56.32 | 0 |
| entry −3.00% | 12 | **2.1%** | 6.2% | **−$70.33** | 0 |

Cùng quan hệ nghịch như ETH: mốc càng sâu → càng ít lệnh force đóng nhưng **mỗi lệnh càng nặng**.
Và với mọi mốc có yêu cầu hồi vốn, **0 lệnh force đóng nào xanh** (tất yếu — chúng tới 16:00 vì
chưa bao giờ hồi tới mốc).

### Theo deadline (Case A)

| Deadline | Force đóng | % tổng | Avg/lệnh | Net nhóm | Worst |
|---|---|---|---|---|---|
| 10:00 | 171 | 29.7% | −$23.82 | −$4,073.11 | −$106.21 |
| 12:00 | 155 | 26.9% | −$25.42 | −$3,939.77 | −$99.78 |
| **16:00** | 118 | **20.5%** | −$33.64 | −$3,969.79 | −$118.23 |
| 20:00 | 105 | 18.2% | −$41.59 | −$4,366.46 | **−$207.14** |
| 00:00 | 93 | 16.1% | −$43.71 | −$4,064.72 | −$205.52 |

Y hệt ETH: kéo deadline dài ra **không giảm tổng thiệt hại** (net nhóm đứng quanh −$3.9k…−$4.4k),
chỉ đổi nhiều lệnh lỗ nhỏ thành ít lệnh lỗ to, và **đuôi rủi ro dài hẳn ra**: worst −$106 → **−$207**.

## Takeaway

Rule long 00:00 / TP +2% / chốt 08:00 trên SOL **lỗ y như ETH**: win rate **51.0%** nhưng cần
**55.5%** mới hòa (thiếu 4.5 điểm), PF **0.84**, NET **−$722**, compound $1000 → **$440**, max DD
**57.0%**. Gross chỉ **−$31** trên 576 lệnh → không có edge, toàn bộ lỗ là phí. Green months 5/19.
SOL biên độ lớn hơn ETH nên TP +2% khớp nhiều hơn (26.9% vs 20.7%) và avg win lớn hơn ($12.45 vs
$10.66) — nhưng avg loss cũng lớn hơn tương ứng ($15.54 vs $13.84), nên R:R và PF gần như y hệt.
Quét TP 1–3% × giờ chốt: **40/40 ô âm** (trên SOL thì TP +3% tốt hơn TP +2%, khác ETH — biên độ lớn
hơn nên TP rộng hơn hợp lý, nhưng vẫn âm).

**Tỉ lệ force đóng 16:00 với rule cuối: 30.4% (175/576)** — nhích hơn ETH (28.0%). Bằng **90.7%**
số lệnh vào batch 2; chỉ **9.3%** lệnh chạy tiếp ăn được TP +2%. Theo năm 28.2% (2025) → 34.1%
(2026), theo tháng 19–43%.

**Điểm SOL khác ETH — và cần đọc cẩn thận:** trên SOL, gia hạn **có mốc damage-control** nhích tốt
hơn baseline (−$722 → −$661/−$676, gross từ −$31 lên +$15/+$30), ngược với ETH nơi gia hạn làm xấu
thêm. Nhưng mức cải thiện chỉ **$0.11/lệnh so với sai số chuẩn $1.05/lệnh (0.10 SE)** — **là nhiễu,
không phải edge** — trong khi **max DD lại xấu hơn** (57.0% → 58.2–60.4%) và kết quả **đảo dấu theo
năm** (tốt hơn 2025, tệ hơn 2026). Đừng kết luận "gia hạn hợp với SOL". Còn **rule cuối user chốt
(batch 2 không có mốc) vẫn tệ hơn baseline rõ rệt trên SOL: −$843, PF 0.83, DD 67.8%** — và lại
đúng win rate trap: win rate cao nhất (**57.5%**) đi kèm lỗ nặng nhất.

Xếp hạng giờ vào lệnh trên SOL là **01:00** (−$446, PF 0.89) chứ không phải 00:00 như ETH, và 03:00
tệ nhất (−$1,119). Thứ tự khác hoàn toàn giữa hai coin → thêm bằng chứng **giờ vào là nhiễu**. Raw
drift xác nhận: t-stat cao nhất là 0.79 (01:00), còn xa mốc 2.0.

**Kết luận chung cho cả ETH và SOL:** cùng một rule, cùng một kết cục, cùng một nguyên nhân — khung
giờ không tạo drift nên gross ≈ 0, và phí 0.12%/lệnh × 365 lệnh/năm ≈ −44% size/năm ăn hết. Mọi
cách quản lý thời gian thoát (gia hạn, đổi deadline, đổi mốc) chỉ dịch chuyển phương sai. Nút cần
xoay vẫn là **stop-loss** (cắt đuôi −$93 / −$118) hoặc **filter điều kiện thị trường**.
