# ETH — QQE ▲ spot (long only, không SL): quét mức chốt lời

**Date:** 2026-07-30
**Symbol:** ETHUSDT · **TF:** H4 · **Indicator:** QQE ▲ của chart /bitget (rsiPeriod 10, smoothing 4, qqeFactor 3.2)
**Yêu cầu:** user chơi **spot**, chỉ quan tâm **tỉ lệ win**, không quan tâm R:R → tìm mức TP hợp lý.
**Tiếp nối:** [`2026-07-30-eth-qqe-h4-tp10-sl20.md`](./2026-07-30-eth-qqe-h4-tp10-sl20.md)

## Rule tested

- **Spot = LONG ONLY** (không short được trên spot). Chỉ dùng mũi tên ▲ xanh.
- **Entry:** nến H4 đóng với ▲ → mua tại close nến đó.
- **Exit:** chỉ TP **+x%**. **Không stop-loss, không giới hạn thời gian** — giữ tới khi chạm TP.
- Fee 0.06%/side. Không đòn bẩy.
- **Hai chế độ hạch toán:**
  - **INDEPENDENT** — mỗi ▲ là một lệnh riêng, cho phép trùng lệnh (giống mua spot nhiều lần).
    Đo chất lượng thô của tín hiệu, n = 750 mũi tên.
  - **SEQUENTIAL** — mỗi lúc 1 vị thế, ▲ xuất hiện khi đang giữ thì bỏ qua (một ví spot thật).

## Command

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-qqe-spot-tp-scan.ts ETHUSDT 3200 4h 0.06     # toàn lịch sử
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-qqe-spot-tp-scan.ts ETHUSDT 2025-01-01 4h 0.06   # stress test
```

Script mới: `scripts/run-qqe-spot-tp-scan.ts`.

## ⚠️ Cảnh báo phải đọc trước bảng số

Khi **không có SL và giữ vô hạn**, **win rate cao là hệ quả tự động của thiết kế**, không phải dấu
hiệu rule tốt. Giữ đủ lâu thì gần như mọi lệnh đều chạm TP → win rate tự tiến về 100%. Cái quyết
định tiền là **1–2 lệnh không bao giờ hồi**, và win rate **hoàn toàn không nhìn thấy chúng**.

Vì vậy mọi mức TP dưới đây đều báo kèm: **thời gian tới TP**, **mức âm sâu nhất (MAE)**, và
**compound thực tế**.

Xử lý right-censoring: mũi tên xuất hiện gần cuối dữ liệu chưa kịp chạm TP nên bị tính là "chưa
chạm" một cách oan. Cột **mature hit** chỉ tính các tín hiệu đã có ≥ 180 ngày dữ liệu phía trước,
nên không bị thổi phồng.

## TOÀN LỊCH SỬ (2017-10-25 → 2026-07-30, 8.8 năm, 750 mũi tên ▲)

### SEQUENTIAL — một ví spot thật

| TP | Net win | n | **HIT RATE** | Chưa chạm | Ngày tới TP (med/p90/max) | MAE khi thắng (med/p10/worst) | **Compound $1000** |
|---|---|---|---|---|---|---|---|
| **+1%** | +0.88% | 87 | **98.9%** | 1 | 0.2 / 2.2 / 1,325 | −1.4% / −9.1% / −91.4% | **$1,151** |
| +1.5% | +1.38% | 78 | 98.7% | 1 | 0.3 / 2.8 / 1,325 | −1.8% / −10.8% / −91.5% | $1,556 |
| **+2%** | +1.88% | 68 | **98.5%** | 1 | 0.5 / 2.8 / 1,377 | **−2.0%** / −10.4% / −91.5% | **$1,886** |
| +3% | +2.88% | 49 | 98.0% | 1 | 0.7 / 14.0 / 1,377 | −2.6% / −16.0% / −92.8% | $1,602 |
| +4% | +3.88% | 44 | 97.7% | 1 | 0.8 / 9.2 / 1,379 | −2.9% / −20.2% / −92.8% | $2,141 |
| **+5%** | +4.87% | 42 | **97.6%** | 1 | 1.0 / 9.2 / 1,379 | −4.2% / −20.2% / −92.8% | **$2,937** |
| +7% | +6.87% | 26 | 96.2% | 1 | 2.5 / 19.7 / 1,108 | −7.2% / −22.4% / −93.9% | $2,149 |
| +10% | +9.87% | 20 | 95.0% | 1 | 7.0 / 20.2 / 1,117 | −8.4% / −22.4% / −93.9% | $2,439 |
| +15% | +14.86% | 15 | 93.3% | 1 | 9.7 / 173.3 / 1,118 | −10.4% / −55.4% / −93.9% | $3,059 |
| **+20%** | +19.86% | 14 | 92.9% | 1 | 14.3 / 178.2 / 1,118 | −13.9% / −55.4% / −93.9% | **$4,473** |
| +30% | +29.84% | 9 | 88.9% | 1 | 18.7 / 60.7 / 1,120 | −12.7% / −29.1% / −93.9% | $3,578 |
| **+50%** | +49.82% | 7 | **85.7%** | 1 | 26.3 / 1,134 / 1,135 | −18.0% / −29.1% / −93.9% | **$5,692** |
| — | — | — | — | — | — | — | **B&H $6,585** |

### INDEPENDENT — chất lượng thô của tín hiệu (n = 750, mẫu lớn)

| TP | **HIT RATE** | Mature hit | Chưa chạm | Ngày tới TP (med/p90) | MAE khi thắng (med/p10) |
|---|---|---|---|---|---|
| +1% | **99.3%** | 99.7% (747) | 5 | 0.3 / 6.7 | −1.3% / −9.9% |
| +2% | **98.9%** | 99.6% (745) | 8 | 0.8 / 20.8 | −1.7% / −17.2% |
| +3% | 98.5% | 99.3% (744) | 11 | 1.8 / 45.3 | −2.6% / −23.0% |
| +5% | 97.1% | 98.5% (739) | 22 | 4.0 / 113.3 | −4.4% / −40.6% |
| +7% | 95.9% | 98.0% (734) | 31 | 6.7 / 175.0 | −5.7% / −49.9% |
| +10% | 93.9% | 96.0% (733) | 46 | 11.8 / 211.3 | −8.0% / −60.3% |
| +15% | 91.6% | 94.5% (727) | 63 | 25.5 / 471.2 | −11.3% / −67.4% |
| +20% | 89.6% | 93.2% (721) | 78 | 35.7 / 529.5 | −13.2% / −69.6% |
| +30% | 86.0% | 90.6% (712) | 105 | 61.5 / 682.2 | −17.1% / −70.5% |
| +50% | 79.7% | 84.1% (711) | 152 | 108.8 / 851.3 | −18.1% / −70.7% |

📌 **Win rate và lợi nhuận đi NGƯỢC CHIỀU nhau, đơn điệu trên toàn dải:**
TP +1% cho win rate **cao nhất (98.9%)** và compound **thấp nhất ($1,151)**.
TP +50% cho win rate **thấp nhất (85.7%)** và compound **cao nhất ($5,692)**.
**Không mức nào vượt buy & hold ($6,585).**

## 🔴 STRESS TEST: 2025-01-01 → 2026-07-30 (ETH −42.7%) — SEQUENTIAL

| TP | n | **HIT RATE** | Chưa chạm | Ngày tới TP (med) | MAE (med) | **Compound $1000** |
|---|---|---|---|---|---|---|
| +1% | 21 | **95.2%** | 1 | 1.2 | −1.7% | **$646** |
| +1.5% | 20 | 95.0% | 1 | 1.3 | −2.9% | $703 |
| **+2%** | 19 | **94.7%** | 1 | 2.5 | −2.9% | **$758** |
| +3% | 11 | 90.9% | 1 | 7.5 | −8.4% | $545 |
| +4% | 7 | 85.7% | 1 | 5.3 | −4.2% | $525 |
| +5% | 7 | 85.7% | 1 | 8.3 | −10.7% | $556 |
| +7% | 5 | 80.0% | 1 | 19.3 | −10.1% | $545 |
| +10% | 3 | **66.7%** | 1 | 198.7 | −10.1% | $513 |
| +15% | 2 | **50.0%** | 1 | 217.5 | −60.1% | $488 |
| +20% | 2 | 50.0% | 1 | 218.2 | −60.1% | $509 |
| +30% | 2 | 50.0% | 1 | 221.7 | −60.1% | $552 |
| +50% | 1 | **0.0%** | 1 | — | — | $553 |

**Mọi mức TP đều lỗ.** Và đây là con số quyết định toàn bộ câu hỏi:

### TP +2%: win rate 94.7% → vẫn MẤT 24% vốn

Kiểm chứng số học chính xác:

- **18 lệnh thắng liên tiếp**, mỗi lệnh +1.88% net → `1.0188^18` = **+39.8%**
- **1 lệnh chưa hồi** (entry 2025-11-13), hiện **−45.7%** → `× 0.5423`
- Kết quả: `1.398 × 0.5423` = **0.758** → **$758** ✓ (khớp bảng)

**Một lệnh xoá sạch 18 lệnh thắng.** Win rate 94.7% không hề nhìn thấy điều đó.

### Lệnh chưa hồi — vốn bị khoá bao lâu

| TP | Entry chưa chạm | Mark hiện tại |
|---|---|---|
| +2% | 2025-11-13 | **−45.7%** |
| +3% | 2025-10-06 | **−58.9%** |
| +5% | 2025-08-26 | **−58.2%** |
| +10% / +20% / +30% | 2025-08-12 | **−57.5%** |

Ở chế độ SEQUENTIAL, một lệnh không hồi **khoá toàn bộ ví** — mọi mũi tên ▲ sau đó bị bỏ qua. Lệnh
từ 2025-08-12 đã khoá vốn **hơn 11 tháng** và vẫn âm 57.5%. Đó là lý do TP +10% chỉ có **3 lệnh**
trong 1.6 năm.

Toàn lịch sử cũng vậy: **mọi mức TP đều có đúng 1 lệnh chưa hồi**, và MAE tệ nhất ở mọi mức là
**−91% đến −94%** (lệnh vào đỉnh 2021).

## Trả lời câu hỏi: mức chốt lời hợp lý?

### Nếu chỉ tối đa hoá win rate → **TP +2%**

Không phải +1%, dù +1% có win rate nhích hơn:

| | TP +1% | **TP +2%** |
|---|---|---|
| Win rate (toàn kỳ / 2025+) | 98.9% / 95.2% | **98.5% / 94.7%** |
| Net win mỗi lệnh | +0.88% | **+1.88%** |
| Phí round-trip | 0.12% | 0.12% |
| **Net win / phí** | **7.3×** | **15.7×** |
| Compound toàn kỳ | $1,151 | **$1,886** |
| Compound 2025+ | $646 | **$758** |
| Ngày tới TP (med) | 0.2 | 0.5 |
| MAE med | −1.4% | −2.0% |

TP +1% mất **0.4 điểm win rate** để đổi lấy **hơn gấp đôi lợi nhuận mỗi lệnh** — và nó là mức
**tốt nhất ở cả hai cửa sổ** trong nhóm win-rate cao. Dưới +2% thì phí bắt đầu ăn quá nhiều phần lãi.

**Cấu hình đề xuất nếu bám tiêu chí win rate:** TP **+2%**, ~7.6 lần chạm TP/năm (toàn kỳ) hoặc
11.4 lần/năm (2025+), median 0.5–2.5 ngày/lệnh, MAE median chỉ −2.0%.

### Nhưng phải nói thẳng: tiêu chí "chỉ quan tâm win rate" là cái làm rule này lỗ

Đây là lần thứ **sáu** trong loạt backtest này win rate cao đi kèm lợi nhuận thấp, và lần này nó
quyết định trực tiếp: quan hệ **đơn điệu** trên toàn dải TP — win rate càng cao thì compound càng
thấp. Ở cửa sổ bear, TP +2% với **94.7% win rate vẫn mất 24% vốn** vì 1 lệnh −45.7%.

**Lý do "spot nên không cần quan tâm R:R" không đúng:** spot đúng là không bị thanh lý, nhưng
- vốn vẫn **bị khoá** (lệnh 2025-08-12 khoá ví 11 tháng, âm 57.5%);
- lỗ tạm tính vẫn là lỗ thật nếu cần dùng vốn;
- và **compound vẫn bị volatility drag** — 18 thắng × 1.88% không bù nổi 1 lỗ 45.7%.

R:R không biến mất khi chơi spot; nó chỉ chuyển từ "SL" thành "**lệnh không bao giờ hồi**" — và cái
đó không hiện lên trong win rate.

### Nếu muốn rule thực sự có lãi

Grid cho thấy hướng ngược: **TP càng rộng compound càng tốt** (+50% → $5,692 vs +1% → $1,151). Nhưng
**không mức nào thắng buy & hold ($6,585)**. Nên với QQE ▲ trên ETH spot, thứ cần thêm không phải
tinh chỉnh TP mà là **một cách xử lý lệnh không hồi** — ví dụ:
- **Giới hạn thời gian giữ** (time stop) để giải phóng vốn thay vì khoá 11 tháng;
- **Cho phép nhiều lệnh song song** (chế độ INDEPENDENT) để 1 lệnh xấu không khoá cả ví — bảng
  INDEPENDENT cho hit rate cao hơn hẳn (98.9% ở TP +2%) chính vì không bị khoá;
- Hoặc **lọc tín hiệu theo trend D1/W1** để không mua ▲ trong downtrend đã xác lập (lệnh chết đều
  vào 2021-11 và 2025-08 — đúng hai đỉnh trước bear).

## Takeaway

**Mức TP hợp lý nhất theo tiêu chí win rate là +2%**: hit rate **98.5%** (toàn lịch sử) / **94.7%**
(2025+), median **0.5–2.5 ngày** tới TP, MAE median chỉ **−2.0%**, 7.6–11.4 lần chạm TP/năm, và net
win +1.88% = **15.7× phí round-trip**. Nó tốt hơn TP +1% (win rate chỉ nhích 0.4 điểm nhưng lợi
nhuận mỗi lệnh hơn gấp đôi) và là mức tốt nhất ở **cả hai cửa sổ** trong nhóm win-rate cao.

Nhưng kết quả quan trọng hơn là: **tiêu chí "chỉ quan tâm win rate" chính là cái làm rule lỗ.** Quan
hệ win rate ↔ lợi nhuận là **đơn điệu ngược** trên toàn dải TP +1% → +50%: TP +1% cho win rate cao
nhất (98.9%) và compound thấp nhất ($1,151); TP +50% cho win rate thấp nhất (85.7%) và compound cao
nhất ($5,692). Và không mức nào vượt buy & hold ($6,585) trong 8.8 năm.

Bằng chứng dứt điểm nằm ở stress test 2025+: **TP +2%, win rate 94.7%, vẫn mất 24% vốn** — 18 lệnh
thắng liên tiếp (+39.8% cộng dồn) bị **1 lệnh −45.7% xoá sạch**. Với TP không SL, win rate cao là
**hệ quả tự động của thiết kế** (giữ đủ lâu thì gần như mọi lệnh đều chạm TP), nên nó **không chứa
thông tin** về việc có lãi hay không. Toàn bộ kết quả nằm ở 1 lệnh mà win rate không nhìn thấy.

Chơi spot không làm R:R biến mất — nó chỉ đổi hình dạng từ "stop-loss" sang "**lệnh không bao giờ
hồi + vốn bị khoá**". Ở chế độ một-ví-một-lệnh, lệnh vào 2025-08-12 đã khoá vốn **hơn 11 tháng** và
còn âm **57.5%**, khiến TP +10% chỉ vào được **3 lệnh** trong 1.6 năm. Toàn lịch sử, mọi mức TP đều
có đúng 1 lệnh chưa hồi với MAE tệ nhất **−91…−94%** (mua đỉnh 2021).

**Việc nên làm tiếp** không phải tinh chỉnh TP mà là xử lý nhóm lệnh không hồi: thêm **time stop**,
cho **nhiều lệnh song song** (INDEPENDENT cho hit rate cao hơn hẳn vì không khoá ví), hoặc **lọc ▲
theo trend D1/W1** — các lệnh chết đều vào 2021-11 và 2025-08, đúng hai đỉnh trước bear.
