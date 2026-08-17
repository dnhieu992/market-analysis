# BTC — DCA $10/ngày, bán sạch cuối mỗi năm (2021 → nay)

**Ngày chạy:** 2026-08-15

## Ý tưởng

"Từ ngày 1/1 mỗi năm, mỗi ngày mua $10 BTC. Ngày cuối năm bán hết. Sang năm làm lại."

Mỗi năm là một chu kỳ độc lập — lãi rút ra, không compound (năm sau vẫn $10/ngày).

## Command

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-yearly-dca-10usd.ts 2021-01-01 10 0.05
```

## Config

| Tham số | Giá trị |
|---|---|
| Symbol | BTC/USD (Bitstamp daily OHLC) |
| Kỳ | 2021-01-01 → 2026-08-15 |
| Mua | $10 tại **open** mỗi ngày, bắt đầu 1/1 |
| Bán | **toàn bộ** tại **close** ngày giao dịch cuối của năm |
| Fee | 0.05%/side (0.1% round-trip) |
| Đòn bẩy / SL | không |
| Vốn | không compound (rút lãi mỗi năm) |

## Kết quả từng năm

| Năm | Ngày | Đã bỏ vào | Giá vốn TB | Giá bán | Thu về | Lãi/Lỗ | ROI | B&H năm đó | Lỗ tạm sâu nhất | Lãi tạm cao nhất |
|---|---|---|---|---|---|---|---|---|---|---|
| 2021 | 365 | $3,650 | 45,280 | 46,214 | $3,723 | **+$73** | +2.0% | +59.4% | −35.4% | +56.0% |
| 2022 | 365 | $3,650 | 24,964 | 16,528 | $2,415 | **−$1,235** | −33.8% | −64.2% | −52.5% | +17.9% |
| 2023 | 365 | $3,650 | 27,679 | 42,258 | $5,570 | **+$1,920** | +52.6% | +155.6% | −8.5% | +65.4% |
| 2024 | 366 | $3,660 | 62,841 | 93,381 | $5,436 | **+$1,776** | +48.5% | +121.0% | −14.9% | +74.9% |
| 2025 | 365 | $3,650 | 100,322 | 87,496 | $3,182 | **−$468** | −12.8% | −6.3% | −21.0% | +28.2% |
| 2026\* | 227 | $2,270 | 71,046 | 62,974 | $2,011 | **−$259** | −11.4% | −28.0% | −31.5% | +10.4% |

\* 2026 chưa xong — mark-to-market tại close 2026-08-15.

**TỔNG:** bỏ vào $20,530 · **lãi +$1,807 (+8.8% trên tổng tiền đã rải)** · phí $21 · 3/6 năm có lãi.

## So sánh cùng số tiền, cùng cửa sổ

| Chiến lược | Bỏ vào | Giá trị/Thu về | Lãi/Lỗ | ROI |
|---|---|---|---|---|
| DCA $10/ngày, **bán cuối mỗi năm** | $20,530 | $22,337 | +$1,807 | **+8.8%** |
| DCA $10/ngày, **không bán** | $20,530 | $30,544 | +$10,014 | **+48.8%** |
| All-in ngày đầu (1/1/2021), giữ tới nay | $20,530 | $44,537 | +$24,007 | **+116.9%** |

BTC: open 2021-01-01 = 29,000 → close 2026-08-15 = 62,974.

## Takeaway

Kế hoạch chạy được nhưng **luật bán cuối năm chính là chỗ mất tiền**. Ngày 31/12 là một
mốc lịch hoàn toàn ngẫu nhiên so với chu kỳ BTC: nó ép chốt lỗ đúng đáy 2022 (−$1,235,
riêng năm này ăn hết 2/3 tổng lãi của cả 5 năm còn lại) và ép chốt cả 2025 lẫn 2026 khi
giá đang dưới giá vốn. Chỉ cần bỏ luật bán đó đi — vẫn DCA $10/ngày, chỉ giữ — kết quả
tăng từ +8.8% lên +48.8% với đúng số tiền đó. So với B&H từng năm, DCA luôn kém xa trong
năm tăng (2023: +52.6% vs +155.6%) vì tiền vào từ từ, nhưng đổi lại đỡ đau hơn hẳn trong
năm giảm (2022: −33.8% vs −64.2%) và drawdown tạm thời nhẹ hơn nhiều. Điểm đáng chú ý
khác: mọi năm đều có lúc lãi tạm dương (peakMtm dương ở cả 6 năm, kể cả 2022 +17.9%) —
tức một luật thoát theo **lợi nhuận** (TP quanh +8–15% trên giá vốn TB, kiểu run
2026-08-07 seasonal DCA) tốt hơn hẳn một luật thoát theo **ngày**.
