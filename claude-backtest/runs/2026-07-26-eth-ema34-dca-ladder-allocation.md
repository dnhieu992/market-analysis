# ETH — rải vốn DCA spot theo ladder dưới EMA34

Tiếp theo `2026-07-26-eth-ema34-below-recovery-stats.md`. Câu hỏi: **nên chia vốn thế nào
giữa các tầng độ sâu dưới EMA34** để DCA spot.

Backtest 3 khung bài toán khác nhau vì "DCA" có thể hiểu theo 3 cách — kết luận khác nhau rõ rệt.

## Commands

```bash
# 1. Ladder mua đáy → BÁN tại EMA34 (round-trip)
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-ema34-dca-ladder-backtest.ts ETHUSDT "1d,4h" 2900 1000 0.05 34

# 2. Tích lũy bằng ngân sách định kỳ, KHÔNG BÁN
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-ema34-dca-accumulate-backtest.ts ETHUSDT "1d,4h" 2900 100 0.05 34 0

# 3. Giải ngân MỘT cục vốn qua ladder (rolling qua mọi ngày bắt đầu)
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-ema34-ladder-deploy-backtest.ts ETHUSDT 1d 2900 180 5 0.05 34
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-ema34-ladder-deploy-backtest.ts ETHUSDT 4h 2900 180 20 0.05 34
```

Data: ETHUSDT 2018-08 → 2026-07 (D1 2,900 nến; H4 17,394 nến). Fee 0.05%/side.
Đã sửa lookahead: nến "arming" chỉ khớp được tại **close** của chính nó (tín hiệu chỉ
biết khi đóng nến); các tầng sâu hơn nằm chờ như limit order ở các nến sau.

## Xác suất khớp theo từng tầng (input để chia vốn)

| D1 depth | fill rate | avg nến để khớp | | H4 depth | fill rate | avg nến |
|---|---|---|---|---|---|---|
| −1% | 95.8% | 0.3 | | −0.5% | 91.7% | 0.4 |
| −2% | 80.6% | 0.4 | | −1% | 74.7% | 0.6 |
| −3% | 71.2% | 0.6 | | −1.5% | 59.3% | 0.8 |
| −5% | 53.4% | 0.9 | | −2% | 47.5% | 1.0 |
| −6% | 44.5% | 1.1 | | −3% | 32.4% | 1.5 |
| −8% | 34.0% | 1.5 | | −4% | 24.1% | 2.5 |
| −10% | 25.7% | 2.6 | | −5% | 18.5% | 3.3 |
| −15% | 16.2% | 4.9 | | −8% | 8.8% | 6.2 |
| −20% | 8.9% | 6.8 | | −10% | 5.7% | 8.8 |
| −30% | 4.7% | 10.2 | | −15% | 2.6% | 12.6 |

191 cycles (D1) / 1,343 cycles (H4).

## Khung 1 — mua đáy rồi BÁN tại EMA34: hỏng

| Ladder (D1) | cycles | ret/cycle | $1000 → | CAGR | maxDD |
|---|---|---|---|---|---|
| all-in @ close<EMA | 191 | −0.13% | **$317** | −13.5% | 79.1% |
| flat 4 (3/6/10/16) | 191 | +0.23% | $705 | −4.3% | 72.1% |
| back 4 (10/20/30/40) | 191 | +0.22% | $748 | −3.6% | 69.1% |
| deep-only 3 (8/15/25) | 191 | +0.44% | $875 | −1.7% | 60.5% |
| **BUY & HOLD** | | | **$7,610** | **+29.1%** | |

Mỗi cycle lời trung vị chỉ ~+1%, nhưng đuôi lỗ −50% trong bear 2018/2022 xóa sạch.
Chốt tại EMA34 = đứng ngoài toàn bộ sóng tăng. **Không dùng khung này.**

## Khung 2 — ngân sách định kỳ ($100/tháng), không bán

| Chiến lược (D1) | giá vốn | vs DCA lịch | $9,600 → |
|---|---|---|---|
| **DCA theo lịch (naive)** | **$551** | **0.0%** | **$32,832** |
| shallow 3 (1/3/5) | $566 | −2.7% | $31,599 |
| front 4 (50/25/15/10) | $574 | −4.1% | $31,082 |
| flat 4 (3/6/10/16) | $604 | −9.5% | $29,568 |
| back 5 (10/15/20/25/30) | $617 | −11.8% | $28,947 |
| deep-only 3 (8/15/25) | $640 | −16.1% | $27,900 |

Càng chờ sâu, giá vốn càng **tệ**. H4 thì hòa (±0.5%). Chờ đáy sâu = mua muộn trong
thị trường xu hướng tăng, và ETH tăng trong window này.

## Khung 3 — giải ngân một cục vốn (537 ngày bắt đầu rolling, horizon 180 nến D1)

`ratio` = giá trị cuối / giá trị nếu mua hết ngay (LUMP). >1 = ladder thắng.

| Ladder (D1) | mean | med | win% | ret TB | ret trung vị | maxDD TB | %giải ngân hết |
|---|---|---|---|---|---|---|---|
| **LUMP (mua hết ngay)** | 1.000 | 1.000 | — | **+47.0%** | +14.4% | 43.9% | 100% |
| single −3% | 0.970 | 0.989 | 44.1% | +39.8% | +14.5% | 43.0% | 100% |
| front 4 (50/25/15/10) @ 2/5/9/15 | 0.963 | 0.980 | 43.6% | +33.7% | **+15.9%** | 41.5% | 94.6% |
| fill-weighted 4 @ 2/5/9/15 | 0.961 | 0.983 | 43.6% | +31.7% | +14.7% | 40.9% | 94.6% |
| flat 4 (3/6/10/16) | 0.958 | 0.991 | 47.9% | +28.7% | +13.0% | 39.1% | 87.9% |
| back 5 (10/15/20/25/30) | **0.969** | **1.019** | **54.0%** | +23.2% | +13.9% | **34.1%** | 71.1% |

H4 (horizon 180 nến, 20 bar step): mọi ladder có med ratio ≥ 1.0 và win% 48–61%
(single −3%: med 1.011, win 60.2%; back 4: med 1.015, win 56.6%, maxDD 16.0% vs lump 20.7%).

## Takeaway

**Ladder không tạo alpha — nó đổi lợi nhuận kỳ vọng lấy drawdown thấp hơn.** Trên toàn bộ 8 năm
ETH, không cấu hình nào có `mean ratio` > 1: mua hết ngay thắng về trung bình (+47% vs +23…+40%)
vì ETH là tài sản xu hướng tăng, giữ tiền mặt chờ đáy là chi phí. Nhưng **trung vị** thì ladder
ngang hoặc hơn lump (front 4 cho ret trung vị +15.9% vs lump +14.4%, back 5 có med ratio 1.019 và
win 54%) — nghĩa là ở điều kiện thị trường *bình thường* ladder thắng nhẹ, còn ở các con sóng tăng
mạnh nó thua đậm, và trung bình bị kéo xuống bởi chính những con sóng đó. Đổi lại maxDD giảm từ
43.9% xuống 34–41%. Hai lỗi phải tránh: (1) **đừng bán tại EMA34** — khung 1 biến $1000 thành $317–875
trong khi buy&hold cho $7,610; (2) **đừng dồn vốn vào tầng sâu** — tầng −15%/−20% chỉ khớp 16%/9%
số cycle nên vốn nằm chết, và khung 2 cho thấy ladder càng sâu giá vốn càng tệ (−16% với deep-only).
Cách chia vốn hợp lý là **theo xác suất khớp, dồn về tầng nông**: D1 ≈ 35/30/22/13% ở −2/−5/−9/−15%,
H4 ≈ 35/30/22/13% ở −1/−2.5/−4.5/−8%, kèm luật giải ngân nốt phần dư nếu sau ~2 tháng không khớp.
