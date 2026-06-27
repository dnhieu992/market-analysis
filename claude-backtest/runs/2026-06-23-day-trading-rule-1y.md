# Day-trading rule — 1 year signal count (BTCUSDT)

**Date:** 2026-06-23
**Goal:** Đếm có bao nhiêu lệnh thoả mãn rule `/day-trading` hiện tại trong 1 năm, và P&L của chúng.

## Method
Walk-forward replay (no lookahead) chạy chính `SetupAnalyzerService.analyze()` của production
trên lịch sử Bitget USDT-M futures. Mỗi nến 15m đóng → dựng lại input y hệt production
(50×15m, 40×1H, 30×4H) → nếu có setup thì mô phỏng tiến tới khi chạm TP/SL.

Cấu hình khớp production (`day-trading.service.ts`): `risk=$0.5`, `minRR=2`,
stop floor = `1×ATR14`, fee 0.05%/side (round-trip 0.1%), expiry 192 bars.

## Commands
```bash
# Realistic — single position tại một thời điểm
TS_NODE_TRANSPILE_ONLY=1 pnpm --filter worker backtest:daytrading -- \
  --days=365 --atr=1 --risk=0.5 --min-rr=2 --fee=0.0005

# Raw — đếm MỌI setup thoả rule (cho stack chồng lệnh)
TS_NODE_TRANSPILE_ONLY=1 pnpm --filter worker backtest:daytrading -- \
  --days=365 --atr=1 --risk=0.5 --min-rr=2 --fee=0.0005 --allow-stack
```

## Results

### Single-position (số lệnh thực tế sẽ vào) — 346 lệnh / năm (~0.95/ngày)
| Nhóm | n | TP/SL/exp | win% | E[R] net | PF | netUSD |
|---|---|---|---|---|---|---|
| LIQUIDITY_SWEEP | 51 | 20/30/1 | 40.0 | +0.066 | 1.10 | +1.7 |
| TREND_PULLBACK | 295 | 100/179/16 | 35.8 | −0.064 | 0.91 | −9.4 |
| LONG | 89 | 26/60/3 | 30.2 | −0.233 | 0.71 | −10.4 |
| SHORT | 257 | 94/149/14 | 38.7 | +0.021 | 1.03 | +2.7 |
| **OVERALL** | **346** | 120/209/17 | 36.5 | −0.045 | 0.94 | −7.7 |

Fire rate 1.61% số nến 15m. Avg hold 10.2h.

### Raw / allow-stack (mọi setup thoả rule) — 2152 setup / năm (6.05% số nến)
| Nhóm | n | win% | E[R] net | PF | netUSD |
|---|---|---|---|---|---|
| LIQUIDITY_SWEEP | 64 | 40.3 | +0.101 | 1.15 | +3.2 |
| TREND_PULLBACK | 2088 | 37.2 | −0.030 | 0.96 | −31.6 |
| LONG | 313 | 33.3 | −0.146 | 0.81 | −22.9 |
| SHORT | 1839 | 38.0 | −0.006 | 0.99 | −5.4 |
| **OVERALL** | **2152** | 37.3 | −0.026 | 0.96 | −28.3 |

## Takeaway
Rule hiện tại sinh ~**346 lệnh/năm** ở chế độ chỉ-giữ-một-lệnh (≈1 lệnh/ngày trung bình),
hoặc ~**2152 setup/năm** nếu đếm mọi tín hiệu thoả điều kiện. Tuyệt đại đa số là
**SHORT TREND_PULLBACK** (257/346). Tín hiệu phân bố theo cụm: bùng nổ khi BTC có trend
4H rõ ràng, và **gần như bằng 0 khi 4H = neutral** — đúng với hiện tượng "mấy ngày không có
lệnh" gần đây (06-21 → nay 4H đang neutral).

Về P&L: net expectancy ≈ −0.045R/lệnh (PF 0.94) sau phí ⇒ rule này **hoà tới hơi lỗ** trên
toàn bộ 1 năm. Phe SHORT gần hoà (PF 1.03), phe LONG lỗ rõ (PF 0.71). LIQUIDITY_SWEEP là
nhánh duy nhất dương nhưng hiếm (51 lệnh/năm). Lưu ý backtest CHƯA tính cooldown sau thua,
giới hạn 5 lệnh/ngày & 3 thua/ngày của production, nên số lệnh thực vào sẽ nhỉnh thấp hơn 346.
