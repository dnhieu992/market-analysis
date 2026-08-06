# ETH — DCA $10/ngày: TP giảm dần theo thời gian giữ (nhánh 2)

**Date:** 2026-08-04
**Symbol:** ETHUSDT · **TF:** D1 · **Giai đoạn:** 2025-01-01 → 2026-08-04 (581 ngày)
**Tiếp nối:** [`2026-08-04-eth-daily-dca-tp-sweep-8-10-15.md`](./2026-08-04-eth-daily-dca-tp-sweep-8-10-15.md)
**Yêu cầu user:** thử nhánh 2 — TP bắt đầu 15%, mỗi tháng treo thì hạ dần.

## Rule tested

Giống baseline (mua $10 tại open mỗi ngày, bán sạch khi chạm target, hôm sau mở chu kỳ mới,
không SL, fee 0.05%/side), chỉ khác **target không còn cố định**:

```
tpNow  = max(floor, 15% − decay × daysHeld / 30)      # prorated theo ngày
target = avgCost × (1 + tpNow)
```

Quét lưới `decay` × `floor`, cả hai mô hình khớp `touch` (limit sell chạm high) và `close`.

## Command

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-daily-dca-decay-tp-backtest.ts ETHUSDT 2025-01-01 2026-08-04 10 15 "0.5,1,2,3" "0,3,5,8" 0.05 touch
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-daily-dca-decay-tp-backtest.ts ETHUSDT 2025-01-01 2026-08-04 10 15 "1,2,3" "-5,-10,-20,-30" 0.05 touch
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-daily-dca-decay-tp-backtest.ts ETHUSDT 2025-01-01 2026-08-04 10 15 "3.5,4,5,6,8" "-50" 0.05 touch
```

Script mới: `scripts/run-daily-dca-decay-tp-backtest.ts`.

## Kết quả 1 — lưới decay chậm (touch). Baseline TP phẳng 15% = −$604.93

| decay/tháng | floor | chu kỳ | lãi thực hiện | dài nhất | chu kỳ mở | **net P/L** |
|---|---|---|---|---|---|---|
| 0.5% | 0/3/5/8% | 4 | +$295.28 | 130 | 360d · $3,600 · −26.1% | −$645.93 |
| **1.0%** | **0/3/5/8%** | **4** | **+$260.79** | **129** | **360d · $3,600 · −26.1%** | **−$680.42** |
| 2.0% | 0/3/5% | 4 | +$191.35 | 129 | 360d · $3,600 · −26.1% | −$749.86 |
| 2.0% | 8% | 4 | +$211.12 | 129 | 360d · $3,600 · −26.1% | −$730.09 |
| 3.0% | 0% | 5 | +$141.04 | 129 | 360d · $3,600 · −26.1% | −$800.17 |
| 3.0% | 8% | 5 | +$215.83 | 129 | 360d · $3,600 · −26.1% | −$725.39 |

**Cột "chu kỳ mở" giống hệt nhau ở cả 16 cấu hình.** Đó là toàn bộ câu chuyện.

Chi tiết cấu hình user đề xuất (decay 1%/tháng, floor 3%):

| # | start → end | days | invested | avgCost | TP@exit | exit | profit | ROI% |
|---|---|---|---|---|---|---|---|---|
| 1 | 2025-01-01 → 2025-05-09 | 129 | $1,290 | 2,233.76 | 10.7% | 2,473.52 | +$137.75 | 10.68 |
| 2 | 2025-05-10 → 2025-07-10 | 62 | $620 | 2,533.38 | 13.0% | 2,861.88 | +$80.04 | 12.91 |
| 3 | 2025-07-11 → 2025-07-17 | 7 | $70 | 3,044.69 | 14.8% | 3,495.31 | +$10.32 | 14.74 |
| 4 | 2025-07-18 → 2025-08-09 | 23 | $230 | 3,690.42 | 14.3% | 4,216.92 | +$32.68 | 14.21 |
| **OPEN** | **2025-08-10 → nay** | **360** | **$3,600** | 2,533.59 | **3.0% (sàn)** | cần 2,610.45 | **−$941.36** | **−26.15** |

TP đã tụt từ 15% xuống chạm sàn 3%, target từ 2,913 xuống 2,610 — **vẫn còn cách giá hiện tại 39.5%.**

## Kết quả 2 — floor âm (biến TP thành cắt lỗ theo thời gian)

| decay | floor −5% / −10% / −20% / −30% | chu kỳ | net P/L |
|---|---|---|---|
| 1.0% | không đổi ở cả 4 mức | 4 | −$680.55 |
| 2.0% | không đổi ở cả 4 mức | 4 | −$749.99 |
| 3.0% | không đổi ở cả 4 mức | 5 | −$800.30 |

Floor âm **không bao giờ kích hoạt**: với decay 1%/tháng phải mất 20 tháng mới hạ TP từ 15% xuống
−5%, mà chu kỳ mới treo 12 tháng. Decay quá chậm so với tốc độ ETH rơi.

## Kết quả 3 — decay nhanh (≥3.5%/tháng), floor không ràng buộc

| decay | touch: chu kỳ / net | close: chu kỳ / net |
|---|---|---|
| 3.5% | 7 / **−$289.50** | 5 / **−$694.49** |
| 4.0% | 9 / **+$179.53** | 6 / **−$356.78** |
| 4.5% | — | 9 / **+$192.30** |
| 5.0% | 9 / +$31.88 | 9 / +$134.69 |
| 6.0% | 11 / −$24.54 | 9 / +$58.09 |
| 8.0% | 14 / −$147.90 | — |

Chi tiết ô "tốt nhất" (decay 4%/tháng, touch, net +$179.53):

| # | start → end | days | invested | avgCost | TP@exit | profit | ROI% |
|---|---|---|---|---|---|---|---|
| 1 | 2025-01-01 → 2025-05-08 | 128 | $1,280 | 2,233.96 | **−1.9%** | **−$25.37** | −1.98 |
| 2–6 | 05/2025 → 10/2025 | 7–58 | $70–580 | — | 7.4–14.2% | +$9.90…+$42.61 | 7.4–14.1 |
| 7 | 2025-10-07 → 2026-01-13 | 99 | $990 | 3,299.37 | **1.9%** | +$18.64 | 1.88 |
| 8 | 2026-01-14 → 2026-04-11 | 88 | $880 | 2,212.40 | **3.4%** | +$29.47 | 3.35 |
| 9 | 2026-04-12 → 2026-07-27 | 107 | $1,070 | 1,950.49 | **0.9%** | +$8.73 | 0.82 |
| OPEN | 2026-07-28 → nay | 8 | $80 | 1,887.70 | 14.1% | −$0.73 | −0.91 |

**Peak capital 1 chu kỳ: $1,280** (baseline $3,600).

## Takeaway

Nhánh 2 **thất bại đúng như cách nó được thiết kế**, và lý do rất cơ học: decay chỉ kéo target
**xuống gần giá vốn**, nhưng cái bag đang kẹt nằm **dưới** giá vốn 26%. Kể cả hạ TP về đúng 0%
(hòa vốn) thì vẫn cần ETH +35% từ giá hiện tại mới thoát. Vì vậy **cả 16 cấu hình decay chậm cho ra
chu kỳ treo y hệt nhau** — 360 ngày, $3,600, −26.1% — trong khi decay lại **cắt bớt lãi của 4 chu kỳ
thắng** (từ $330 xuống $141–295). Kết quả: mọi cấu hình đều **tệ hơn TP phẳng 15%**. Floor âm cũng vô
dụng vì decay 1%/tháng cần 20 tháng mới chạm −5%.

Chỉ khi decay đủ nhanh (≥3.5%/tháng) chu kỳ treo mới đóng được — nhưng lúc đó luật đã biến thành thứ
khác hẳn: "giữ tới khi **về hòa vốn** thì thoát". Nhìn bảng chi tiết decay 4% sẽ thấy rõ — chu kỳ 7, 8, 9
mỗi cái ôm 88–107 ngày rồi thoát ở **+0.9%, +1.9%, +3.4%**, và chu kỳ 1 thoát ở **−1.9%**. Đó không phải
chốt lời, đó là thoát hàng huề vốn để lấy lại vốn.

**Đừng dùng con số +$179 của decay 4%.** Nó là overfit rõ ràng: đổi sang 3.5% ra −$289, sang 5% ra
+$32, sang 6% ra −$25; giữ nguyên 4% mà đổi mô hình khớp từ `touch` sang `close` thì ra −$357. Dấu
của kết quả lật liên tục giữa các tham số cạnh nhau → không có edge, chỉ là các lệnh thoát cưỡng bức
rơi trúng ngày đẹp hay ngày xấu.

Điều thật sự có giá trị rút ra: thứ cải thiện kết quả **không phải TP decay** mà là **giới hạn vốn/thời
gian cho một chu kỳ**. Cấu hình decay nhanh chỉ hay ở đúng một chỗ — peak capital tụt từ **$3,600 xuống
$1,280**. Đó chính là nhánh 1 (trần vốn/chu kỳ), và nên test trực tiếp thay vì đi vòng qua decay.
