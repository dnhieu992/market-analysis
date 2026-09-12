# Compression breakout — biến quan sát 19-21/08/2026 thành chiến lược, backtest BTC

**Date:** 2026-09-03
**Symbol:** BTCUSDT spot, 1d
**Capital:** $1000 compound, long-only, không đòn bẩy, không pyramid
**Fee:** 0.05%/side (0.1%/vòng). Không tính slippage/funding.

## Command

```bash
# sweep tham số
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-compression-breakout-backtest.ts BTCUSDT 2020 0.05 sweep

# out-of-sample từng giai đoạn
... run-compression-breakout-backtest.ts BTCUSDT 2017 0.05 oos 2019
... run-compression-breakout-backtest.ts BTCUSDT 2020 0.05 oos 2022
... run-compression-breakout-backtest.ts BTCUSDT 2023 0.05 oos 2026

# danh sách lệnh
... run-compression-breakout-backtest.ts BTCUSDT 2020 0.05 detail
```

Script: `scripts/run-compression-breakout-backtest.ts`

## Giả thuyết được kiểm tra

Rút ra từ scan thị trường ngày 2026-09-03 (cú nổ BTC 19-21/08): 4 điều kiện xuất hiện cùng lúc.

| # | Luật | Mã hoá |
|---|---|---|
| 1 | **Nén biên độ** | `(maxHigh − minLow)` của N nến trước ≤ `maxRangePct` |
| 2 | **Cạn volume** | volume cạn trước cú phá — 2 cách đo: trung bình N ngày (`avg`), hoặc ngày thấp nhất trong N ngày (`min`) |
| 3 | **Phá + nổ volume** | close > đỉnh N nến trước, VÀ volume nến phá ≥ `volMult` × TB20 |
| 4 | **Lọc EMA200** | chỉ vào khi close > EMA200 |

Thoát lệnh so sánh 4 cách: UTBot kv2 lật bear / chandelier 3×ATR / thủng EMA20 / TP20-SL8.

**Benchmark quan trọng — cột `EDGE`:** so với việc nắm **đúng số ngày đó** nhưng vào **thời điểm ngẫu nhiên** (`rand-hold`). So return thô với buy & hold là không công bằng khi chiến lược chỉ ở trong thị trường 16-40% thời gian. EDGE > 0 nghĩa là việc *chọn thời điểm* thật sự có giá trị.

## Kết quả chính — BTC 2020-01-01 → 2026-09-03

Buy & hold: $7,201 → $80,856 = **+1022.9%** ($11,229), **maxDD 77.1%**

| Config | lệnh | win% | equity | return% | maxDD | expo% | PF | rand-hold | **EDGE** |
|---|---|---|---|---|---|---|---|---|---|
| **Breakout trần** (đỉnh 20 ngày, không lọc gì) | 43 | 49% | **$9,700** | +870.0% | 52.5% | 40% | 2.92 | $2,619 | **+270%** |
| Breakout + nén ≤15% | 24 | 50% | $4,276 | +327.6% | 31.0% | 21% | 3.88 | $1,679 | +155% |
| Breakout + nén + EMA200 | 16 | 56% | $4,137 | +313.7% | **23.1%** | 16% | **6.10** | $1,473 | +181% |
| Breakout + nén + cạn-min0.8/5d | 23 | 52% | $4,513 | +351.3% | 25.4% | 21% | 4.22 | $1,651 | +173% |
| **ĐỦ BỘ 4 điều kiện** | **4** | 50% | $1,266 | +26.6% | 10.4% | 3% | 3.46 | $1,086 | **+17%** |
| Breakout trần + chandelier 3ATR | 36 | 47% | $8,565 | +756.5% | 53.9% | 47% | 3.35 | $3,156 | +171% |
| Breakout + nén + EMA200 + chandelier | 14 | 57% | $6,463 | +546.3% | 37.0% | 21% | 7.86 | $1,642 | +294% |

### Cổng volume làm hỏng chiến lược

| Cổng volume nổ | lệnh | equity | EDGE |
|---|---|---|---|
| tắt | 24 | $4,277 | +155% |
| ≥1.2x | 19 | $2,663 | +75% |
| ≥1.5x | 17 | $2,497 | +73% |
| ≥2.0x | 12 | $1,671 | **+26%** |

### Độ nén càng chặt càng ít giá trị (N=20, thoát UTBot kv2)

| maxRangePct | lệnh | equity | EDGE |
|---|---|---|---|
| ≤8% | 5 | $1,698 | +54% |
| ≤12% | 15 | $2,622 | +98% |
| ≤15% | 24 | $4,277 | +155% |
| ≤20% | 35 | $3,890 | +87% |
| **≤100% (tắt)** | 43 | **$9,704** | **+271%** |

### Cách đo "cạn volume" quyết định toàn bộ

`avg` (trung bình 3-5 ngày) gần như loại sạch tín hiệu: 0.6x → **1 lệnh trong 6.7 năm**. `min` (ngày thấp nhất) giữ được mẫu:

| Đo | lệnh | equity | EDGE |
|---|---|---|---|
| avg 0.6x/3d | 1 | $952 | −6% |
| avg 0.8x/3d | 10 | $1,713 | +41% |
| min 0.5x/5d | 12 | $2,165 | +67% |
| min 0.6x/5d | 18 | $3,891 | +153% |
| **min 0.8x/5d** | 23 | $4,515 | **+173%** |

## Out-of-sample: cùng config, 3 giai đoạn tách rời

Cột = **EDGE** (số lệnh trong ngoặc).

| Config | 2017-2019 | 2020-2022 | 2023-2026 | Ổn định? |
|---|---|---|---|---|
| **Breakout trần** | +61% (8) | +128% (18) | +60% (25) | ✅ dương cả 3, mẫu đủ lớn |
| Breakout + nén | +83% (2) | +40% (4) | +72% (20) | ⚠️ dương nhưng mẫu 2-4 lệnh |
| Breakout + nén + EMA200 | +61% (1) | +70% (2) | +59% (14) | ⚠️ rất đều nhưng 1-2 lệnh |
| Breakout + nén + cạn-min | +83% (2) | +40% (4) | +86% (19) | ⚠️ như trên |
| **ĐỦ BỘ 4 điều kiện** | **0 lệnh** | **0 lệnh** | +15% (4) | ❌ không giao dịch được |
| Breakout trần + chandelier | +54% (8) | +120% (14) | +23% (22) | ⚠️ suy giảm rõ |
| Nén + EMA200 + chandelier | +60% (1) | +160% (2) | +46% (12) | ⚠️ mẫu nhỏ |

## Takeaway

**Giả thuyết gốc bị bác bỏ.** Bộ 4 điều kiện quan sát được ở cú nổ 19-21/08/2026 — nén biên độ + cạn volume + phá kèm volume nổ + trên EMA200 — chỉ tạo ra **0 lệnh giai đoạn 2017-2019, 0 lệnh 2020-2022, và 4 lệnh 2023-2026**. Cái mình thấy hôm 19/08 gần như là **một sự kiện đơn lẻ, không phải mẫu hình lặp lại**. Đây chính là cái bẫy kể-chuyện-sau-khi-giá-đã-chạy: 4 chỉ báo cùng đẹp trên một cây nến không có nghĩa cả 4 cùng tạo ra edge.

**Từng thành phần khi tách ra:**
- **Cổng volume nổ có hại rõ ràng** — EDGE tụt từ +155% xuống +26% khi bắt buộc ≥2x. Trên BTC D1, nến phá có volume lớn thường đã là nến giãn xa, vào ở đó = mua đuổi.
- **Nén biên độ không phải nguồn edge.** Tắt hẳn bộ lọc nén (`rng≤100%`) cho EDGE cao nhất (+270%). Nén chỉ nâng chất lượng từng lệnh (win 50%→56%, PF 3.88→6.10) nhưng cắt mẫu quá sâu.
- **Cạn volume đo bằng `min` là trung tính-hơi tốt** (+173% vs +155%). Đo bằng `avg` thì phá huỷ chiến lược — cùng một ý tưởng, hai cách mã hoá, kết quả trái ngược. Bài học: định nghĩa chỉ báo quan trọng ngang ý tưởng.
- **EMA200 là bộ lọc tốt nhất trong 4 cái**: maxDD 31%→23.1%, PF 3.88→6.10, win 50%→56%, EDGE +155%→+181%, và đều dương ở cả 3 giai đoạn.

**Cái thật sự sống sót là thứ đơn giản nhất: phá đỉnh 20 ngày + trailing stop UTBot kv2.** 43 lệnh, win 49%, EDGE dương ở cả 3 giai đoạn OOS với mẫu đủ lớn (8/18/25 lệnh). Không có bộ lọc nào trong câu chuyện gốc thêm được giá trị bền vững lên trên nó.

**So với buy & hold:** không config nào thắng về return tuyệt đối ($9,700 vs $11,229). Nhưng risk-adjusted thì hơn — return/maxDD: breakout trần **16.6** vs B&H **13.3**, và chỉ ở trong thị trường 40% thời gian. Bản "nén + EMA200" cho maxDD 23.1% (so với 77.1% của B&H) nếu ưu tiên ngủ ngon hơn ưu tiên số cuối.

**Lưu ý fit:** đã thử ~50 config trên 24-43 lệnh. Chênh lệch giữa các dòng trong bảng sweep phần lớn là nhiễu. Chỉ dòng "breakout trần" có mẫu OOS đủ để tin. Chandelier trông tốt nhất ở bảng full-period (+225%) nhưng OOS suy giảm đều (+54 → +120 → +23) — đúng dấu hiệu của tham số fit vào giai đoạn 2020-2022.

**Lệnh đang mở:** vào 2026-08-19 @ $69,335 (chính cú nổ đã phân tích), hiện +16.5%, chưa thoát.
