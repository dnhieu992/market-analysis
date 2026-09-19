# BTC — "sóng 1 nhịp, hiếm khi về test lại vùng dưới" có đúng không?

**Ngày:** 2026-09-19
**Giả thuyết (user):** Sóng BTC thường chạy 1 sóng duy nhất, rất hiếm khi giá quay về test lại các vùng dưới (đáy/hỗ trợ cũ).

## Command

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-wave-retest-stats.ts BTCUSDT 1d 2017 "5,10,15,20" 3 90
```

## Config
- Symbol/TF: **BTCUSDT 1d**, 2017-08-17 → 2026-09-19 (3321 nến).
- Phân rã sóng bằng **ZigZag theo %** (high/low), sweep ngưỡng reversal **5 / 10 / 15 / 20%**.
- "Chạm lại vùng đáy" = low ≤ đáy × (1 + **3%**). Cửa sổ forward = **90 nến**.
- Regime = close vs **SMA200** (bull: close > SMA200).
- Không phí (đây là thống kê cấu trúc giá, không phải chuỗi lệnh).

## Kết quả

### A. Độ sâu pullback so với sóng lên trước (toàn mẫu, mọi regime)
| reversal | median sóng lên | median pullback | median thoái lui | pullback **thủng** đáy cũ (≥100%) |
|---|---|---|---|---|
| 5% | +10.3% | −8.8% | 94% | **45%** |
| 10% | +20.1% | −15.9% | 97% | **48%** |
| 15% | +28.6% | −22.6% | 100% | **49%** |
| 20% | +38.1% | −28.1% | 110% | **52%** |

→ Trên **toàn bộ lịch sử**, pullback thoái lui median ~95–110% sóng trước; **~45–52%** số pullback nuốt trọn sóng lên và **thủng** đáy cũ. Toàn mẫu **KHÔNG** ủng hộ giả thuyết.

### C. Sau khi tạo đáy + sóng lên, trong 90 nến giá có quay về chạm lại vùng đáy (±3%)? — **tách theo regime**
| reversal | regime | chạy luôn (1 sóng) | retest & giữ (higher low) | quay về & **thủng đáy** |
|---|---|---|---|---|
| 10% | **BULL** | 24% | 43% | 33% |
| 10% | BEAR | 14% | 38% | **48%** |
| 15% | **BULL** | 37% | 39% | 24% |
| 15% | BEAR | 11% | 37% | **52%** |
| 20% | **BULL** | **42%** | 38% | **19%** |
| 20% | BEAR | 13% | 33% | **54%** |

## Kết luận (takeaway)

Giả thuyết **đúng một nửa, và chỉ trong bull market**:

1. **Biến quyết định là regime (SMA200), không phải bản thân BTC.** Trong **bear**, giá gần như luôn quay về và **thủng** đáy cũ (~50–54%); chỉ ~11–14% chạy 1 sóng. Bear thì ngược hẳn với giả thuyết.

2. **Trong bull + sóng lớn (reversal 15–20%)** giả thuyết mới có lực: ~**37–42%** sóng chạy 1 nhịp không quay lại, và quan trọng hơn — chỉ **~19–24%** thủng được đáy dưới. Tức là **vùng dưới hiếm khi bị PHÁ trong bull** (giữ ~80%).

3. Nhưng vế "**rất hiếm khi về test lại**" thì **quá mạnh**: ngay trong bull vẫn có ~38–43% số lần giá **quay về chạm lại** vùng đáy rồi mới bật (retest-and-hold, tạo higher low). Cộng lại, ~60% số lần giá **có** về chạm vùng dưới — chỉ là nó **giữ** chứ không thủng.

**Phát biểu chính xác hơn:** trong xu hướng tăng, BTC hiếm khi *phá* vùng dưới (đáy cũ giữ ~80%), pullback thường tạo higher low; nhưng nó **vẫn thường xuyên quay về test lại** vùng đó trước khi đi tiếp — không phải "chạy 1 lèo bỏ luôn". "1 sóng chạy luôn" chỉ chiếm ~40% ngay cả ở kịch bản đẹp nhất (bull, sóng ≥20%).

**Ứng dụng giao dịch:** mua ở retest vùng đáy cũ **khi close > SMA200** là hợp lý vì vùng đó giữ ~80%; ngược lại, đứng ngoài chờ "chắc chắn không retest" sẽ bỏ lỡ ~40% sóng chạy 1 nhịp. Bỏ filter SMA200 (mua retest trong bear) là hỏng — hơn nửa số lần thủng đáy.

---

## Bổ sung (làm rõ ý user): "hiếm khi chỉnh đủ SÂU để mua lại"

User làm rõ: vấn đề không phải "có về test đáy cũ không" mà là **sóng tăng có cho nhịp chỉnh đủ sâu để re-buy không, hay chạy một mạch**. VD sóng hiện tại: đáy ~$58–60k tháng 7–8 → chạy thẳng lên ~$82k.

### A′. Một mạch chạy được bao xa TRƯỚC KHI có nhịp chỉnh D%
| tolerance D | median run | % run ≥+20% | % run ≥+30% | % run ≥+50% |
|---|---|---|---|---|
| 5%  | +10.3% | 10% | 2%  | 0%  |
| 10% | +20.1% | 50% | 20% | 4%  |
| 15% | +28.6% | 82% | 47% | 19% |
| 20% | +38.1% | 100% | 68% | 34% |

→ Muốn đợi nhịp chỉnh **≥15%** để mua lại, bạn phải ngồi nhìn giá chạy **median +29%**, và **82%** số sóng chạy hơn +20% mà **không** cho cú chỉnh 15%. Đây chính là "hiếm khi chỉnh đủ sâu để mua lại".

### D′. Sóng đang chạy (đọc thẳng ZigZag)
Từ đáy **$57.8k (2026-07-01)**: đã chạy tối đa **+42.4%**, nhịp chỉnh **sâu nhất trong cả sóng chỉ −8.9%**. Đúng mô tả của user.

### Cú twist quan trọng
Khi nhịp chỉnh sâu (≥15%) **cuối cùng cũng đến**, ~**49–52%** số lần nó là **thủng đáy = đảo trend**, không phải "dip để mua lại" (bảng A, cột "thủng đáy cũ ≥100%"). Tức là cú chỉnh sâu vừa **hiếm** vừa **một nửa là đỉnh thật**.

### Kết luận bổ sung
Giả thuyết bản tinh chỉnh **ĐÚNG**: trong uptrend BTC, nhịp chỉnh đủ sâu để re-buy (≥15%) là **hiếm** — sóng thường chạy +20–40% chỉ với cú chỉnh nông −7÷−10%. Chiến lược "đứng ngoài chờ dip sâu" trong uptrend gần như luôn bị bỏ lại phía sau. Cách khớp dữ liệu hơn: **mua nhịp chỉnh NÔNG (−5÷−10% từ đỉnh gần nhất) hoặc scale-in đều khi close > SMA200**, thay vì đợi −15÷−20% (vừa hiếm, vừa 50% là đảo trend).
