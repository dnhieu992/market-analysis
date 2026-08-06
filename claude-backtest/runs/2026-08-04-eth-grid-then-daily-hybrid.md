# ETH — Grid $50, giảm 30% từ giá mở chu kỳ thì chuyển sang mua theo ngày

**Date:** 2026-08-04 · **Symbol:** ETHUSDT · **TF:** D1 · 2025-01-01 → 2026-08-04 (581 ngày)
**Tiếp nối:** [`2026-08-04-eth-price-step-grid-dca.md`](./2026-08-04-eth-price-step-grid-dca.md)
**Yêu cầu user:** grid $50 như run trước, nhưng khi giá giảm ~30% so với **giá mua mở chu kỳ**
thì chuyển sang **mua theo ngày**. Tập trung vào bag cuối đang lỗ.

## Rule

- Mở chu kỳ = 1 lệnh $10 tại open. Giá đó là **anchor**.
- **Phase 1 (grid):** giá xuống $50 dưới lệnh mua cuối → mua $10.
- **Switch:** lần đầu giá chạm `anchor × 0.70` → chuyển hẳn sang phase 2 cho tới hết chu kỳ.
- **Phase 2 (daily):** mua $10 tại open **mỗi ngày**, không điều kiện giá.
- Chốt: bán sạch tại `avgCost × 1.10`, hôm sau mở chu kỳ mới. Không SL. Fee 0.05%/side. Mô hình `touch`.

Script: `scripts/run-grid-then-daily-dca-backtest.ts`

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-grid-then-daily-dca-backtest.ts ETHUSDT 2025-01-01 2026-08-04 10 50 30 10 0.05 touch
```

## Bag cuối — điều user hỏi

Chu kỳ mở **2025-10-13**, anchor **$4,152.29**. Mốc switch $2,906.60 → **chạm 2025-11-19**.

| | grid thuần | **hybrid −30%** |
|---|---|---|
| Số lệnh | 53 | **284** (26 grid + 258 daily) |
| Vốn ôm | $530 | **$2,840** |
| Giá TB | $2,635.17 | **$2,280.52** |
| Lỗ tạm tính | −29.0% (−$153) | **−18.1% (−$513)** |
| Về hoà vốn cần | +40.9% | **+22.0%** |
| Chạm TP 10% cần | +54.8% | **+34.2%** |

Hai phase tách ra:

| | lệnh | vốn | giá TB |
|---|---|---|---|
| Phase 1 (grid, 10/13 → 11/19) | 26 | $260 | $3,488.80 |
| Phase 2 (daily, 11/19 → nay) | 258 | $2,580 | **$2,203.62** |

Chuyển sang mua ngày **kéo giá TB từ $3,489 xuống $2,281 — giảm $1,208**. Bag thoát khỏi thế
"cần +55%" xuống "cần +34%". Đúng như thiết kế.

## Nhưng tổng kết thì tệ hơn

| | net P/L | ROI trên vốn | peak vốn/chu kỳ |
|---|---|---|---|
| daily DCA thuần | −$633.01 | −10.90% | $3,470 |
| **grid $50 thuần** | **−$5.52** | **−0.27%** | **$530** |
| hybrid −30% | −$283.93 | −5.52% | $2,840 |

Giá phải trả để kéo giá TB xuống là **$2,310 tiền tươi thêm** (từ $530 lên $2,840). Lỗ tạm tính
tăng từ −$153 lên −$513. Hybrid nằm đúng giữa grid thuần và daily DCA — vì sau khi switch nó
**chính là** daily DCA.

### Sweep ngưỡng switch

| ngưỡng | net P/L | ROI | vốn bag | giá TB bag | cần +% để TP |
|---|---|---|---|---|---|
| −20% | −$502.83 | −9.24% | $3,230 | $2,408 | +41.7% |
| −25% | −$316.99 | −5.85% | $2,950 | $2,309 | +35.9% |
| **−30%** | **−$283.93** | **−5.52%** | $2,840 | $2,281 | +34.2% |
| −40% | −$38.55 | −0.85% | $2,240 | $2,122 | +24.9% |
| −50% | −$64.30 | −1.50% | $2,270 | $2,115 | +24.5% |

Đơn điệu: **switch càng muộn càng tốt**. −20% (switch sớm nhất) cho −9.24%, gần bằng daily DCA thuần.
Không switch (grid thuần) cho −0.27%. Nghĩa là **mọi lượng "mua theo ngày" thêm vào đều làm tệ đi**
trong giai đoạn này — hợp lý, vì ETH giảm liên tục nên mua thêm ngày nào cũng là mua sớm.

## Giá ETH cần để hoà vốn toàn bộ (lãi đã chốt + bag)

| chiến lược | giá TB bag | **ETH cần** | so với $1,869 |
|---|---|---|---|
| **grid $50 thuần** | $2,635 | **$1,898** | **+1.6%** |
| hybrid −40% | $2,122 | $1,906 | +2.0% |
| hybrid −50% | $2,115 | $1,929 | +3.2% |
| hybrid −30% | $2,281 | $2,097 | +12.2% |
| hybrid −25% | $2,309 | $2,117 | +13.3% |
| hybrid −20% | $2,408 | $2,244 | +20.1% |
| daily DCA | $2,496 | $2,329 | +24.6% |

Đây là thước đo đúng, và nó lật ngược ấn tượng ban đầu. Hybrid −30% có **giá TB đẹp hơn** grid thuần
($2,281 vs $2,635) nhưng vẫn cần ETH **+12.2%** mới hoà, trong khi grid thuần chỉ cần **+1.6%** —
vì lãi đã chốt $148 gần đủ bù cho bag $530, còn $228 không đủ bù bag $2,840.

## Takeaway

**Luật này làm đúng việc nó hứa nhưng việc đó không đáng làm.** Nó kéo giá TB bag từ $2,635 xuống
$2,281 và rút mục tiêu thoát từ +55% xuống +34% — nhìn bag riêng thì rõ ràng khá hơn. Nhưng đổi lại
phải bơm thêm $2,310, và net toàn cục tụt từ −$5.52 xuống −$283.93.

Sai lầm tư duy nó phơi ra: **giá TB thấp hơn ≠ vị thế tốt hơn**. Cách duy nhất để hạ giá TB là mua
thêm, mà mua thêm trong downtrend thì phần lỗ tăng nhanh hơn phần giá TB giảm. Thước đo "ETH cần để
hoà vốn" cho thấy grid thuần (+1.6%) tốt hơn hybrid −30% (+12.2%) dù giá TB xấu hơn $354.

Sweep đơn điệu (switch càng muộn càng tốt, tốt nhất là không switch) nên **không có ngưỡng nào cứu
được luật này** — chỉ có "switch muộn tới mức gần như không switch". Giữ grid $50 thuần.

Lưu ý: kết luận này gắn với một giai đoạn ETH giảm 44% không hồi. Nếu ETH tạo đáy rồi bật lên, hybrid
sẽ thắng ngược lại vì nó ôm nhiều hàng hơn (1.245 ETH vs 0.201 ETH) — nó là cược đòn bẩy vào việc
đáy đã hình thành. Chưa test trên giai đoạn có đáy thật.
