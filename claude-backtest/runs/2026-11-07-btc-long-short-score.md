# BTC · chấm điểm tỉ lệ thắng short/long theo tiêu chí (2021-01 → 2026-10)

**Ngày:** 2026-11-07
**Yêu cầu (user):** thay vì quyết định vào lệnh hay không, chấm điểm 10 tiêu chí (+1 short hoặc +1 long), rồi tính short% = S/(S+L). Backtest từng tiêu chí, kể cả Fear & Greed.

**Cách đo:**
- Tại mỗi nến H1 đóng (khoảng 50k mẫu), xem giá chạm −X% trước (short thắng) hay +X% trước (long thắng), với X = 1 / 2 / 3%.
- Nến H1 chạm cả hai mức thì tách bằng 15m. Không phân định được trong 30 ngày thì bỏ.
- Mẫu theo giờ có tương quan với nhau, nên cột "ngày" mới là cỡ mẫu thực.

**Dữ liệu:**
- Binance futures, Fear & Greed từ alternative.me (dùng giá trị của ngày hôm trước), funding Binance.

**Scripts:** `claude-backtest/scripts/btc-long-short-score/`
- `fetch.py`: tải dữ liệu
- `features.py`: tính các tiêu chí và kết quả từng mẫu
- `analyze.py <X>`: độ lệch của từng tiêu chí
- `score.py`: kiểm tra điểm tổng có khớp thực tế không

## Mốc cơ sở
Short thắng khoảng 50% ở cả ±1/2/3%. Theo năm, dao động 45–55%.

## Từng tiêu chí (±2%, độ lệch so với mốc cơ sở)
| Tiêu chí | Short thắng khi vote short | Long thắng khi vote long | Ổn định theo năm |
|---|---|---|---|
| H4 close < EMA200 | 51.8% (+2.1) | 52.3% (+2.0) | dương 5/6 năm |
| H4 Supertrend | +2.0 | +2.0 | dương 5/6 năm |
| H4 close < EMA50 | +1.9 | +1.8 | dương 5/6 năm |
| H1 EMA50 < EMA200 | +1.3 | +1.2 | dương 4/6 năm |
| Funding ≥ 0.02% → short / < 0 → long | +1.9 | +2.5 | không ổn định |
| F&G ≥ 75 → short | 52.4% (+2.7) | — | chủ yếu nhờ 2025 |
| F&G ≤ 25 → long | — | 48.6% (−1.7) | **ngược**: sợ hãi thường đi tiếp xuống |
| D1 close < EMA50 / EMA200 | ≈0 | ≈0 | không có tác dụng |
| Gần kháng cự H4 / D1 → short | −1.6 / −2.3 | +1.0 / +1.6 | ngược bên short |
| Gần trendline H4 → short | 44.6% (−5.1) | −4.4 | **ngược**, âm 6/6 năm |
| RSI H4 > 70 → short / < 30 → long | 40.8% (−8.9) | 44.1% (−6.2) | **ngược** |
| RSI H1 > 70 / < 30 | −6.4 | −8.5 | **ngược**, âm 6/6 năm |
| BB H4, pump/dump 3%/6h, biến động 7 ngày ±10% | −3 đến −6 | −3 đến −6 | **ngược** |

## Fear & Greed chi tiết (±2%)
| Vùng F&G | Short thắng |
|---|---|
| 0–14 | 48.5% |
| 0–24 | 51.3% |
| 25–44 | 47.9% |
| 45–54 | 50.7% |
| 55–74 | 48.5% |
| 75–100 | 52.4% |
| 80–100 | 48.6% |
| 85–100 | 48.9% |

Kết luận: không có quan hệ đơn điệu nào giữa F&G và kết quả. Không nên tính điểm cho F&G.

## Funding (±2%)
- Funding âm (< −0.01%): long thắng 58% (73 ngày, tập trung năm 2021).
- Funding ≥ 0.05%: short thắng 52.7%.

## Điểm tổng có khớp thực tế không (±2%)
| Điểm short% | Điểm của user, 2021–24 | Điểm của user, 2025–26 | Điểm theo dữ liệu, 2021–24 | Điểm theo dữ liệu, 2025–26 |
|---|---|---|---|---|
| 0–19% | 50.6% | 52.7% | 44.6% | 48.7% |
| 20–39% | 47.7% | 50.7% | 48.6% | 51.0% |
| 40–59% | 46.8% | 48.1% | 50.2% | 48.0% |
| 60–79% | 49.3% | 45.9% | 49.7% | 48.2% |
| 80–100% | 52.7% | 52.4% | 53.6% | 51.5% |

Điểm theo dữ liệu gồm 4 tiêu chí xu hướng H4/H1, funding, và F&G ≥ 75.

Điểm "80–100% short" thực tế chỉ thắng khoảng 52%. Điểm S/(S+L) không phải xác suất.

## Kết hợp
| Điều kiện | ±2% | ±3% | Số ngày |
|---|---|---|---|
| Cả 4 tiêu chí xu hướng H4/H1 cùng giảm | 53.5% | 52.7% | 769 |
| 4/4 giảm + funding ≥ 0.01% + F&G ≥ 55 | 58.7% | 62.4% | 72 (2025 ngược: 37%) |

## Kết luận
1. Hướng đi của BTC trong khoảng ±1–3% gần như 50/50. Tiêu chí tốt nhất chỉ đẩy lên 52–54%.
2. Các tiêu chí đảo chiều (RSI quá mua/quá bán, gần kháng cự/trendline, ngoài BB, pump) cho kết quả **ngược** với cách dùng phổ biến: BTC có quán tính.
3. Fear & Greed không có giá trị dự báo ổn định.
4. Funding âm nghiêng về long, nhưng mẫu ít.
5. Nếu hiển thị %, phải là **tỉ lệ thắng lịch sử** ứng với tổ hợp điểm (đã hiệu chuẩn), không phải S/(S+L).
