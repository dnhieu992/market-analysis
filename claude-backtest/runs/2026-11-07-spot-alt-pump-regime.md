# Spot altcoin +30% — chiến lược rút ra từ đợt pump 8–10/2026 (2026-11-07)

Chỉ altcoin (bỏ BTC/ETH/stable/wrapped). Không so với giữ BTC. Dữ liệu: 562 alt USDT Binance (379 còn sống + 183 đã huỷ niêm yết, lấy từ data.binance.vision), nến ngày 2022-01 → 2026-11.
Mô phỏng danh mục: chia N phần vốn, thang 30/30/40, TP = giá TB × 1.3, không SL, phí 0.1%/chiều, coin bị huỷ niêm yết = bán ở giá cuối.
Scripts: `scripts/spot-30pct/altsim.py`, `altsim2.py`, `altsim3.py`, `breadth*.py`, `pump*.py`.

## 1. Đợt pump 8–10/2026 nói gì
- Chỉ số alt trung vị đáy ~17/08, đỉnh 26/09 (+21%), 88% alt chạm +30% tính từ giá 15/08.
- Breadth (tỷ lệ alt có RSI tuần < 35): 2–4/2026 là 63–77%, 01/07 60%, 15/08 41% → 01/10 chỉ 4%. Pump xảy ra khi breadth đang ở vùng cao rồi tụt nhanh.
- Coin tăng mạnh nhất là coin bị bán quá đà hơn trước pump (RSI tuần 35.6 vs 40.3, −32% vs −21% trong 90 ngày). Nhóm L1/L2/Infra/Storage tăng tốt; fan token/Seed/BSC nhỏ kém.
- Bài học chính: tiền phải nằm sẵn trong coin TRƯỚC pump (mua tháng 5–8, chịu drawdown, DCA đủ 3 phần) rồi chốt +30% trong tháng 9. Lệnh mở SAU pump (tháng 9, breadth đã < 25%) là các lệnh đang kẹt hiện tại (XPL −38%, ZKC, SAHARA, TRUMP).

## 2. Kết quả mô phỏng 2022 → 2026 (10 seed, 8 phần vốn, median)
Mua alt ngẫu nhiên trong giai đoạn này: −16 đến −18%/năm, DD −70% (alt nói chung là kênh giảm).

| Vũ trụ | Tín hiệu | Lọc thị trường | CAGR (min–max) | DD |
|---|---|---|---|---|
| top 30 vol | RSI W<35 | không | 13% (8–17) | −41% |
| top 50 vol | RSI W<35 | không | 20% (15–22) | −35% |
| top 50 vol | RSI W<35 | breadth ≥ 25% | 17% (10–22) | −40% |
| top 100 vol | RSI W<35 | không | 8% (2–12) | −49% |
| top 100 vol | RSI W<35 | breadth ≥ 25% | 22% (11–27) | −49% |
| top 100 vol | RSI W<35, ưu tiên RSI W thấp nhất | breadth ≥ 25% | 31% (1 lần chạy) | −43% |
| top 100 vol | ngẫu nhiên | breadth ≥ 25% | 8% | −48% |
| top 50 vol | dd180 ≤ −50% & RSI D<35 | không | âm | −62% |

- Lọc breadth biến "mua alt bất kỳ" từ −17% thành +5–8%/năm → bản thân chế độ thị trường có giá trị.
- Vũ trụ càng rộng (top 100) thì lọc breadth càng quan trọng; top 50 không lọc cũng ổn.
- F&G < 50 không thêm gì so với RSI tuần (như bài trước). "Giá cách đỉnh −50%" một mình = bắt dao rơi.
- Tham số: 8–12 phần vốn tốt nhất; thang 0/−15/−35 (hoặc 0/−20/−40) nhỉnh hơn 0/−15/−30; TP 20–40% gần như nhau, TP 50% kém hẳn; thoát theo thời gian (180/365 ngày) không giúp.
- Tỷ lệ TP 91–99%, ~15–20 lệnh/năm, giữ trung vị 25–45 ngày, p90 ~ 6 tháng. Năm 2025 là năm khó (một số cấu hình âm).

## 3. Bộ quy tắc đề xuất (alt spot, +30%/nhịp)
1. **Chế độ thị trường** (tính trên alt top 100 vol, niêm yết ≥ 1 năm):
   - breadth RSI tuần < 35 ≥ 25% → MÙA MUA, mở lệnh bình thường.
   - 10–25% → chỉ mua coin top 50 vol.
   - < 10% → không mở lệnh mới, chỉ chờ TP (vùng này 19% lệnh kẹt).
2. **Chọn coin**: top 50–100 alt theo volume 30 ngày, niêm yết ≥ 1 năm, RSI tuần < 35; ưu tiên RSI tuần thấp nhất. Ưu tiên L1/L2/Infra, tránh fan token / Seed / BSC nhỏ (từ phân tích pump, chưa backtest).
3. **Vốn**: 8–12 phần, 1 phần/coin, thang 30/30/40 ở 0/−15/−35%.
4. **Thoát**: TP = giá TB × 1.30. Không SL, không cắt theo thời gian.
5. **Thông số journal**: F&G, USDT.D, TOTAL2/3 giữ làm tham khảo; F&G không có edge thêm, USDT.D/TOTAL chưa có dữ liệu lịch sử để test. Breadth alt là thứ thay thế đã kiểm chứng.

## 4. Hôm nay (2026-11-06)
Breadth 15%, F&G 28, median alt −46% từ đỉnh 180d → chế độ "chỉ top 50". Ứng viên top 100 có RSI W < 35: WLFI, XPL (top 50), BLUR, WAL.

## Giới hạn
- Một giai đoạn 2022–2026 (alt giảm dài hạn); kết quả nhạy với seed và kích thước vũ trụ.
- Xếp hạng volume dùng volume lịch sử (không look-ahead) nhưng tag nhóm chỉ có cho coin còn sống → chưa test lọc nhóm.
- DD −35 đến −50% là bình thường với mô hình không SL; vốn nằm không ~55% thời gian.
