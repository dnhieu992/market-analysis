# ETH — DCA $10/ngày, chốt hết khi giá vượt giá trung bình +15%, xong bắt đầu chu kỳ mới

**Date:** 2026-08-04
**Symbol:** ETHUSDT · **TF:** D1 · **Giai đoạn:** 2025-01-01 → 2026-08-04 (581 ngày)
**Yêu cầu user:** mỗi ngày mua $10, khi giá lên +15% so với **giá trung bình** thì bán sạch,
hôm sau bắt đầu chu kỳ mới. Chỉ backtest 2025–2026. Hỏi: **chốt lời được mấy chu kỳ** và
**chu kỳ dài nhất bao lâu**.

## Rule tested

- **Mua:** $10 tại **open** của mỗi nến ngày (00:00 UTC), không bỏ ngày nào.
- **Chốt:** khi giá chạm `avgCost × 1.15` → **bán 100%** bag. Không TP từng phần, không SL.
- **Reset:** chu kỳ kết thúc ngay ngày chốt; ngày hôm sau mở chu kỳ mới, avgCost về 0.
- Lệnh mua của **ngày chốt vẫn được thực hiện** (mua 00:00 xảy ra trước khi giá chạm TP trong ngày).
- Spot, không đòn bẩy. Fee **0.05%/side** (theo CLAUDE.md).
- **Hai mô hình khớp TP:**
  - `touch` — lệnh bán limit nằm sẵn ở target, khớp ngay khi **high trong ngày** chạm target.
  - `close` — chỉ thoát nếu **close ngày** ≥ target (kiểu ngày check 1 lần), khớp tại close.

## Command

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-daily-dca-tp-cycle-backtest.ts ETHUSDT 2025-01-01 2026-08-04 10 15 0.05 touch
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-daily-dca-tp-cycle-backtest.ts ETHUSDT 2025-01-01 2026-08-04 10 15 0.05 close
```

Script mới: `scripts/run-daily-dca-tp-cycle-backtest.ts`.

## Kết quả — `touch` (limit sell nằm sẵn)

| # | start | end | days | buys | invested | avgCost | target | exit | profit | ROI% | worst DD% |
|---|-------|-----|------|------|----------|---------|--------|------|--------|------|-----------|
| 1 | 2025-01-01 | 2025-05-10 | 130 | 130 | $1,300 | 2,234.59 | 2,569.77 | 2,569.77 | +$194.25 | 14.94 | −43.6 |
| 2 | 2025-05-11 | 2025-07-10 | 61 | 61 | $610 | 2,536.70 | 2,917.21 | 2,917.21 | +$91.15 | 14.94 | −17.4 |
| 3 | 2025-07-11 | 2025-07-17 | 7 | 7 | $70 | 3,044.69 | 3,501.40 | 3,501.40 | +$10.46 | 14.94 | −1.8 |
| 4 | 2025-07-18 | 2025-08-09 | 23 | 23 | $230 | 3,690.42 | 4,243.98 | 4,243.98 | +$34.37 | 14.94 | −8.8 |
| **OPEN** | **2025-08-10** | **chưa chốt** | **360** | **360** | **$3,600** | **2,533.59** | **2,913.63** | (close 1,875.45) | **−$935.16** | **−25.98** | **−49.9** |

- **Chốt lời: 4 chu kỳ** · lãi thực hiện **+$330.23** trên $2,210 đã giải ngân.
- Chu kỳ đã đóng dài nhất: **130 ngày**; ngắn nhất 7 ngày; trung bình 55.3 ngày.
- Chu kỳ thứ 5 mở từ 2025-08-10 và **vẫn chưa chốt sau 360 ngày** — dài gấp ~2.8 lần chu kỳ đóng dài nhất.
- Tổng tiền đã bỏ vào: $5,810 (581 lệnh mua). Vốn peak trong 1 chu kỳ: **$3,600** (chu kỳ đang mở).
- **Net P/L (đã chốt + đang lỗ): −$604.93.**

## Kết quả — `close` (ngày check 1 lần)

| # | start | end | days | invested | exit | profit | ROI% |
|---|-------|-----|------|----------|------|--------|------|
| 1 | 2025-01-01 | 2025-05-10 | 130 | $1,300 | 2,583.23 | +$202.08 | 15.54 |
| 2 | 2025-05-11 | 2025-07-10 | 61 | $610 | 2,951.29 | +$99.34 | 16.29 |
| 3 | 2025-07-11 | 2025-07-20 | 10 | $100 | 3,756.69 | +$18.15 | 18.15 |
| 4 | 2025-07-21 | 2025-08-12 | 23 | $230 | 4,590.52 | +$49.48 | 21.51 |
| **OPEN** | **2025-08-13** | **chưa chốt** | **357** | **$3,570** | (close 1,875.57) | **−$918.24** | **−25.72** |

Cùng kết luận: **4 chu kỳ chốt lời, chu kỳ đóng dài nhất 130 ngày**, chu kỳ 5 treo 357 ngày.
Lãi thực hiện nhỉnh hơn (+$369.05) vì khớp tại close thường vượt target, nhưng net vẫn **−$549.19**.

## Takeaway

Trả lời trực tiếp: **4 chu kỳ chốt lời** trong 2025–2026, **chu kỳ dài nhất (đã đóng) là 130 ngày**
(2025-01-01 → 2025-05-10, 130 lệnh mua, $1,300 vốn). Nhưng con số đáng chú ý không phải 130 —
**chu kỳ thứ 5 đang mở đã 360 ngày** kể từ 2025-08-10, ôm $3,600 và âm 26%; ETH phải chạy từ
$1,875 lên $2,913 (**+55%**) mới đóng được nó. Cả 4 chu kỳ thành công đều rơi vào lúc ETH đi lên hoặc
đi ngang có nhịp hồi ≥15%; khi ETH vào downtrend dài thì luật "+15% trên avg" không bao giờ kích hoạt,
DCA đều đặn kéo avg xuống chậm hơn giá rơi, và cái đuôi đó nuốt sạch $330 lãi của 4 chu kỳ trước.
Rủi ro thật của luật này không nằm ở tỉ lệ thắng (4/4 = 100%) mà nằm ở **vốn phải cam kết cho chu kỳ
không bao giờ đóng**: peak $3,600 và vẫn tăng $10/ngày, drawdown nội bộ chạm −49.9%. Nếu muốn dùng
luật này thật, phải trả lời trước: trần vốn cho một chu kỳ là bao nhiêu, và làm gì khi chạm trần
(dừng mua / hạ mục tiêu chốt / chốt một phần).
