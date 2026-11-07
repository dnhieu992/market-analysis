# BTC SHORT không stoploss · quét các chiến lược cộng đồng (2024-01 → 2026-11-06)

**Ngày:** 2026-11-07 · **Yêu cầu:** tìm rule short BTC hằng ngày cho kiểu đánh không SL, chỉ quản lý vốn/rủi ro.
**Dữ liệu:** Binance futures BTCUSDT 15m/1h/4h/1d, warm-up từ 2023-07. Phí 0.05%/chiều; chưa tính slippage và funding.
**Scripts:** `claude-backtest/scripts/btc-short-nosl/` (Python thuần): `fetch.py`, `run.py` (lưới portfolio), `robust.py`, `per_signal.py`.

## Khung quản lý vốn (giống nhau cho mọi chiến lược)
- Vốn $1000. Lệnh gốc $100 notional. Vào ở giá open của nến sau tín hiệu.
- DCA tính theo giá vào đầu tiên:
  - A: +3 / +6 / +10% với size 1-1-2
  - B: +5 / +10 / +15% với size 1-1-2
  - Tối đa $500 notional một chuỗi lệnh (0.5x vốn).
- TP là giá trung bình −1 / −1.5 / −2 / −3%. Không SL. Một nến vừa khớp DCA thì không tính chạm TP trong chính nến đó.
- Hai cách chấm:
  1. **Portfolio:** chạy theo thời gian thật, giữ 1–3 chuỗi lệnh cùng lúc.
  2. **Từng tín hiệu độc lập:** mỗi tín hiệu là một lệnh riêng, quét tối đa 180 ngày. Lệnh chưa chạm TP sau 180 ngày bị tính là "kẹt" và định giá theo giá lúc đó. Cách này không phụ thuộc ngày bắt đầu nên đánh giá rủi ro đuôi đúng hơn.

## Đã quét
- RSI14 cắt xuống 70 (15m, H1, H4)
- BB(20,2) đóng lại trong band (H1, H4)
- StochRSI cắt xuống từ vùng trên 80 (H1, H4)
- MACD H4 cắt xuống trên mốc 0
- EMA50 H1 từ chối giá
- Quét đỉnh ngày hôm qua (PDH)
- Quét đỉnh phiên Á
- Phân kỳ âm RSI H1
- Pump rồi short (3% / 6h, 2.5% / 4h, 4% / 12h)
- Supertrend H1 lật giảm
- QQE (H1, H4)
- Đối chứng: short ngẫu nhiên mỗi 4h và mỗi ngày

Mỗi chiến lược chạy với 3 bộ lọc xu hướng: không lọc, D1 < EMA50, H4 < EMA200. Tổng cộng khoảng 4.000 cấu hình.

## Kết quả chính
1. **Đa số chiến lược cộng đồng không hơn short ngẫu nhiên.** Short ngẫu nhiên mỗi 4h, TP 1.5%, không DCA cho kết quả: 44% chạm TP trong 1 ngày, 78% trong 7 ngày, MAE p90 15.9%. RSI H1/15m, StochRSI, PDH, phiên Á, EMA50, Supertrend, QQE H1 và MACD đều cho con số gần như y hệt.
2. **Rủi ro đuôi là cấu trúc, không phải do tín hiệu.** Với mọi tập tín hiệu, kể cả ngẫu nhiên, khoảng 2–5% lệnh không chạm TP trong 180 ngày, với MAE 50–100%. Nguyên nhân chính là đợt tăng năm 2024 (42k → 126k). Kỳ vọng mỗi lệnh (EV) của short ngẫu nhiên âm: −$0.45 đến −$4 cho mỗi $100 vốn gốc.
3. **Kết quả phụ thuộc mạnh vào ngày bắt đầu.** Nếu chỉ giữ 1 chuỗi lệnh, một tín hiệu cuối tháng 1/2024 trượt TP 1.5% sẽ kẹt đến nay với khoảng −$365, trong khi TP 1% lại thoát được. Lãi cả 3 năm của một cấu hình chỉ khoảng $100–300, nên một lệnh kẹt là xoá hết.
4. **Chỉ một nhóm hơn hẳn ngẫu nhiên: pump trong xu hướng giảm.** Bộ lọc H4 < EMA200, TP 1%, DCA A, chấm từng tín hiệu:

| Chuỗi tín hiệu | Số tín hiệu | Mỗi tuần | TP ≤ 1 ngày | TP ≤ 7 ngày | TP ≤ 30 ngày | Kẹt > 180 ngày | MAE p90 | MAE max | EV / $100 |
|---|---|---|---|---|---|---|---|---|---|
| Ngẫu nhiên mỗi 4h | 2907 | 19.6 | 64% | 92% | 97% | 1.2% | 6.7% | ~85% | −$2.09 |
| Pump +3%/6h | 90 | 0.61 | 71% | 97% | 100% | 0 | 5.6% | 16.6% | +$1.36 |
| Pump +3%/6h hoặc +4%/12h | 123 | 0.83 | 74% | 97% | 100% | 0 | 5.4% | 16.6% | +$1.33 |
| + BB H4 đóng lại trong band | 170 | 1.14 | 72% | 96% | 100% | 0 | 5.6% | 16.7% | +$1.32 |
| + phân kỳ âm RSI H1 | 217 | 1.46 | 71% | 94% | 100% | 0 | 6.0% | 19.6% | +$1.34 |

   Chạy theo portfolio với tập đầy đủ (pump ×2 + BB H4 + phân kỳ):

   | Số chuỗi lệnh cùng lúc | Lệnh mỗi tuần | Lãi ròng | 2024 / 2025 / 2026 | Max DD | Giữ lệnh lâu nhất | Notional tối đa |
   |---|---|---|---|---|---|---|
   | 1 | 0.9 | +$182 | +57 / +76 / +50 | $66 | 22 ngày | $500 |
   | 2 | 1.45 | +$290 | +95 / +116 / +79 | $119 | 26 ngày | $1000 |

   Có giai đoạn tới 104 ngày không có lệnh (thị trường tăng); đó là đúng thiết kế.
5. **TP 1.5% trở lên là dễ vỡ.** Cùng tập tín hiệu trên, TP 1.5% làm xuất hiện lệnh kẹt cuối tháng 1/2024 và tháng 9/2024 (MAE 78–99%), EV chuyển sang âm.

## Cảnh báo
- Đã thử khoảng 4.000 cấu hình trên cùng một bộ dữ liệu, và mỗi nhóm chỉ có 90–217 tín hiệu, nên có rủi ro chọn trúng do may mắn. Bù lại, kết quả tốt lặp lại ở nhiều biến thể của pump (2.5%/4h, 3%/6h, 4%/12h), ở cả hai bộ lọc, và dương ở cả 3 năm.
- Kết quả TP 1% cũng có phần may: tín hiệu tháng 1/2024 chạm TP 1% nhưng trượt 1.5%. Kiểu đánh không SL vẫn cần một quy trình xử lý lệnh kẹt.
- Chưa tính slippage và funding. Khi short trong thị trường tăng, funding thường dương nên người short nhận tiền.

## Rule đề xuất (ứng viên, cần chạy paper trước)
1. Chỉ short BTC khi nến H4 đã đóng nằm dưới EMA200 H4. Không short khi xu hướng tăng.
2. Tín hiệu, theo thứ tự ưu tiên:
   - BTC tăng ≥ 3% trong 6 nến H1, hoặc ≥ 4% trong 12 nến H1 (pump ngược xu hướng giảm).
   - Nến H4 đóng lại trong band sau khi đóng trên BB(20,2) upper.
   - Phân kỳ âm RSI H1 (pivot 5/3, RSI ở đỉnh trước ≥ 60).
3. Vào ở open của nến sau. TP 1% tính từ giá trung bình. DCA tại +3 / +6 / +10% với size 1-1-2.
4. Lệnh gốc 10% vốn notional. Tối đa 1 chuỗi lệnh cùng lúc (hoặc 2 nếu chấp nhận notional tới 1x vốn). Toàn bộ vị thế short không quá 0.5–1x vốn.
5. Tần suất khoảng 1 lệnh / tuần, không phải mỗi ngày. Dữ liệu không ủng hộ việc short BTC hằng ngày khi không có SL.
