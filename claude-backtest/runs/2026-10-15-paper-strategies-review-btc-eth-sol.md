# Review 89 lệnh paper `/trading-analysis` + backtest kiểm chứng đề xuất (BTC/ETH/SOL, 2024-01 → 2026-10)

**Ngày:** 2026-10-15 · **Mục tiêu (user):** phân tích các lệnh paper-trade thua, đề xuất cải thiện, áp vào engine, thêm SOL.
**Dữ liệu:** Binance BTCUSDT/ETHUSDT/SOLUSDT 5m/15m/1h/1d, 2023-12 (warm-up) → 2026-10-15 (tải từ Mac).
**Script:** `scripts/run-paper-strategies-backtest.ts` — dùng **chính** `firesAt` / `stepPosition` / `pdhlSignal`
của engine live, nên kết quả "LIVE (as shipped)" là đúng quy tắc đang chạy.

```bash
npx tsx scripts/run-paper-strategies-backtest.ts claude-backtest/data/paper BTCUSDT,ETHUSDT,SOLUSDT 2024-01-01
# hoặc: TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json scripts/run-paper-strategies-backtest.ts ...
```

Kiểm tra độ khớp: bản "old" trên BTC ra A 727 lệnh / WR 57.1%, B 720 / 54.7%, C 674 / 43.9%, D 668 / 36.8%,
gần với backtest python gốc (726 / 56.9%, 707 / 54.6%, 666 / 44.0%, 662 / 36.9%).

## 1. Review 89 lệnh paper (2026-09-20 → 2026-10-14)
| chiến lược | lệnh | WR | tổng R |
|---|---|---|---|
| A · 5m BÁN | 14 | 86% | +8.61R |
| PDH/PDL | 25 | 44% | +0.78R |
| B · 5m MUA 1R | 21 | 52% | −0.40R |
| C · 5m MUA phân kỳ | 17 | 41% | −0.63R |
| D · 15m MUA 2R | 12 | 25% | −3.80R |

Mẫu hình lệnh thua: (1) MUA khi 1h đã nóng (RSI1h ≥ 60 hoặc tăng ≥ 1%/24h: WR 24–27%, −7.5 → −9.6R);
(2) MUA ngược xu hướng giảm 1h (WR 31%, −5.1R); (3) nhiều lệnh MUA cùng lúc trên BTC+ETH (ngày 02/10 −8.3R);
(4) D giữ lệnh rất lâu, lời ~1R rồi quay về SL; (5) PDH/PDL 19/25 lệnh đóng cuối ngày.

## 2. Backtest kiểm chứng từng đề xuất (mỗi thay đổi thêm riêng lẻ trên quy tắc cũ; R sau phí)
| chiến lược | biến thể | BTC | ETH | SOL | 3 coin | maxDD 3 coin |
|---|---|---|---|---|---|---|
| A | old | +30.4R | −28.6R | −95.5R | −93.7R | −128.5R |
| A | + lọc trend 1h | +28.2R | −30.0R | −103.0R | −104.7R | −136.3R |
| B | old | +20.0R | −29.8R | −91.6R | −101.4R | −117.9R |
| B | + RSI1h ≤ 60 | −3.4R | −59.3R | −92.4R | −155.1R | −159.2R |
| B | + tăng 24h < 1% | −0.0R | −21.7R | −67.2R | −89.0R | −98.5R |
| B | + lọc trend 1h | +13.4R | −24.4R | −67.5R | −78.5R | −94.0R |
| B | + BE @0.5R | −12.9R | −66.2R | −99.9R | −179.0R | −185.6R |
| C | old | +21.0R | −46.8R | −116.8R | −142.6R | −199.6R |
| C | + RSI1h ≤ 60 | +12.8R | −53.2R | −119.8R | −160.2R | −185.5R |
| C | + tăng 24h < 1% | +26.6R | +5.7R | −95.7R | −63.4R | −102.5R |
| C | + lọc trend 1h | +13.1R | −32.6R | −45.6R | −65.2R | −109.4R |
| **C** | **+ tăng 24h + trend (LIVE)** | **+18.8R** | **+4.4R** | **−24.3R** | **−1.1R** | **−38.4R** |
| D | old | +25.4R | −44.7R | −30.1R | −49.3R | −135.2R |
| D | + RSI1h ≤ 60 | +18.0R | −35.8R | −29.4R | −47.3R | −108.5R |
| D | + tăng 24h < 1% | +25.4R | −3.2R | −19.1R | +3.1R | −92.4R |
| D | + lọc trend 1h | +18.3R | −40.7R | +6.8R | −15.5R | −102.9R |
| D | + TP 1.5R | +0.5R | −26.5R | −64.1R | −90.1R | −155.9R |
| D | + giữ tối đa 24h | +7.3R | −62.3R | −47.2R | −102.2R | −180.4R |
| **D** | **+ tăng 24h + trend (LIVE)** | **+15.3R** | **−8.3R** | **+9.5R** | **+16.6R** | **−51.2R** |
| PDH/PDL | old (LIVE) | +20.4R | +9.9R | −0.9R | +29.5R | −20.5R |
| PDH/PDL | + BE @0.7R | +16.5R | +2.7R | −6.9R | +12.2R | −22.7R |
| PDH/PDL | + vượt biên ≥ 0.2% | +11.3R | +3.2R | −2.3R | +12.2R | −22.1R |

Kỳ vọng/lệnh trên BTC: C 0.031 → **0.067R**, D 0.038 → **0.052R** (số lệnh giảm ~55%).

## 3. Áp dụng vào engine (user chọn "chỉ phần đã kiểm chứng")
- **C, D:** thêm `trendFilter` (bỏ MUA khi 1h giá & EMA50 dưới EMA200) + `maxRise24hPct: 1`.
- **A, B, PDH/PDL:** giữ nguyên — mọi thay đổi đề xuất đều làm kết quả xấu đi.
- **Bỏ:** RSI1h ≤ 60, BE cho B, TP 1.5R + giữ tối đa 24h cho D, BE/vượt biên cho PDH/PDL, giới hạn rủi ro gộp
  (user: board chỉ để chọn chiến lược, không cần).
- **Thêm SOLUSDT** vào `PAPER_SYMBOLS` (mọi chiến lược).

## Kết luận
Các "pattern thua" rút ra từ 89 lệnh trong 3.5 tuần phần lớn là nhiễu: trên 2.5 năm, chỉ cặp lọc
"không mua đuổi 24h + không mua ngược trend 1h" cải thiện thật cho hai chiến lược MUA dùng volume thấp (C, D).
Các chiến lược RSI được dò trên BTC và **âm trên ETH/SOL** (trừ D trên SOL, C trên ETH sau lọc) — kết quả paper
trên ETH/SOL nên đọc như kiểm chứng ngoài mẫu, không phải kỳ vọng lợi nhuận. Kết quả 86% WR của A trên paper là
do 2 tuần thị trường giảm; backtest dài hạn cho A ~57% trên BTC.
