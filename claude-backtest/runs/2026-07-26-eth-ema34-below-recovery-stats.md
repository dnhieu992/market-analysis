# ETH — độ sâu dưới EMA34 trước khi hồi lại EMA34 (H4 & D1)

**Câu hỏi:** trung bình nến ETH nằm dưới EMA34 bao nhiêu % thì giá hồi lại được đường EMA34?

Đây là **thống kê phân phối**, không phải backtest P&L (không phí, không TP/SL).

## Command

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-ema34-below-recovery-stats.ts ETHUSDT "4h,1d" 2900 34

# window ngắn để so sánh (2 năm gần nhất)
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-ema34-below-recovery-stats.ts ETHUSDT "4h,1d" 730 34
```

## Config

| | |
|---|---|
| Symbol | ETHUSDT (Binance spot klines) |
| Khung | 4h và 1d |
| Dữ liệu | 2018-08-17 → 2026-07-26 (H4: 17,394 nến; D1: 2,900 nến) |
| EMA | 34, seed bằng SMA(34) trên close |
| "Episode" | bắt đầu ở nến đầu tiên **đóng cửa** dưới EMA34; kết thúc ở nến đầu tiên có **high chạm lại EMA34** (EMA tính lại mỗi nến) |
| Độ sâu | `(EMA34 − low)/EMA34` (theo bóng nến) và `(EMA34 − close)/EMA34` (theo giá đóng cửa) |

## Kết quả — độ sâu trung bình trước khi hồi về EMA34

### H4 (1,343 episodes, 100% đều hồi lại EMA34)

| Chỉ số | avg | median | p75 | p90 | p95 | max |
|---|---|---|---|---|---|---|
| Sâu nhất theo **low** (%) | **3.49** | 2.12 | 4.02 | 7.70 | 10.59 | 53.77 |
| Sâu nhất theo **close** (%) | **2.40** | 1.18 | 2.79 | 5.97 | 8.85 | 43.18 |
| Số nến để chạm lại EMA34 | 5.7 | 2 | 5 | 16 | 27 | 88 |

### D1 (191 episodes, 100% đều hồi lại EMA34)

| Chỉ số | avg | median | p75 | p90 | p95 | max |
|---|---|---|---|---|---|---|
| Sâu nhất theo **low** (%) | **9.08** | 6.02 | 10.52 | 19.51 | 27.68 | 59.37 |
| Sâu nhất theo **close** (%) | **6.30** | 3.26 | 7.87 | 15.32 | 24.15 | 50.17 |
| Số nến để chạm lại EMA34 | 6.8 | 1 | 6.5 | 19 | 36 | 84 |

### 2 năm gần nhất (2024-07 → 2026-07) — gần như không đổi

| Khung | episodes | avg depth (low) | median | p90 | avg bars |
|---|---|---|---|---|---|
| H4 | 357 | 3.25% | 2.05% | 7.22% | 5.8 |
| D1 | 40 | 9.55% | 7.09% | 21.05% | 9.0 |

## Có điều kiện: đã ở dưới EMA34 D% rồi thì sao?

Tất cả episodes đều hồi về EMA34 (100%) — trong 8 năm chưa có lần nào ETH ở dưới EMA34 vĩnh viễn.
Cái thay đổi là **còn sâu thêm bao nhiêu** và **chờ bao lâu**.

### H4

| Đang ở −D% | n | Độ sâu cuối cùng (avg / med) | Số nến tới EMA (avg / med) |
|---|---|---|---|
| −2% | 703 | 5.60 / 3.86 | 9.5 / 4 |
| −4% | 339 | 8.62 / 6.56 | 15.9 / 11 |
| −6% | 196 | 11.34 / 8.72 | 21.9 / 18.5 |
| −10% | 78 | 16.91 / 14.05 | 31.3 / 30 |
| −15% | 35 | 22.89 / 20.78 | 39.9 / 40 |

### D1

| Đang ở −D% | n | Độ sâu cuối cùng (avg / med) | Số nến tới EMA (avg / med) |
|---|---|---|---|
| −3% | 151 | 10.95 / 7.41 | 8.3 / 2 |
| −5% | 113 | 13.33 / 8.98 | 10.6 / 5 |
| −8% | 71 | 17.48 / 13.35 | 15.2 / 9 |
| −10% | 51 | 20.88 / 18.24 | 19.0 / 13 |
| −15% | 32 | 25.93 / 20.92 | 26.3 / 24 |
| −20% | 19 | 31.49 / 29.34 | 32.9 / 29 |

## Nếu mua ngay tại nến đóng cửa −D% dưới EMA34 (drawdown thêm sau khi vào)

| D% | H4 signals | dd thêm avg / med | bars tới EMA | D1 signals | dd thêm avg / med | bars tới EMA |
|---|---|---|---|---|---|---|
| −3% | 245 | 7.41 / 3.76 | 17.2 / 13 | 70 | 10.91 / 5.64 | 11.4 / 6 |
| −5% | 147 | 9.44 / 5.60 | 21.3 / 17 | 50 | 13.08 / 6.96 | 14.7 / 7 |
| −8% | 75 | 12.31 / 8.14 | 24.8 / 22 | 38 | 17.01 / 10.70 | 19.9 / 13.5 |
| −10% | 50 | 12.83 / 6.37 | 25.7 / 22.5 | 31 | 17.98 / 12.07 | 20.9 / 14 |

## Takeaway

Con số trả lời trực tiếp câu hỏi: **H4 trung bình ~3.5% dưới EMA34 (median 2.1%)**, **D1 trung bình ~9% (median 6%)** — đo theo bóng nến thấp nhất; nếu chỉ tính giá đóng cửa thì H4 ~2.4% và D1 ~6.3%. Phân phối lệch phải rất mạnh: đa số lần chỉ thủng nhẹ rồi bật lại trong 1–2 nến, nhưng đuôi thì rất dài (H4 max 54%, D1 max 59% trong crash 2020/2022). Vì vậy **đừng dùng số trung bình làm điểm vào lệnh** — dùng p75 (H4 ~4%, D1 ~10.5%) làm vùng "sâu bất thường", và chấp nhận p90 (H4 ~7.7%, D1 ~19.5%) là mức phải chịu được. Điểm quan trọng thứ hai: mức độ sâu hiện tại **không** làm giảm xác suất hồi (luôn 100% trong 8 năm dữ liệu) nhưng **làm tăng tuyến tính cả độ sâu còn lại lẫn thời gian chờ** — ở D1 khi đã −10% thì trung bình còn đi tới −21% và mất ~19 nến (≈3 tuần) mới chạm lại EMA34, tức đây là chiến lược DCA không đòn bẩy chứ không phải scalp. Kết quả 2 năm gần nhất gần như trùng với 8 năm, nên các ngưỡng này ổn định qua các chu kỳ.
