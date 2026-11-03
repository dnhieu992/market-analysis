# Short coin rác (vốn hoá ≤ $100M, list spot + futures Binance) — tìm quy luật

**Ngày:** 2026-11-03 · **Yêu cầu (user):** thêm skill short coin rác trên /skills; scan coin rác vốn hoá nhỏ đã list Binance và tìm quy luật.
**Dữ liệu:** 282 coin đang list cả spot USDT lẫn perp USDT-M, vốn hoá ≤ $300M (cs × giá từ `bapi get-products`), nến D1 futures toàn bộ lịch sử (2020 → 2026-11-02). Phí 0.1%/vòng.
Tín hiệu trên nến D1 **đã đóng**, vào lệnh ở open ngày sau. Script Python: `claude-backtest/scripts/junk-short/` (`fetch.py` → `a1…a6.py`).
**Bias:** chỉ có coin còn đang list (coin bị delist thường về 0 → short còn tốt hơn) và vốn hoá là số hiện tại, áp ngược về quá khứ.

## 1. Drift — short ngẫu nhiên (mỗi 7 ngày một lệnh)
| vốn hoá | giữ 30d: win / med / avg | giữ 90d: win / med / avg | MAE p90 (30d) |
|---|---|---|---|
| < 20M | 63% / +8.6% / +3.6% | 71% / +23.4% / +12.4% | 72% |
| 20–50M | 62% / +6.9% / +1.2% | 68% / +18.5% / +5.3% | 68% |
| 50–100M | 60% / +5.8% / −0.7% | 64% / +15.5% / −2.4% | 77% |
| 100–300M | 59% / +5.3% / −2.5% | 64% / +15.2% / −6.7% | 69% |
Trung vị dương rõ, nhưng trung bình ≈ 0 vì đuôi pump (MAE max +2500%). Tag Monitoring: win 66% / med +9.7% (30d), hơi tốt hơn nhưng đuôi dày hơn.
Short ngay sau khi list futures: giữ 30d win 68% / med +22.6% nhưng avg +3.6%, giữ 60–180d avg âm (một vài coin x10–x50).

## 2. Setup A — xả sau pump (3D close→close ≥ +50%, coin ≤ $100M)
| lọc | n | win 14d | avg 14d | med 14d | MAE>100% |
|---|---|---|---|---|---|
| tất cả | 490 | 74.1% | +8.4% | +17.8% | 12.0% |
| BTC D1 < EMA50 | 179 | **86.0%** | **+13.9%** | +22.3% | 11.7% |
| BTC D1 ≥ EMA50 | 311 | 67.2% | +5.3% | +13.5% | 12.2% |
| coin list < 90 ngày | 55 | 69.1% | **−1.2%** | +18.5% | 16.4% |
| coin list ≥ 90 ngày | 435 | 74.7% | +9.6% | +17.5% | 11.5% |
| volume ≥ 5× TB20 | 363 | 74.1% | +10.4% | | |
| tag Monitoring | 48 | 83.3% | −1.1% | +22.3% | 20.8% (MAE p90 250%) |
| vốn hoá < 20M | 163 | 79.1% | +13.6% | +20.9% | 14.1% |
| năm ≥ 2025 / trước 2025 | 280 / 210 | 81.8% / 63.8% | +14.1% / +0.9% | | |
Pump ≥ +30%: avg 14d +4.5% · ≥ +100%: win 84%, avg +19.3%. Pump 1 ngày ≥ +30%: avg 14d +7.3%.
Không giúp: chờ nến đỏ đầu tiên sau pump 30–50% (avg 14d ≈ 0, bỏ lỡ cú xả); râu trên lớn; "dưới đỉnh 90 ngày".

## 3. Quản lý lệnh (setup A, coin list ≥ 90 ngày, kết quả theo % size dự kiến)
| cách vào | n | win | avg/lệnh | PF | lệnh tệ nhất |
|---|---|---|---|---|---|
| 1 lệnh, TP −20%, stop +100% | 438 | 82.2% | +3.7% | 1.30 | −100% |
| 1 lệnh, TP −20%, stop +50% | 438 | 74.9% | +3.6% | 1.32 | −50% |
| **3 tầng 0/+30/+60%, TP TB −20%, stop +100%, 30d** | **438** | **92.0%** | **+4.8%** | **2.39** | **−54%** |
| 3 tầng, TP TB −15% | 438 | 95.0% | +4.0% | 2.63 | −54% |
| 3 tầng 0/+25/+50%, TP −20%, stop +80% | 438 | 89.7% | +4.3% | 2.05 | −44% |
| 3 tầng + BTC bear | 165 | 93.3% | +5.1% | 2.55 | −54% |
3 tầng theo năm: 2021 PF 2.27 · 2022 2.27 · 2023 4.43 · 2024 3.71 · 2025 2.36 · 2026 1.98 — dương mọi năm.
Lưu ý: cùng nến chạm cả tầng lẫn TP được tính có lợi (D1), nên số thật sẽ thấp hơn một chút.

## 4. Setup B — hồi EMA trong downtrend (≤ $100M, list ≥ 90 ngày)
Điều kiện: EMA20 < EMA50, EMA50 dốc xuống (so 10 nến trước), 5 nến trước đóng dưới EMA20, nến đỏ có high chạm EMA20 và đóng dưới EMA50. ~66 tín hiệu/tháng.
| | n | win | avg | PF |
|---|---|---|---|---|
| 1 lệnh TP −10% stop +30% | 7356 | 69.3% | 0.0% | 1.00 |
| 3 tầng 0/+15/+30, TP −10%, stop +50%, 20d | 7360 | 80.6% | +0.8% | 1.30 |
| như trên + BTC bear | 4153 | **82.9%** | **+1.4%** | **1.75** |
→ Chỉ dùng khi BTC D1 < EMA50.

## 5. Kết luận → skill `short-junk` + tool `scan_junk_shorts`
- Universe: spot + perp Binance, vốn hoá ≤ $100M, list futures ≥ 90 ngày.
- A (chính): pump 3D ≥ +50%, vào 3 tầng 0/+30/+60%, TP TB −20%, stop cứng +100%, time stop 30d. Ưu tiên khi BTC bear.
- B (phụ): hồi EMA20 khi BTC bear, 3 tầng 0/+15/+30%, TP −10%, stop +50%, 20d.
- Cờ đỏ: funding ≤ −0.1%, tag Monitoring (giảm ½ size), volume pump < 2×, vốn hoá < $5M.
- **Stop cứng bắt buộc**, khác với kiểu DCA không SL của user: ~12% lệnh pump-fade bị chạy ngược > +100% trước khi xả.
- Size: ≤ 5% tài khoản làm margin cho cả 3 tầng, đòn bẩy ≤ 3x → lỗ tối đa ≈ 8% tài khoản/lệnh. Tối đa 3 lệnh cùng lúc.

## 6. v2 (2026-11-03, cùng ngày) — xem lại điều kiện vốn hoá
Tải thêm 69 coin lớn (tổng 350 coin). Vốn hoá **tại thời điểm tín hiệu** = cung lưu hành hiện tại × giá lúc đó
(cung quá khứ nhỏ hơn → số này hơi cao). Script: `scripts/junk-short/b1.py`, `b2.py`, `b3.py`.

**Lọc "vốn hoá hôm nay ≤ $100M" (v1) là nhìn trước tương lai:** coin hôm nay nhỏ phần lớn là coin đã giảm sau đó.
Nó còn loại đúng những coin bị pump đẩy qua ngưỡng.

Setup A (list ≥ 90 ngày, 3 tầng 0/+30/+60, TP TB −20%, stop +100%, 30d):
| vốn hoá TRƯỚC pump | n | giữ 14d avg | 3 tầng win / PF |
|---|---|---|---|
| < 20M | 70 | +3.2% | 86% / 1.18 |
| 20–50M | 79 | +17.7% | 92% / 2.46 |
| 50–100M | 101 | +13.2% | 95% / 3.24 |
| 100–200M | 88 | +4.8% | 89% / 1.70 |
| 200–500M | 86 | +1.8% | 93% / 3.64 |
| 500M–2B | 134 | −2.5% | 84% / 1.08 |
| > 2B | 99 | −8.6% | 78% / 0.83 |

% dưới ATH trước pump: < 50% → PF 0.75 (lỗ) · 50–75% 2.09 · 75–90% 2.10 · 90–97% 2.33 · > 97% 1.43.
Volume TB 20 ngày: không cho tín hiệu rõ ràng → không dùng.

| định nghĩa | n | win | PF | PF khi BTC bear | PF theo năm 21/22/23/24/25/26 |
|---|---|---|---|---|---|
| v1: cap hôm nay ≤ 100M | 438 | 92% | 2.39 (lạc quan) | 2.55 | 2.3/2.3/4.4/3.7/2.4/2.0 |
| cap trước pump ≤ 100M | 250 | 92% | 2.05 | 2.65 | |
| cap trước pump 20–500M | 354 | 92% | 2.60 | 3.81 | 0.8/3.7/4.0/2.4/3.5/2.5 |
| **v2: 20–500M + ≥ 50% dưới ATH** | **314** | **94%** | **3.16** | **3.69** | 0.9(8 lệnh)/3.7/cao/3.1/3.9/2.5 |

Setup B (BTC bear, 3 tầng 0/+15/+30, TP −10%, stop +50%): cap lúc tín hiệu < 20M PF 1.17 · 20–500M 1.74 · 500M–2B 1.35 · > 2B 1.63.

→ **Định nghĩa coin rác v2 (đang chạy):** spot + perp Binance, futures ≥ 90 ngày, đo **trước pump** (3 ngày trước nến tín hiệu với A,
chính nến tín hiệu với B): vốn hoá $20–500M **và** giá ≥ 50% dưới ATH (nến tuần + nến ngày futures).
