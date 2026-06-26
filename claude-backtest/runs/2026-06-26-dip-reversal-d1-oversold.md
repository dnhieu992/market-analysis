# D1 deep-dip reversal (oversold bounce, NO trend filter) — test user's "bắt đáy hồi" idea

**Date:** 2026-06-26
**Script:** `scripts/run-dip-reversal-d1-backtest.ts` (mới)

## Bối cảnh
User muốn đổi `/tracking-coins` sang **bắt đáy điều chỉnh sâu**: "mua khi giá đã chỉnh sâu, sắp hồi /
khó giảm thêm; chờ trend nhiều khi không kịp vào; coin vào trend tăng nhiều khi đã là đỉnh." Đây là
counter-trend, ngược với Entry Score thuận-trend đã build. Run trước (`2026-06-21-ema34-meanrev-d1-dipbuy`)
đã cho thấy dip-buy thô (chỉ "X% dưới EMA34") **lỗ 3/4 coin**, gốc là R:R âm + thiếu lọc trend.

Run này thêm đúng các tinh chỉnh user mô tả mà bản thô thiếu:
- **Oversold:** RSI(14) ≤ rsiMax (sweep 25/30/35/40).
- **Gần hỗ trợ:** close trong vòng `nearLowPct%` (=6%) trên đáy `lowWindow` (=20) ngày → ở đáy range, không lơ lửng.
- **Stabilization (chờ chững):** nến TURN UP (close>open & close>prev close) → không bắt dao đang rơi. Test cả ON/off.
- **SL cấu trúc:** ngay dưới đáy 20d (−3%); bỏ setup nếu risk > 18% (chỉ entry rủi ro thấp).
- **TP:** chạm lại EMA34. 1 lệnh/lúc, $1000 compounded, fee 0.05%/side.

## Commands
```bash
# stabilization ON
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-dip-reversal-d1-backtest.ts "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,POLUSDT,TAOUSDT" 1d 2200 1000 0.05 "25,30,35,40" 6 20 3 18 1
# stabilization OFF
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-dip-reversal-d1-backtest.ts "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,POLUSDT,TAOUSDT" 1d 2200 1000 0.05 "30,35,40" 6 20 3 18 0
```

## Kết quả (return %, net phí; ~6 năm trừ POL/TAO lịch sử ngắn)

**Stabilization ON** (chờ nến chững):
| RSI≤ | BTC | ETH | SOL | XRP | POL | TAO |
|---|---|---|---|---|---|---|
| 25 | +1.2 (2 lệnh) | 0 | 0 | 0 | 0 | 0 |
| 30 | −21.5 | −2.0 | −18.8 | 0 | −13.8 | −6.4 |
| 35 | −25.0 | −13.7 | −13.2 | +5.9 | −34.7 | −28.9 |
| 40 | −14.6 | −44.8 | −25.9 | −26.0 | −45.4 | −35.9 |

**Stabilization OFF:**
| RSI≤ | BTC | ETH | SOL | XRP | POL | TAO |
|---|---|---|---|---|---|---|
| 30 | −23.8 | −18.2 | −2.0 | −9.3 | **+38.8** | **+42.2** |
| 35 | −0.1 | −40.4 | −15.0 | −9.5 | +11.4 | **+53.4** |
| 40 | +15.7 | −6.4 | −51.0 | +3.1 | −35.5 | +15.3 |

Win rate hầu hết **14–35%**; **SL ≫ TP ở mọi cấu hình** (vd OFF/RSI40: SOL 18 TP / 63 SL). MaxDD 20–71%.

## Takeaway
**Ý tưởng bắt đáy không-lọc-trend KHÔNG đứng vững** — kể cả đã thêm oversold + gần hỗ trợ + chờ chững + SL cấu trúc:

1. **SL bị quét liên tục (SL≫TP).** "Đáy 20 ngày" trong downtrend KHÔNG phải hỗ trợ thật — giá liên tục tạo đáy mới, nên SL đặt ngay dưới đáy gần như luôn bị quét. Đây đúng là bản chất "bắt dao rơi".
2. **Stabilization không cứu được.** Một nến xanh trong downtrend chỉ là dead-cat bounce; ON còn ít lệnh hơn nhưng vẫn âm. Chờ chững KHÔNG đủ để xác nhận "khó giảm thêm".
3. **Vài ô dương đều là POL/TAO** (lịch sử ngắn, rơi trúng regime tăng) và **đi kèm maxDD 30–57%** → không tin cậy, đúng cảnh báo từ run trước.
4. Khớp 100% với kết luận run `2026-06-21`: **đòn bẩy thật để dip-buy có lãi là LỌC TREND** — chính là cái cổng (EMA) mà user thấy "khó vào". Cái khó đó là chiến lược đang bảo vệ vốn, không phải lỗi.

## Khuyến nghị (đã báo user)
Không triển khai bắt-đáy-ngược-trend. Thay vào đó **giữ Entry Score thuận-trend** (đã xử lý nỗi lo "vào lúc đỉnh" bằng gate Ext%<18 + chấm điểm pullback sát EMA34, tức MUA NHỊP CHỈNH TRONG UPTREND chứ không mua lúc giá đã chạy xa). Điểm cần nới là **đổi gate EMA200 → EMA89 (D1)** để bắt được early-trend/recovery mà vẫn không bắt dao — nên backtest riêng biến thể này trước khi đổi code.
