# ETH — DCA $10/ngày: quét mức chốt lời 8% / 10% / 15% trên giá trung bình

**Date:** 2026-08-04
**Symbol:** ETHUSDT · **TF:** D1 · **Giai đoạn:** 2025-01-01 → 2026-08-04 (581 ngày)
**Tiếp nối:** [`2026-08-04-eth-daily-dca-avgcost-tp15.md`](./2026-08-04-eth-daily-dca-avgcost-tp15.md)
**Yêu cầu user:** thử TP 8% và 10% xem có khá hơn 15% không.

## Rule tested

Y hệt run trước, chỉ đổi `tpPct`: mua $10 tại open mỗi ngày → bán sạch khi giá chạm
`avgCost × (1 + tp)` → hôm sau mở chu kỳ mới. Không SL. Fee 0.05%/side. Hai mô hình khớp
TP: `touch` (limit sell nằm sẵn, khớp khi high chạm) và `close` (close ngày ≥ target).

## Command

```bash
for tp in 8 10; do
  TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
    scripts/run-daily-dca-tp-cycle-backtest.ts ETHUSDT 2025-01-01 2026-08-04 10 $tp 0.05 touch
  TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
    scripts/run-daily-dca-tp-cycle-backtest.ts ETHUSDT 2025-01-01 2026-08-04 10 $tp 0.05 close
done
```

## Bảng so sánh

### `touch` (limit sell nằm sẵn)

| TP | chu kỳ chốt | lãi thực hiện | chu kỳ dài nhất | TB/chu kỳ | chu kỳ mở cuối kỳ | **net P/L** |
|----|-------------|---------------|-----------------|-----------|--------------------|-------------|
| **8%** | **13** | +$222.49 | 129 ngày | 21.5 ngày | 301 ngày · $3,010 · −19.9% | **−$375.42** |
| **10%** | 8 | +$232.71 | 129 ngày | 29.3 ngày | 347 ngày · $3,470 · −24.8% | −$629.22 |
| **15%** | 4 | +$330.23 | 130 ngày | 55.3 ngày | 360 ngày · $3,600 · −26.0% | −$604.93 |

### `close` (ngày check 1 lần)

| TP | chu kỳ chốt | lãi thực hiện | chu kỳ dài nhất | TB/chu kỳ | chu kỳ mở cuối kỳ | **net P/L** |
|----|-------------|---------------|-----------------|-----------|--------------------|-------------|
| **8%** | 7 | +$307.94 | 130 ngày | 33.4 ngày | 347 ngày · $3,470 · −24.9% | −$555.07 |
| **10%** | 6 | +$324.59 | 130 ngày | 39.0 ngày | 347 ngày · $3,470 · −24.9% | −$538.02 |
| **15%** | 4 | +$369.05 | 130 ngày | 56.0 ngày | 357 ngày · $3,570 · −25.7% | −$549.19 |

### Chi tiết TP 8% `touch` — 13 chu kỳ

| # | start → end | days | invested | avgCost | exit | profit |
|---|-------------|------|----------|---------|------|--------|
| 1 | 2025-01-01 → 2025-05-09 | 129 | $1,290 | 2,233.76 | 2,412.46 | +$102.50 |
| 2 | 2025-05-10 → 2025-05-10 | 1 | $10 | 2,346.21 | 2,533.91 | +$0.79 |
| 3 | 2025-05-11 → 2025-05-13 | 3 | $30 | 2,531.80 | 2,734.35 | +$2.38 |
| 4 | 2025-05-14 → 2025-05-29 | 16 | $160 | 2,570.34 | 2,775.96 | +$12.71 |
| 5 | 2025-05-30 → 2025-06-10 | 12 | $120 | 2,552.94 | 2,757.17 | +$9.54 |
| 6 | 2025-06-11 → 2025-07-09 | 29 | $290 | 2,505.24 | 2,705.66 | +$23.04 |
| 7 | 2025-07-10 → 2025-07-10 | 1 | $10 | 2,770.13 | 2,991.74 | +$0.79 |
| 8 | 2025-07-11 → 2025-07-16 | 6 | $60 | 2,996.08 | 3,235.77 | +$4.77 |
| 9 | 2025-07-17 → 2025-07-20 | 4 | $40 | 3,496.53 | 3,776.26 | +$3.18 |
| 10 | 2025-07-21 → 2025-08-08 | 19 | $190 | 3,699.70 | 3,995.68 | +$15.10 |
| 11 | 2025-08-09 → 2025-08-12 | 4 | $40 | 4,185.48 | 4,520.32 | +$3.18 |
| 12 | 2025-08-13 → 2025-08-22 | 10 | $100 | 4,411.71 | 4,764.64 | +$7.95 |
| 13 | 2025-08-23 → 2025-10-07 | 46 | $460 | 4,400.44 | 4,752.47 | +$36.55 |
| **OPEN** | **2025-10-08 → nay** | **301** | **$3,010** | 2,339.43 | (close 1,874.72) | **−$597.91** |

## Takeaway

Hạ TP **không cứu được luật này**. Lãi thực hiện gần như đứng yên ở mọi mức TP
(+$222 … +$369): TP thấp cho nhiều chu kỳ hơn nhưng mỗi chu kỳ ăn ít hơn, hai cái triệt tiêu nhau —
13 chu kỳ ở TP 8% chỉ đẻ ra +$222, còn **ít hơn** 4 chu kỳ ở TP 15% (+$330). Trong khi đó net P/L
âm ở **cả 6 kịch bản**, vì thứ quyết định kết quả không phải mức TP mà là **cái bag đang treo**:
mọi biến thể đều kẹt trong cùng downtrend ETH từ Q3-2025, ôm $3.0k–3.6k và âm 20–26%.

Chi tiết dễ đọc nhầm: TP 8% `touch` có net "đỡ nhất" (−$375) **không phải vì rule tốt hơn** —
nó chỉ may mắn chốt được thêm một chu kỳ vào 2025-10-07, nên chu kỳ treo bắt đầu muộn hơn 2 tuần
và cam kết ít vốn hơn ($3,010 thay vì $3,600). Đổi ngày bắt đầu backtest vài ngày là thứ tự này đảo.
Bằng chứng: cùng TP 10%, `touch` cho −$629 còn `close` cho −$538 — chênh $91 chỉ do timing.
Chu kỳ dài nhất **không đổi theo TP: 129–130 ngày** ở cả 6 kịch bản, vì nó luôn là chu kỳ đầu
2025-01 → 2025-05.

Kết luận: tham số TP là nhánh sai. Vấn đề nằm ở chỗ luật **không có cơ chế xử lý chu kỳ không bao giờ
đóng** — mà đó là chu kỳ nuốt toàn bộ vốn. Muốn cứu thì phải sửa cấu trúc: trần vốn/chu kỳ (dừng mua
khi chạm trần), hoặc TP giảm dần theo thời gian giữ (vd −1%/tháng), hoặc chốt từng phần thay vì
bán sạch, hoặc lọc chỉ DCA khi ETH trên EMA tuần. Chưa test các nhánh này.
