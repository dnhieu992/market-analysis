# BTC — săn win rate 80% chỉ với RSI + FxCanli Volume (2024 → 2026-09)

**Ngày:** 2026-09-28 · **Mục tiêu (user):** chiến lược BTC chỉ dùng RSI + FxCanli Volume (volume + MA20), R:R ≥ 1R, win rate ~80%; lưu mọi chiến lược ≥ 60%.
**Dữ liệu:** Binance BTCUSDT 5m/15m/30m/1h/2h/4h/1d, 2024-01-01 → 2026-09-28 (tải từ Mac, VPS→Binance quá chậm).
**Script:** `claude-backtest/scripts/rsi-volume-winrate/` (python + numba): `engine.py`, `sweep.py` (R1), `sweep2.py` (R2), `sweep_wf.py` (walk-forward), `verify.py`.
**Dữ liệu kết quả:** `claude-backtest/runs/2026-09-28-btc-rsi-volume-candidates.csv` (12 546 cấu hình: ≥60% mỗi năm hoặc ≥80% tổng).

## Quy tắc mô phỏng
- Tín hiệu tính trên nến ĐÓNG, vào lệnh ở open nến kế tiếp; 1 lệnh tại một thời điểm.
- SL: swing (đáy/đỉnh 3/5/10/20 nến ± 0/0.2%) hoặc % cố định (0.5–5%). TP = RR × rủi ro, RR ∈ {1, 1.25, 1.5, 2} (≥ 1R như yêu cầu). Không time-stop (trần 2000 nến).
- Nến chạm cả SL và TP → tính THUA (bảo thủ). Phí 0.05%/chiều trừ vào R. Win = chạm TP.
- Volume: `vr = volume / MA20(volume)` (đúng pane FxCanli Volume trên chart), mức lọc none / ≥1 / ≥1.5 / ≥2 / ≥3 / <1.
- RSI: chu kỳ 7/14/21 trên TF vào lệnh; lọc HTF = RSI14 của TF lớn hơn (1h/4h/1d, không nhìn trước).

## Họ chiến lược (long + short đối xứng)
| họ | điều kiện |
|---|---|
| rsi_cross_back | RSI cắt ngược lên khỏi vùng quá bán (os 20–40) + nến xanh |
| rsi_extreme_bar | RSI < os (bắt đáy) |
| extreme_then_reversal_bar | nến đỏ RSI < os, nến sau xanh đóng trên giữa thân |
| rsi_momentum_cross | RSI cắt lên 50/55/60 + nến xanh |
| breakout | đóng cửa vượt đỉnh N nến + RSI > 50/60 |
| rsi_divergence | giá tạo đáy mới N nến nhưng RSI cao hơn (phân kỳ) + nến xanh |

## Kết quả
| vòng | số biến thể thử | ≥60% & kỳ vọng > 0 | ≥70% | ≥80% |
|---|---|---|---|---|
| R1: trigger + volume + lọc xu hướng HTF (7 TF) | ~98k | 3 148 | 55 | **0** |
| R2: + vùng RSI của 2 TF lớn (confluence) | ~9M | ~91k | ~3 000 | **64** |

R1 tốt nhất và ổn định (≥60% cả 3 năm):
- 4h LONG: RSI21 cắt lên 60, vol ≥ 2×MA20, RSI 1D > 50, SL swing3, 1R → 28 lệnh, **75%** (78/78/70% theo năm).
- 1h LONG: RSI14 cắt ngược lên 30, vol ≥ 2×MA20, SL 2%, 1R → 49 lệnh, **71.4%** (68/75/71%).
- 30m SHORT: phân kỳ RSI21 (N=20), RSI 4h < 50, SL 2%, 1R → 50 lệnh, **72%**.

R2 — cấu hình "đạt 80%" tốt nhất (15m SHORT, 1R):
> RSI(7) 15m cắt xuống 50 trên nến đỏ, volume ≥ 3×MA20, RSI14 1h trong 60–70, RSI14 1D trong 40–60, SL = đỉnh 3 nến, TP 1R.
> **22 lệnh, WR 90.9%**, +15R (2024: 7/7, 2025: 9/10, 2026: 4/5).

Ablation của chính cấu hình này:
| bộ lọc | lệnh | WR | 2026 |
|---|---|---|---|
| đầy đủ (1h 60–70 + 1D 40–60) | 22 | 90.9% | 4/5 |
| chỉ 1h 60–70 | 35 | 77.1% | 6/11 |
| chỉ 1h > 60 | 43 | 72.1% | 6/11 |
| không lọc HTF | 174 | 58.0% (kỳ vọng ≈ 0) | 27/48 |

## ⚠️ Kiểm tra overfit (walk-forward): con số 80% có đáng tin không?
Chọn cấu hình CHỈ bằng dữ liệu 2024–2025, rồi xem kết quả ở 2026 (dữ liệu chưa thấy):
| WR in-sample 2024–25 | số cấu hình | WR thực ở 2026 (gộp) |
|---|---|---|
| ≥ 70% | 13 840 | **45.1%** |
| ≥ 75% | 3 193 | 45.4% |
| ≥ 80% | 635 | 48.3% |
| ≥ 85% | 97 | 54.6% |
| ≥ 90% | 22 | 68.1% (gần như toàn bộ là cụm 15m short ở trên, 2026 chỉ 5–11 lệnh) |

→ Với ~9 triệu phép thử, 80% trên 20–35 lệnh xuất hiện **do may mắn thống kê**: trung bình cấu hình "70–85%" trong quá khứ chỉ còn **~45–48%** ở dữ liệu mới. Ở RR 1:1 có phí, hoà vốn ≈ 52–55%.

## Kết luận
1. **80% win rate với R:R ≥ 1 chỉ đạt được trên backtest bằng cách lọc cực chặt** (≈ 8 lệnh/năm) và **không giữ được ngoài mẫu**. Không nên coi là chiến lược 80% thật.
2. Tín hiệu có nền tảng rõ nhất: **cú xả volume lớn (≥ 3×MA20) làm RSI(7) 15m gãy 50 khi 1h đang quá mua (RSI 60–70) → short 1R** — edge đến từ bộ lọc HTF, bản thân trigger chỉ 58%. Kỳ vọng thực tế ~65–75%, ít lệnh.
3. Mức thực tế hơn: các cấu hình **70–75% ổn định cả 3 năm** ở R1 (4h long momentum + volume, 1h long RSI cắt ngược 30 + volume). Nên paper-trade trước khi dùng tiền thật.
4. Đồng nhất với các lần trước: volume spike + RSI chỉ có giá trị khi có bối cảnh TF lớn; tự thân RSI/volume ≈ tung đồng xu.

---

## Phần 2 — yêu cầu tần suất: ≥ 1 lệnh/ngày hoặc 2 lệnh / 3 ngày (≥ ~650 lệnh từ 2024)
Script: `sweep_hf.py` (5m/15m/30m/1h, SL % 0.3–3% hoặc swing, RR 1–2), `portfolio.py`.

**212 846 cấu hình có đủ tần suất (WR ≥ 50%) → chỉ 71 cấu hình có kỳ vọng > 0 sau phí.** Trần win rate thực tế ở tần suất này là **~55–57% với 1R**.

Tốt nhất (ổn định cả 3 năm):
| # | cấu hình | lệnh | /ngày | WR | kỳ vọng | tổng | 2024/25/26 |
|---|---|---|---|---|---|---|---|
| A | 5m SHORT: RSI14 cắt xuống 45 trên nến đỏ, RSI14 1h < 40, RSI14 1D < 60, SL 1%, TP 1% | 726 | 0.73 | **56.9%** | +0.038R | +27.4R | 57.6 / 55.6 / 57.6 |
| B | 5m LONG: RSI7 cắt ngược lên 30 trên nến xanh, RSI14 1h ≥ 40, RSI14 1D ≥ 50, SL 1.5%, TP 1.5% | 707 | 0.71 | 54.6% | +0.025R | +17.9R | 54.8 / 54.8 / 53.8 |

A + B chạy song song ≈ 1.4 lệnh/ngày, ~+45R trong 2.75 năm (≈ +$450 nếu risk $10/lệnh), chưa tính trượt giá. Edge rất mỏng: phí 0.1%/vòng đã ăn ~0.07–0.1R mỗi lệnh; dùng lệnh limit (maker) sẽ cải thiện đáng kể.

**Thử gộp nhiều chiến lược WR cao (ít lệnh) thành danh mục để đủ tần suất** — chọn bằng 2024–25, kiểm tra 2026:
| chọn theo WR 2024–25 | số chiến lược | WR 2024 / 2025 | **WR 2026** | tổng R 2026 |
|---|---|---|---|---|
| ≥ 70% | 6 586 | 72.6% / 74.0% | **46.0%** | −12 606R |
| ≥ 75% | 1 786 | 76.7% / 78.6% | **45.7%** | −3 275R |
| ≥ 80% | 374 | 81.7% / 82.9% | **47.1%** | −538R |
→ Danh mục "win rate cao" sụp về ~46% và LỖ khi gặp dữ liệu mới. Không có cách đạt vừa tần suất cao vừa WR 70–80% bằng RSI + volume.

### Phần 2b — cùng tần suất (≥ 0.65 lệnh/ngày) với RR 1.5 và 2 (`sweep_hfrr.py`)
~2.5 triệu phép thử (5m/15m/30m/1h). 30m và 1h: 0 cấu hình có lãi ở tần suất này.
| RR | có lãi | WR hoà vốn (+phí) | tốt nhất | lệnh/ngày | WR | tổng | WR 2024/25/26 |
|---|---|---|---|---|---|---|---|
| 1.5 | 99 | ~40% (+~3%) | 5m LONG phân kỳ RSI7 (N20), vol < MA20, RSI 1h ≥ 40, SL 1.5% | 0.67 | 44.0% | +21.7R | 46.6 / 43.3 / **40.8** |
| 2 | 84 | ~33% (+~3%) | 15m LONG RSI7 cắt lên 50, vol < MA20, RSI 1h ≥ 40, RSI 1D ≥ 30, SL 1.5% | 0.66 | 36.9% | +25.9R | 39.6 / 35.3 / **33.3** |
→ Lợi nhuận tổng tương đương 1R (+20–26R) nhưng edge **giảm dần theo năm và ~hoà/lỗ ở 2026**; RR 1 (chiến lược A short, 57.6% năm 2026) ổn định hơn. Toàn bộ cấu hình tốt là LONG, lọc volume < MA20 (pullback cạn volume) + RSI 1h ≥ 40.
