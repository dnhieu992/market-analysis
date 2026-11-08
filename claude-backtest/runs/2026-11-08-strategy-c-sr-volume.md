# Chiến lược C cho Spot Analytic — hỗ trợ / kháng cự + volume (2026-11-08)

Câu hỏi: dùng hỗ trợ (HT), kháng cự (KC) và volume để mua spot altcoin có lợi thế hơn mua ngẫu nhiên không, và có đủ tốt để thành Chiến lược C (cạnh A = alt quá bán theo breadth, B = bắt cú hồi sau sập)?

Dữ liệu: cùng bộ với nghiên cứu A, gồm 770 alt USDT Binance (gồm cả coin đã huỷ niêm yết), nến D1 từ 2022-01 đến 2026-11-06, volume tính bằng USDT. Vũ trụ: **top 100 alt theo volume 30 ngày** (xếp hạng theo từng ngày, không look-ahead), niêm yết ≥ 1 năm. Phí spot 0.1%/chiều. Coin bị huỷ niêm yết thì bán ở giá cuối.

## Định nghĩa
- **Vùng HT/KC**: các đỉnh/đáy swing (5 nến mỗi bên, chỉ dùng sau khi đã đủ 5 nến xác nhận) trong 365 ngày, gồm cả đỉnh lẫn đáy (HT/KC đổi vai). Gom thành vùng rộng tol = 0.5×ATR% (kẹp trong 1.5–5%). Độ mạnh của vùng = số lần chạm.
- **Tỷ lệ volume** = volume hôm nay / trung bình 20 ngày trước đó.
- Tín hiệu (nến D1 đã đóng, mua ở giá đóng cửa):
  - `bounce`: râu xuống chạm vùng HT (≥ 2 lần chạm), đóng cửa trên vùng, thân nến ở nửa trên, volume ≥ 1.5×. Biến thể: `bounce_novol` (bỏ điều kiện volume), `bounce_v2` (vùng ≥ 3 lần chạm, volume ≥ 2×).
  - `breakout`: đóng cửa vượt vùng KC đã chặn 20 phiên trước, volume ≥ 2×. Biến thể `breakout_novol` không cần volume.
  - `retest`: 3–20 ngày sau breakout, giá quay về test lại vùng vừa phá và đóng cửa giữ trên vùng.
  - `climax`: volume climax tại HT, tức giảm ≥ 15%/7 ngày, volume ≥ 3×, râu dưới ≥ 50% thân nến, đáy nằm gần vùng HT.
  - Phần 2 thêm: pullback về HT với volume cạn (≤ 0.7×) khi đang uptrend; quét dưới VAL của volume profile 180 ngày rồi đóng cửa lại trên; test POC 180 ngày từ trên xuống.
- Các cách thoát lệnh đem so: TP +10%/30 ngày, TP +20%/60 ngày, TP = vùng KC kế tiếp (≥ +8%)/60 ngày, TP +30%/180 ngày. Có thêm biến thể SL ngay dưới vùng HT.

## Lệnh
```bash
cd claude-backtest/scripts/strategy-c   # dữ liệu: thư mục klines của nghiên cứu spot-30pct (all/ data/ data_dead/ dead2/)
SPOT_DATA=<data root> python3 -I csr.py     # phần 1: các tín hiệu S/R + volume cổ điển
SPOT_DATA=<data root> python3 -I csr2.py    # phần 2: lưới độ bền climax, volume profile, timing cho A
SPOT_DATA=<data root> python3 -I csim.py    # phần 3: mô phỏng danh mục climax
SPOT_DATA=<data root> python3 -I cvsb.py    # phần 4: climax so với Chiến lược B
```

## 1. Tín hiệu S/R + volume cổ điển: ≈ mua ngẫu nhiên
Top 100 vol, 2022-01 → 2026-11, mỗi coin chờ 10 ngày giữa 2 tín hiệu cùng loại.

| Tín hiệu | Mẫu | +10% ≤30d | +20% ≤60d | +20% trước −15% | TP10/30d | TP20/60d | TP KC kế/60d | TP30/180d |
|---|---|---|---|---|---|---|---|---|
| Ngẫu nhiên | 8775 | 65% | 54% | 41% | −1.1% | −1.8% | −1.5% | −0.3% |
| bounce HT + vol ≥1.5× | 2267 | 71% | 58% | 45% | +0.5% | −0.4% | −0.7% | +0.9% |
| bounce không volume | 7762 | 64% | 53% | 40% | −1.4% | −2.3% | −2.2% | −1.4% |
| bounce vùng ≥3 chạm, vol ≥2× | 839 | 71% | 61% | 47% | +0.1% | +0.4% | −0.5% | +2.9% |
| breakout KC + vol ≥2× | 1914 | 74% | 61% | 46% | +0.4% | −0.4% | −1.3% | +0.8% |
| breakout không volume | 2869 | 70% | 59% | 44% | −0.0% | −0.6% | −1.3% | +1.4% |
| retest sau breakout | 1562 | 68% | 58% | 45% | −0.7% | −0.9% | −1.9% | −0.4% |
| **climax tại HT** | **37** | **84%** | **65%** | **68%** | **+5.2%** | **+6.1%** | **+7.3%** | **+10.9%** |

- Volume có giá trị nhưng rất nhỏ. Bounce có volume tốt hơn bounce không volume khoảng 2 điểm %, breakout có volume tốt hơn khoảng 1–4 điểm %. Dù vậy, sau phí lợi nhuận trung bình vẫn chỉ quanh 0.
- Bounce và breakout dao động theo năm giống hệt thị trường: 2023–2024 +3 đến +6%, 2022 và 2025 −5 đến −13%. Tức là chúng không có lợi thế riêng.
- Lọc theo breadth của A (≥ 25%) làm *mọi thứ* tốt lên, kể cả mua ngẫu nhiên (TP20/60d +3.0%). Khi đó bounce/breakout lại **kém** ngẫu nhiên. Khi breadth < 10% thì mọi tín hiệu đều âm.
- Đặt TP ở vùng KC kế tiếp không tốt hơn TP cố định. SL dưới vùng HT không cứu được tín hiệu yếu.

## 2. Độ bền của volume climax, các biến thể khác, timing cho A
- **Climax đúng ở cả 18 tổ hợp ngưỡng** (volume ≥ 2/2.5/3×, giảm 7 ngày ≥ 10/15/20%, râu ≥ 40/50%): TP20/60d +2 đến +10% so với ngẫu nhiên +0.4%, "+20% trước −15%" 59–79% so với 44%. Giảm càng sâu thì tín hiệu càng mạnh, mạnh nhất ở mức 7 ngày ≤ −20%.
- Đối chứng "chỉ cần giảm −15%/7d", không cần volume và râu nến: −0.7%. Như vậy **volume lớn + râu dưới dài là phần tạo lợi thế**.
- Bỏ điều kiện "gần vùng HT" thì TP10 vẫn tốt nhưng TP30/180d tụt xuống −4.9%. Vùng HT chỉ có ích khi giữ lệnh dài.
- **Điểm yếu: lợi nhuận dồn vào năm 2024.** Ví dụ cấu hình v≥2.0/−15%/râu .4: 2024 +14% (85 lệnh), 2025 −8% (36 lệnh), 2026 −2% (12 lệnh).
- Pullback khi volume cạn trong uptrend: **tệ hơn ngẫu nhiên** (TP20/60d −4.1%). Quét VAL 180 ngày: −1.4%. Test POC 180 ngày: −0.1%. Volume profile không có lợi thế.
- **Dùng S/R làm điểm vào cho coin của A (RSI tuần < 35) không cải thiện A.** Mua ngay bất kỳ ngày nào có tín hiệu A: TP30/180d +10.3%. Chờ bounce HT có volume: +10.1%. Chờ breakout KC: +7.3%. Breakout chỉ làm tăng xác suất +10% trong 30 ngày (86% so với 73%).

## 3. Mô phỏng danh mục climax (2022-01 → 2026-11, top 100 vol, mua 1 lần, ưu tiên coin giảm sâu nhất)
| Cấu hình | Thoát | Slot | Lãi/năm | DD | Vốn dùng | Lệnh/năm | Thắng | TB/lệnh |
|---|---|---|---|---|---|---|---|---|
| v≥2.5, −15%, râu .4 | TP +10% / 30d | 5 | +4.9% | −19% | 6% | 11 | 76% | +2.5% |
| v≥2.5, −15%, râu .4 | TP KC kế / 60d | 5 | +5.7% | −25% | 14% | 11 | 74% | +3.5% |
| v≥2.5, −15%, râu .4 | TP +20% / 60d | 10 | +6.6% | −14% | 9% | 13 | 72% | +5.7% |
| v≥2.0, −15%, râu .4 | TP +10% / 30d | 5 | +7.9% | −26% | 9% | 18 | 78% | +2.8% |
| v≥2.0, −15%, râu .4 | TP +20% / 60d | 3 | −11.4% | −75% | 33% | 12 | 58% | −1.1% |
| v≥2.5, −20%, râu .4 | TP +20% / 60d + SL dưới vùng | 5 | +11.0% | −8% | 5% | 7 | 71% | +8.2% |
| v≥2.5, −20%, râu .4 | TP +20% / 60d | 10 | +6.5% | −8% | 5% | 8 | 78% | +8.3% |

- Mỗi lệnh có lợi thế (thường +3 đến +8%/lệnh), nhưng **chỉ có 7–18 lệnh/năm trên toàn top 100**, nên vốn nằm không 80–95% thời gian. Lãi/năm trên phần vốn dành riêng chỉ khoảng 1–11%.
- Kết quả **đổi rất mạnh theo tham số**: từ −11% đến +11%/năm, DD từ −8% đến −75%. Cấu hình tốt nhất (+11%, có SL) là kết quả chọn sau khi đã nhìn dữ liệu. Ít slot (3) thì rủi ro dồn vào vài lệnh hỏng (OG −40%, ZRO −38%, ATM −42%, giữ đủ 60 ngày).
- Theo breadth: breadth ≥ 10% thì tốt hơn (+5.2%/năm, DD −18%). Breadth < 10% thì âm.

## 4. Climax gần như là một phần của Chiến lược B
- 111/180 tín hiệu climax (v≥2, −15%, râu .4) trùng với trigger của B (3d ≤ −20% / 7d ≤ −25% / 30d ≤ −40%). Phần climax **không** trùng B yếu hẳn (TP20/60d +1.4%).
- Trong các tín hiệu B (4172 mẫu, top 100 vol, chờ 10 ngày):

| Lọc trên B | Mẫu | +10% ≤30d | +20% trước −15% | TP10/30d | TP20/60d | TP30/180d |
|---|---|---|---|---|---|---|
| B tất cả | 4172 | 78% | 43% | +1.8% | +0.4% | +0.6% |
| B + volume ≥ 2× | 821 | 78% | 48% | +1.5% | +0.0% | +1.0% |
| **B + râu dưới ≥ 40%** | **2305** | **80%** | **50%** | **+3.1%** | **+3.0%** | **+3.9%** |
| B + gần vùng HT | 2636 | 76% | 43% | +1.6% | −0.5% | −1.8% |
| B + không gần vùng HT | 2199 | 80% | 45% | +2.5% | +2.3% | +4.2% |
| B + vol ≥ 2× + râu ≥ 40% + vùng HT | 130 | 84% | 71% | +4.8% | +7.2% | +11.7% |

- Với B, **râu dưới dài là bộ lọc duy nhất có ích và đủ mẫu**. Volume đứng riêng không thêm gì. "Gần vùng HT" còn làm kết quả tệ hơn: coin sập xuống một vùng HT cũ dễ thủng tiếp hơn là coin sập vào khoảng trống.

## Kết luận
1. **Hỗ trợ/kháng cự + volume không đủ để thành một Chiến lược C độc lập.** Bounce, breakout, retest, pullback volume cạn, VAL/POC đều ≈ mua ngẫu nhiên sau phí, và lời lỗ chạy theo thị trường.
2. **Ngoại lệ duy nhất là volume climax tại hỗ trợ**: giảm ≥ 15–20%/7 ngày, volume ≥ 2–2.5×, râu dưới ≥ 40%, đáy chạm vùng HT. Lợi thế có thật và bền khi đổi ngưỡng (+3 đến +8%/lệnh, khoảng 70–80% thắng với TP +20%/60 ngày). Nhưng tín hiệu rất hiếm (7–18 lệnh/năm), lời dồn vào 2024, 2025–2026 hơi âm, và phần lớn trùng với B.
3. Cách dùng hợp lý nhất: **nâng cấp B, không tạo C riêng.** Trong B, ưu tiên nến có râu dưới ≥ 40%. Nếu có thêm volume ≥ 2× và đáy chạm vùng HT thì đó là tín hiệu "B-climax", có thể để TP +15–20% thay vì +10%. Mẫu cho B-climax mới có 130, nên tỷ trọng vẫn nhỏ như B.
4. Không dùng S/R để chờ điểm vào cho A. Mua theo quy tắc A ngay khi có tín hiệu cũng tốt bằng hoặc hơn.

## Giới hạn
- Phần 1 và 3 tính từ 2022-01. Phần 2 và 4 không lọc ngày bắt đầu, nên có thêm 2020–2021 của khoảng 70 coin có lịch sử dài (cột "theo năm" ghi 20:/21:), số mẫu những năm này nhỏ.
- Về cơ bản chỉ 1 giai đoạn (2022–2026), alt nói chung đang giảm dài hạn. Climax chỉ 37–270 mẫu tùy ngưỡng, kết quả danh mục rất nhạy với tham số, và cấu hình "tốt nhất" là chọn sau khi đã nhìn dữ liệu.
- Vùng HT/KC dựng từ pivot cơ học. Trader vẽ tay có thể khác (trendline, vùng tròn số, khung tuần chưa test).
- Nến chạm cả TP lẫn SL trong cùng ngày được tính là SL (giả định bảo thủ). Không tính trượt giá.
