# BTC Intraday DCA — 5 mức mua, không stop-loss, đóng bắt buộc 23:00 UTC+7

**Ngày:** 2026-07-01
**Script:** `scripts/run-btc-intraday-dca-backtest.ts`

## Ý tưởng (theo yêu cầu user)
- Mỗi ngày đặt ~5 lệnh mua DCA nằm **dưới giá mở cửa ngày**.
- "Scan biên độ tăng/giảm trong ngày" → dùng **biên độ giảm trong ngày trung bình 20 ngày gần nhất**
  (open→low, %) để quyết định 5 mức mua sâu tới đâu (adaptive, không nhìn trước). Có test thêm ladder %-cố định.
- **KHÔNG stop-loss.**
- **Đóng toàn bộ vị thế bắt buộc lúc 16:00 UTC** (= 23:00 UTC+7). Cửa sổ giao dịch: **00:00 UTC → 16:00 UTC**.
- Mỗi mức = 1/5 vốn; khớp tại đúng mức (giả định limit order) khi low nến 15m chạm; vốn tái sử dụng mỗi ngày.

## Config
- Symbol BTCUSDT, nến **15m**, fee **0.05%/side**, vốn **$1000 compound**, lookback 20 ngày.
- Adaptive: `deepest = k × biên_độ_giảm_TB`, chia đều 5 bậc; sweep k = 0.5 / 0.75 / 1.0 / 1.25 / 1.5.
- Fixed ladders: -0.4/0.8/1.2/1.6/2.0% · -0.5/1.0/1.5/2.0/2.5% · -1/2/3/4/5%.

## Lệnh chạy
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-intraday-dca-backtest.ts BTCUSDT 365 0.05 20
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-intraday-dca-backtest.ts BTCUSDT 730 0.05 20
# khung phiên US đối chứng (16:00→00:00 UTC):
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-intraday-dca-backtest.ts BTCUSDT 730 0.05 20 16 8
```

## Kết quả — 730 ngày, khung 00:00→16:00 UTC
| Config | Return | Win ngày | avgFill | full-fill days | avgDay (trên vốn đã giải ngân) | maxDD |
|---|---|---|---|---|---|---|
| Bench: mua open / bán 16:00 | **-57.6%** | 46% | 1.0/5 | 729 | -0.100% | 66.9% |
| Adaptive k=0.50 | -45.0% | 55% | 4.2/5 | 451 | +0.114% | 56.0% |
| Adaptive k=1.00 | -41.0% | 59% | 3.5/5 | 276 | +0.261% | 47.5% |
| Adaptive k=1.50 | -30.0% | 58% | 2.9/5 | 166 | +0.319% | 37.1% |
| Fixed -0.5/1/1.5/2/2.5% | -21.7% | 57% | 2.7/5 | 122 | +0.341% | 30.6% |
| **Fixed -1/2/3/4/5%** | **+13.6%** | 56% | 1.9/5 | 19 | +0.341% | 10.1% |

(365 ngày cho pattern giống hệt; tất cả adaptive/shallow đều lỗ nặng, chỉ ladder sâu nhất hòa/dương.)

## Kết quả đối chứng — khung phiên US 16:00→00:00 UTC (730 ngày)
Cũng **lỗ toàn bộ** (bench -49%, adaptive -29→-44%, fixed sâu -2.8%). → Không phải riêng khung 00:00-16:00 xấu.

## Takeaway
**Chiến lược đúng như mô tả (5 mức DCA, không SL, đóng bắt buộc theo giờ) THUA LỖ, và lỗ một cách có hệ thống ở mọi khung giờ.** Ba nguyên nhân chồng nhau:

1. **Skew âm do không có stop-loss.** Ngày nào cũng thắng nhỏ (win ~56-59%), nhưng đúng những ngày sập là ngày khớp đủ 5 mức → giải ngân 100% vốn rồi bị **ép bán ở giá thấp** lúc 16:00. Vài ngày lỗ lớn (đủ-fill) nuốt hết hàng trăm ngày lãi nhỏ. Chú ý nghịch lý: *avgDay trên vốn đã giải ngân là DƯƠNG* (+0.1→+0.34%), nhưng return thực **âm** — vì vốn bị dồn nhiều nhất đúng vào ngày lỗ (capital-weighting). Đây là "nhặt bạc cắc trước đầu tàu hỏa".
2. **Fee churn.** Đóng/mở mỗi ngày = ~0.1% round-trip/ngày. Riêng phí compound 730 ngày đã ~ -50% vốn. Drift intraday gross gần như bằng 0 nên phí đủ để kéo âm.
3. **Không có động lực (edge) chiều long trong ngày.** Bench "mua open bán close" âm ở cả hai nửa ngày → intraday long thuần không có lợi thế; DCA chỉ *giảm* tốc độ chảy máu chứ không đảo chiều được.

Config duy nhất "sống" (fixed -1/2/3/4/5%, +13.6%/2 năm) sống được **vì hầu như không vào lệnh** (chỉ 19/730 ngày đủ-fill, phần lớn nằm im tiền mặt) — tức nó thắng bằng cách *không chơi*, không phải nhờ edge.

## Đề xuất nếu muốn cứu ý tưởng
- Bỏ "đóng bắt buộc theo giờ + không SL". Cái giết P&L là **bán ép ở giá thấp**. Thay bằng **TP theo từng tranche** (chốt mỗi mức ở +x% so với giá khớp — ăn cú hồi mean-reversion) và cho phép giữ qua ngày khi chưa hồi.
- Hoặc thêm **gate xu hướng** (chỉ DCA long khi khung lớn tăng) để tránh giải ngân đủ 5 mức vào ngày trend-down.
- Đây chính là hướng đã cho kết quả tốt ở các backtest DCA khác trong repo (dip-bounce có TP, accumulation gated) — DCA cần **thoát bằng giá, không thoát bằng đồng hồ**.
