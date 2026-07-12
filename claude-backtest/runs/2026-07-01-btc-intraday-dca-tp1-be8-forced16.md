# BTC Intraday DCA — TP +1% (trước 8h) → chốt hoà (sau 8h) → đóng bắt buộc 16h UTC

**Ngày:** 2026-07-01
**Script:** `scripts/run-btc-intraday-dca-tp-be-backtest.ts`
**Kỳ backtest:** CHỈ 2023-01-01 → nay (1277 ngày, nến 15m).

## Ý tưởng (theo yêu cầu user)
- Vào LONG lúc **00:00 UTC** (lệnh 1 = market tại giá mở cửa ngày).
- Chia **5 lần** vào lệnh, mỗi lần **cách nhau 2%**: mức = `dayOpen × (1 − {0,2,4,6,8}%)`. Lệnh 2–5 là limit, khớp khi low nến chạm mức. Mỗi lệnh = 1/5 vốn ngày.
- Quản lý **cả vị thế** theo giá hoà vốn TB (net phí): `bePx = tổngChiPhí / (tổngQty × (1−fee))`.
  - **Trước 08:00 UTC:** chốt **lời +1%** → thoát khi giá ≥ `1.01 × bePx`.
  - **Từ 08:00 UTC:** ưu tiên **chốt hoà** → thoát khi giá ≥ `bePx`.
- **Đóng bắt buộc 16:00 UTC** nếu chưa thoát. **KHÔNG stop-loss.** Vốn compound, không giữ qua đêm.

## Config
Symbol BTCUSDT, nến 15m, fee **0.05%/side**, vốn **$1000 compound**. Trong 1 nến: khớp limit (low) trước → kiểm tra thoát (open gap-up, else high) sau; thoát 1 lần/ngày, không vào lại.

## Lệnh chạy
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-intraday-dca-tp-be-backtest.ts BTCUSDT 0.05
```

## Kết quả — 1277 ngày (2023→2026-07)
| Config | Return | Win ngày | avgFill | TP / BE / forced | worst ngày | best ngày | maxDD |
|---|---|---|---|---|---|---|---|
| Bench: mua 0h / bán 16h | **−57.6%** | 46% | 1.0/5 | 0 / 0 / 1277 | −7.9% | +9.0% | 69.9% |
| **★ User: 2% · TP1% · BE@8h** | **−10.2%** | 55% | 1.2/5 | 333 / 726 / 218 | −4.0% | +2.0% | 15.6% |
| spacing 1% · TP1% · BE@8h | −9.7% | 59% | 1.6/5 | 349 / 770 / 158 | −5.0% | +2.0% | 18.3% |
| spacing 3% · TP1% · BE@8h | −9.6% | 56% | 1.1/5 | 328 / 709 / 240 | −4.9% | +1.7% | 13.8% |
| 2% · TP1% · BE@4h (sớm) | −11.5% | 54% | 1.2/5 | 214 / 899 / 164 | −4.0% | +2.0% | 16.0% |
| 2% · TP1% · BE@12h (muộn) | −11.9% | 58% | 1.2/5 | 435 / 569 / 273 | −4.0% | +2.0% | 16.0% |
| 2% · TP1% · no-BE (TP tới 16h) | −21.2% | 60% | 1.2/5 | 593 / 0 / 684 | −4.0% | +2.0% | 24.0% |
| 2% · TP2% · BE@8h | −10.0% | 52% | 1.2/5 | 105 / 943 / 229 | −4.0% | +2.0% | 18.1% |
| 2% · TP0.5% · BE@8h | −8.4% | 63% | 1.2/5 | 640 / 453 / 184 | −4.0% | +2.0% | 13.2% |

## Takeaway
**Chiến lược đúng như mô tả THUA LỖ −10.2% qua 3.5 năm** — nhưng cải thiện lớn so với bench mua-mở-bán-đóng (−57.6%) và so với bản "đóng bắt buộc, không TP" trước đó (−57.6% ở cùng khung). Luật "chốt hoà sau 8h" đã cắt được phần lớn máu, kéo maxDD từ 70% xuống ~16%. Vẫn không có lãi vì **profile lời/lỗ lệch âm cố hữu**:

1. **Thắng bị chặn, thua thả nổi.** Win cap ở **+1%** (TP) hoặc **0%** (chốt hoà), nhưng những ngày sập không hồi về hoà vốn → bị **ép bán ở đáy** (worst −4%/ngày trên vốn đã giải ngân). 726/1277 ngày chỉ hoà vốn (không lời), 333 ngày +1%, 218 ngày forced-loss. Vài ngày forced −4% nuốt hết hàng trăm ngày +1%.
2. **Chốt hoà là con dao hai lưỡi.** Bỏ hẳn chốt hoà (TP tới 16h) tệ hơn hẳn (−21%) → chốt hoà đúng là cần thiết để sống. Nhưng nó cũng biến **đa số ngày thắng thành hoà** (0 lời), nên upside trung bình gần 0 trong khi phí + ngày sập vẫn ăn mòn.
3. **Không có edge long intraday.** Bench âm ở cả kỳ → drift intraday chiều long ≈ 0; DCA + quản trị thời gian chỉ *giảm tốc độ chảy máu*, không tạo ra lợi thế.

Sensitivity: TP thấp hơn (0.5%) nhích tốt hơn chút (−8.4%, win 63%) vì bắt lời dễ hơn; nhưng vẫn âm. Không config nào dương.

## Đề xuất (nhất quán với các run DCA trước trong repo)
- Vấn đề gốc vẫn là **thoát bằng đồng hồ + chặn lời**. Muốn có kỳ vọng dương cần **bỏ trần lời** (để ngày xanh chạy, đừng chốt hoà toàn bộ) và/hoặc **gate xu hướng** (chỉ DCA long khi khung lớn tăng) để né những ngày trend-down khớp sâu rồi ép bán đáy.
- DCA muốn thắng phải **thoát bằng giá, không bằng đồng hồ** — xem `2026-07-01-btc-intraday-dca-forced-close.md` và các run accumulation/dip-bounce gated.
