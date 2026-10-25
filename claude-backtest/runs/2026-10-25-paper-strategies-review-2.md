# Review lệnh paper `/trading-analysis` lần 2 (15/10 → 25/10) + backtest kiểm chứng (BTC/ETH/SOL, 2024-01 → 2026-10-25)

**Ngày:** 2026-10-25 · **Yêu cầu (user):** scan các lệnh mới, đánh giá và cập nhật chiến lược.
**Cách làm:** giống review 2026-10-15 — chỉ áp thay đổi cải thiện trên backtest dài hạn, dùng chính hàm của engine.
Dữ liệu chạy trên VPS (`/var/tmp/paper-data`), tải từ Binance tới 2026-10-25 05:00 UTC.
Kiểm tra độ khớp: backtest PDH/PDL bản đang chạy cho 27 lệnh / −7.7R từ 15/10, thực tế 28 lệnh / −8.1R.

## 1. Lệnh paper mới (81 lệnh, 76 đã đóng)
| chiến lược | lệnh đóng | WR | tổng R | ghi chú |
|---|---|---|---|---|
| PDH/PDL | 28 | 18% | −8.10R | 25/28 đóng cuối ngày; SL cách entry 1.3–6.5% |
| A · 5m BÁN | 38 | 58% | +2.20R | BTC +1.2, ETH +1.7, SOL −0.7 |
| B · 5m MUA 1R | 2 | 50% | −0.13R | ít tín hiệu (thị trường giảm) |
| C · 5m MUA phân kỳ | 3 | 33% | −0.70R | BTC +1.4, ETH −1.1, SOL −1.1 |
| D · 15m MUA 2R | 2 | 0% | −2.13R | |
| Scalping skill | 3 | 33% | −0.75R | do Claude chọn, không đổi |

## 2. PDH/PDL — biến thể (3 coin, R sau phí)
| biến thể | lệnh | WR | tổng | maxDD | theo năm 24/25/26 |
|---|---|---|---|---|---|
| bản cũ | 2308 | 44.8% | +21.0R | −20.5R | +12.9 / −5.0 / +13.0 |
| vào trước 18h UTC | 2067 | 46.1% | +33.7R | −19.6R | +14.7 / +2.4 / +16.7 |
| TP 1R / TP 1.5R | 2308 | 45% | −19.8R / +10.3R | | |
| giữ qua đêm ≤ 48h / 72h | 1475 / 1155 | 45% | +29.4R / +32.7R | −32.8 / −40.6R | 2026 âm |
| SL theo nến tín hiệu 2R | 2330 | 37.6% | −224.8R | | |
| SL 1.5 / 2 / 3 ATR | ~2325 | 38–44% | −117.9 / −94.6 / −20.2R | | |
| risk ≤ 2.5 / 3 / 4 / 5% | 400 / 584 / 993 / 1369 | 46–47% | +29.9 / +39.1 / +51.6 / +56.1R | −9.7 → −18.3R | đều dương 3 năm (trừ 3%: 2025 −1.3) |
| **risk ≤ 3.5% (LIVE)** | **783** | **47.0%** | **+49.4R** | **−15.0R** | **+26.7 / +3.1 / +19.5** |
| risk ≤ 3.5% từng coin | BTC 441 · ETH 226 · SOL 116 | 46.0 / 47.3 / 50.0% | +26.3 / +13.5 / +9.6R | | |

Tín hiệu bị loại vì rủi ro lớn **không** khoá chiều đó trong ngày (giờ sau vẫn có thể vào) — đúng như engine.

## 3. RSI A/B/C/D theo coin (quy tắc hiện tại)
| | BTC | ETH | SOL (24/25/26) |
|---|---|---|---|
| A | +32.3R | −26.9R | −96.6R (−41.4 / −43.6 / −11.6) |
| B | +19.8R | −29.8R | −88.9R (−63.5 / −11.2 / −14.3) |
| C | +20.2R | +3.3R | −25.4R (−7.8 / −11.2 / −6.3) |
| D | +13.2R | −8.3R | +9.5R |

## 4. Áp dụng
- **PDH/PDL:** bỏ tín hiệu khi SL cách entry > 3.5% (`PDHL_MAX_RISK_PCT`). +21.0R → +49.4R, maxDD −20.5R → −15.0R.
- **A, B, C:** ngừng mở lệnh mới trên SOL (`symbols: [BTC, ETH]`) — âm ở cả 3 năm và âm trên paper.
  3 coin → 2 coin: A −91.2R → +5.4R, B −98.9R → −9.9R, C −1.8R → +23.5R.
- **D:** giữ nguyên (dương trên SOL). ETH của A/B giữ để tiếp tục đo (năm lãi năm lỗ).
- **Bỏ:** SL chặt (nến / ATR), TP 1R–1.5R, giữ qua đêm, giờ cắt vào lệnh (không cộng thêm khi đã lọc rủi ro).
