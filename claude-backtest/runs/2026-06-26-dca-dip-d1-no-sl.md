# D1 DCA dip — NO stoploss, exit on EMA reclaim (user's real strategy)

**Date:** 2026-06-26
**Script:** `scripts/run-dca-dip-d1-backtest.ts` (mới)

## Chiến lược (đúng mô hình user mô tả)
- **Không SL, DCA liên tục.** Mỗi coin 1 "campaign" tại một thời điểm:
  - **START:** RSI(14) ≤ rsiMax & close trong vòng `nearLowPct`% (=8%) trên đáy 20 ngày → gom layer 1.
  - **ADD:** mỗi khi giảm thêm `stepPct`% (=8%) so layer trước → gom thêm 1 layer đều nhau ($200/layer), **trần `maxLayers` (=5)**.
  - **EXIT:** giá hồi chạm lại EMA`exitEma` (34 hoặc 89) → bán **toàn bộ**.
  - Không hồi tới EMA đến hết dữ liệu → để OPEN, mark-to-market = "bom kẹt".
- Fee 0.05%/side mọi lần mua + bán cuối. Return tính trên vốn đã giải ngân.

## Commands
```bash
# exit EMA34 (sweep RSI 30/35/40)
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-dca-dip-d1-backtest.ts "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,POLUSDT,TAOUSDT" 1d 2200 0.05 "30,35,40" 8 20 8 5 34 200
# exit EMA89
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-dca-dip-d1-backtest.ts "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,POLUSDT,TAOUSDT" 1d 2200 0.05 "35" 8 20 8 5 89 200
```

## Kết quả — EXIT EMA34, RSI≤35 (tiêu biểu)
| symbol | camp | TP | stuck | winRate | avgRet% | worstDD% | totalPnL$ (unit $200×5) |
|---|---|---|---|---|---|---|---|
| BTC | 24 | 23 | 1 | 91% | +5.3 | 24 | +216 |
| ETH | 18 | 17 | 1 | 76% | +4.2 | **55** | **−279** |
| SOL | 26 | 26 | 0 | 81% | +8.9 | 57 | +317 |
| XRP | 27 | 26 | 1 | 96% | +9.2 | 41 | +491 |
| POL | 11 | 10 | 1 | 80% | +4.4 | 36 | **−135** |
| TAO | 12 | 12 | 0 | 100% | +13.8 | 29 | +661 |

## Kết quả — EXIT EMA89, RSI≤35
| symbol | winRate | avgRet% | avgBars | worstDD% | totalPnL$ |
|---|---|---|---|---|---|
| BTC | 88% | +3.6 | 39 | 32 | −6 |
| ETH | 94% | +6.5 | 37 | 55 | +108 |
| SOL | 91% | +12.4 | 32 | 57 | **+935** |
| XRP | 90% | +13.0 | 31 | 41 | +578 |
| POL | 67% | +5.8 | 52 | 49 | −28 |
| TAO | 100% | +22 | 23 | 29 | +1066 |

## Takeaway
**Bỏ SL + DCA + thoát khi reclaim EMA = thay đổi cục diện hoàn toàn so với dip-buy có SL.** Win rate vọt lên **80–100%** (vs 14–35% khi có SL), vì chiến lược **không hiện thực hóa lỗ trong nhịp chop** mà chờ nhịp hồi — nhịp hồi gần như luôn tới (EMA34: ~2–4 tuần; EMA89: ~5–7 tuần). 4/6 coin có totalPnL dương.

**NHƯNG rủi ro chỉ đổi chỗ, không biến mất:**
1. **Drawdown chưa hiện thực hóa khổng lồ: 24–63%.** Phải chịu được cảnh average âm tới >50% giữa đường (ETH/SOL ~55–57%). Đây là "phí" thật của việc bỏ SL.
2. **Vốn bị chôn hàng tuần** (EMA89: trung bình 30–52 nến = 1–2 tháng/lệnh).
3. **KHÔNG phổ quát — phụ thuộc COIN.** ETH lỗ −279 (EMA34) và POL lỗ ở mọi cấu hình. Coin càng yếu / downtrend càng dài thì average càng bị kéo và hồi càng lâu/không tới.
4. **Survivorship bias:** mẫu toàn coin còn sống. Một coin **chết hẳn (−90% không về)** sẽ thành "bom kẹt" lỗ vĩnh viễn — chính là kịch bản DCA-no-SL nguy hiểm nhất, không xuất hiện trong mẫu này.

**EMA34 vs EMA89:** EMA89 giữ lâu hơn, thoát cao hơn → lãi to hơn nhiều trên coin khỏe (SOL +935, TAO +1066) nhưng chôn vốn lâu gấp đôi. EMA34 quay vòng nhanh, an toàn hơn về thời gian, vẫn dương.

## Kết luận cho thiết kế page
DCA-no-SL **chạy được**, nhưng đòn bẩy rủi ro số 1 là **CHỌN COIN** (chỉ DCA coin đủ khỏe để chắc chắn hồi — large-cap/thanh khoản/uptrend dài hạn chưa chết). Vì vậy page nên đổi từ "Entry Score + SL/R:R" sang **DCA dashboard**: (1) điểm "đáng DCA" = chất lượng/sống-sót coin; (2) tín hiệu "nên gom thêm" = quá bán + gần đáy/giảm thêm so average; (3) theo dõi layer & vốn đã giải ngân vs trần; (4) cảnh báo CHỐT khi reclaim EMA34/EMA89. Tham số tốt: RSI≤35, gần đáy 20d ≤8%, add mỗi −8%, tối đa 5 layer.
```
```
