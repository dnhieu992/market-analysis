# TỔNG KẾT — Backtest chiến lược DCA Ladder (`/dca-ladder`)

> Ngày: 2026-06-27 · Tài sản: BTCUSDT 1d · Vốn: $1000 · Phí: 0.05%/side (0.1% round-trip)
> Dữ liệu: Binance public klines, full history 2017-09 → 2026-06 (3200 ngày)
> Scripts: `scripts/run-dca-ladder-backtest.ts`, `scripts/run-dca-ladder-failrule-backtest.ts`
> Chi tiết kỹ thuật (tiếng Anh): `claude-backtest/runs/2026-06-27-dca-ladder.md`

---

## 1. Chiến lược đang chạy là gì

DCA theo bậc, **KHÔNG có stop-loss**:
- Theo dõi một **peak** (đỉnh) đang chạy khi cycle ở trạng thái FLAT.
- Đặt **10 lệnh mua giới hạn** ở các mức **5 / 6.5 / 8 / 9.5 / 11 / 12.5 / 14 / 15.5 / 17 / 18.5%** dưới peak, mỗi bậc dùng `budget/10`.
- Giá (low ngày) chạm bậc nào → fill bậc đó. Fill đầu tiên → cycle thành IN_POSITION, peak đóng băng, đặt TP bán 100% ở `avgCost × 1.10`.
- Các bậc sâu hơn vẫn fill khi giá rớt tiếp (avgCost bình quân giảm dần).
- Giá (high ngày) chạm TP → bán hết 100%, chốt lãi, lãi compound vào budget cycle mới.

⚠️ **Lưu ý config:** config LIVE thật nằm ở DB schema default (`schema.prisma → DcaLadderSettings`):
**firstTierPct 5, numTiers 10, stepPct 1.5, tpPct 10, feePct 0.05, enabled true**.
`FALLBACK_STATE` trong page (10/5/5/10) chỉ dùng khi API chết — KHÔNG phải config thật.
Vì 10 bậc đều nằm trong 18.5% dưới peak → **chỉ cần một cú giảm ~19% là fill sạch toàn bộ budget**.

---

## 2. Kết quả backtest config LIVE (10 bậc, 5%/step 1.5%, TP+10)

| Khung | Cycle | Win% | Lãi đã chốt | Bag mở (chưa thực hiện) | Equity cuối | Tổng | Âm vốn max | Time in market | Buy&Hold |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| Full 3200d | 53 | 100% | +$16,845 | **−$8,170** | $9,674 | **+867%** | −81.9% | 98.4% | **+1,495%** |
| 1825d (từ đỉnh 2021) | 27 | 100% | +$2,940 | **−$1,804** | $2,136 | +114% | −74.5% | 97.5% | +68% |
| 365d (năm qua) | 2 | 100% | +$60 | **−$485** | $575 | **−42.5%** | −45.8% | 95.3% | −43.8% |

**Hiện trạng cuối kỳ:** đang kẹt 1 cycle mở — **10/10 bậc đã fill**, avgCost ≈ $111,161, đã giải ngân $17,845, giá mark ≈ $60,296 → **âm 45.8%, kẹt 261 ngày**, hết bậc để mua, không có lối thoát.

### Kết luận phần này
- **Code (implementation): CHUẨN** — khớp logic page, khớp số realized với backtest gốc.
- **Strategy: KHÔNG an toàn.** "Win rate 100%" là **ảo (survivorship bias)** — lệnh thắng đóng ở +10%, lệnh thua không bao giờ đóng, chỉ treo và gom lỗ.
- Full history **thua buy & hold nặng** (+867% vs +1,495%), nằm thị trường 98% thời gian, drawdown −82% trên bag mở.
- Năm qua **−42.5%**, gần bằng B&H đi xuống → không giảm được rủi ro.
- Chỉ thắng B&H ở khung 1825d vì khung đó B&H mua đúng đỉnh 2021 (xui) — không phải edge bền vững.
- Config 10 bậc còn **dễ kẹt vốn hơn** config 5 bậc fallback.

---

## 3. Đối chiếu với backtest GỐC đã sinh ra strategy này

Page build từ loạt run: `2026-06-27-btc-dca-dip-bounce.md` → `-configA-sweep.md` → `-oos-validation.md`.
Backtest mới **khớp, không mâu thuẫn** với chúng:

- Trên cơ sở **realized-PnL**, engine của tôi tái tạo đúng số của họ. Config sweep khuyến nghị (−8/13/18/23, TP+15) headline ≈ **+2,549%**; engine tôi cho **realized +2,468%** — cùng tầm.
- Khác biệt duy nhất là **cái bag đang kẹt**. Bảng cũ headline theo realized/in-sample; khi mark-to-market bag mở (−40%) thì **mọi config đều thua B&H**:

| Config (full history, có tính bag mở) | Realized | Bag mở | Equity cuối | vs B&H +1,494% |
|---|--:|--:|--:|--:|
| **LIVE DB default 5%/10 bậc/1.5 step, TP+10** | +1,684% | −$8,170 | **+867%** | −628% |
| Page FALLBACK −10/15/20/25/30, TP+10 (5 bậc) | +2,367% | −$9,842 | +1,383% | −111% |
| Reco −8/13/18/23, TP+15 (4 bậc) | +2,468% | −$10,764 | +1,392% | −103% |
| Reco −8/13/18/23, TP+30 | +2,151% | −$9,437 | +1,208% | −287% |
| Shallow −5/9/13/17, TP+10 | +1,671% | −$8,182 | +853% | −641% |

**2 điểm quan trọng:**
1. Config LIVE (5%/10 bậc/1.5) **KHÔNG phải config sweep khuyến nghị** — và là cái **tệ nhất**, xa B&H nhất.
2. Chính run gốc `-oos-validation.md` đã kết luận **tiêu cực**: *"does not survive honest out-of-sample testing… does not beat buy & hold"*, chỉ 1/20 config tốt nhất in-sample vượt B&H out-of-sample (overfitting).

---

## 4. Rule nhận biết "cycle thất bại" để reset (theo yêu cầu)

Yêu cầu: không quan tâm khoản lỗ (bag thua gộp vào chiến lược HOLD dài hạn), cần rule biết cycle đã **chết** để giải phóng ladder, bắt đầu cycle mới bắt nhịp bounce tiếp.

**Mô hình test:** notional cố định $1000/cycle. Khi fail → park bag sang bucket HOLD, ladder reset cycle mới ở giá hiện tại. Wins cộng dồn bằng tiền mặt.

3 họ rule: `time:<D>` (mở ≥ D ngày) · `dd:<X>` (low ≥ X% dưới avgCost) · `tier:<Y>` (full bậc + low ≥ Y% dưới bậc cuối). Full history, config 10 bậc:

| Rule | Win cycles | Tiền chốt$ | Bag park | Chết sau | Bag hồi lại TP (median ngày) | Kẹt max |
|---|--:|--:|--:|--:|--:|--:|
| **none (hiện tại)** | 53 | 2,989 | 0 | – | – | **261d, kẹt ∞** |
| time:60 | 128 | 5,604 | 24 | 60d | 22/24 (125) | 42d |
| time:90 | 119 | 5,803 | 13 | 90d | 11/13 (117) | 42d |
| time:120 | 111 | 5,346 | 10 | 120d | 9/10 (291) | 42d |
| time:180 | 105 | 4,988 | 7 | 180d | 6/7 (309) | 42d |
| time:270 | 94 | 4,819 | 3 | 270d | 3/3 (575) | 261d |
| dd:15 | 186 | 8,757 | 46 | 15d | 43/46 (117) | 9d |
| dd:20 | 170 | 8,628 | 30 | 23d | 27/30 (173) | 122d |
| **dd:25** | **155** | **8,270** | **22** | **28d** | **20/22 (374)** | **42d** |
| dd:30 | 138 | 7,514 | 13 | 50d | 12/13 (451) | 59d |
| dd:40 | 136 | 7,305 | 10 | 72d | 9/10 (375) | 42d |
| tier:2 | 198 | 8,757 | 75 | 10d | 71/75 (44) | 9d |
| tier:3 | 195 | 8,687 | 71 | 11d | 67/71 (43) | 9d |
| tier:5 | 192 | 8,946 | 63 | 11d | 60/63 (70) | 9d |
| tier:8 | 184 | 8,667 | 48 | 15d | 45/48 (81) | 9d |

### Phát hiện
1. **Có rule là ladder chạy gấp 2–3 lần** (53 → 119–198 cycle thắng; $2,989 → $5.8–8.9k tiền chốt).
2. **Park gần như miễn phí theo kế hoạch của bạn:** ~90% bag park sau đó tự hồi về +10% (lành trong bucket HOLD, median ~1 năm) trong khi ladder vẫn in tiền. "Bỏ cycle" ≠ "mất tiền".
3. **Trade-off:** rule gắt (dd:15 / tier:2–5) tối đa cycle nhưng park nhiều (46–75 bag → phải bơm nhiều vốn hold); rule vừa (dd:25–30) park ít (13–22 bag), giải phóng ladder trong ~1–2 tháng, giữ ~85% tiền.
4. **Rule theo GIÁ tốt hơn theo THỜI GIAN** — `dd`/`tier` phản ứng theo mức sụt thật; `time` võ đoán.

### KHUYẾN NGHỊ
**Định nghĩa cycle thất bại = giá (low ngày) thủng ≥ 25–30% dưới avgCost** (`dd:25`–`dd:30`).
Vì 10 bậc nằm trong 18.5% dưới peak → ngưỡng này ≈ "giá rớt ~35% dưới đỉnh cycle và ladder đã bắn hết đạn" = bear thật, không phải pullback thường.

- **`dd:25` là điểm cân bằng đẹp nhất:** 155 cycle thắng (+$8.3k tiền mặt trên notional $1k), giải phóng ladder ~28 ngày (kẹt max 42d thay vì ∞), 20/22 bag park vẫn hồi sau đó.
- Dạng tier tương đương: **"full 10 bậc + giá thủng ~8–10% dưới bậc cuối"** → chết.
- Muốn ít bag hold hơn → `dd:30` (chỉ 13 bag).
- Khi trigger: chuyển bag sang portfolio HOLD, arm cycle mới ngay tại giá hiện tại.

---

## 5. Việc có thể làm tiếp (chưa làm)
- Implement rule vào code live: thêm `maxDrawdownPct` (mặc định 25) vào settings; worker `syncDaily()` phát hiện cycle chết → đánh dấu `FAILED`/park sang hold → tự tạo cycle mới; thêm cột hiển thị bag đã park trên page `/dca-ladder`.
- Hoặc đổi config về đúng config sweep khuyến nghị (−8/13/18/23, TP+15, 4 bậc).
- Hoặc gắn thêm bộ lọc regime / chọn coin thay cho stop-loss.
