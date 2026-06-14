# Phân tích tỉ lệ thắng — Tracking Coin Limit Orders (2026-06-14)

> Tài liệu phân tích/đánh giá, không phải mô tả feature. Mục đích: chẩn đoán vì sao lệnh
> limit ở trang `/tracking-coins` bị SL nhiều, và đề xuất phương án cải thiện để bạn quyết
> định có đưa vào code hay không.

## 1. Dữ liệu thực tế (snapshot lúc phân tích)

Nguồn: bảng `tracking_coin_orders` (truy vấn trực tiếp MySQL).

| Chỉ số | Giá trị |
|--------|---------|
| Tổng lệnh | 20 (10 swing + 10 daytrade) |
| Khoảng thời gian | 2026-06-13 → 2026-06-14 (2 ngày) |
| Đã kích hoạt (`activated=1`) | 10 |
| Chưa kích hoạt / chưa eval | 10 |
| **Outcome = SL** | **6** |
| **Outcome = TP1/TP2** | **0** |
| Đang chạy (activated, chưa TP/SL) | 4 |

**Win rate trên các lệnh đã chốt = 0/6 = 0%.** Toàn bộ lịch sử bảng chưa từng có một lệnh nào chạm TP.

> ⚠️ **Cảnh báo thống kê:** mẫu rất nhỏ (6 lệnh đã chốt, 1 phiên down market). Các kết luận
> dưới đây dựa trên **lỗi cấu trúc trong code** (kiểm chứng được), không dựa trên ý nghĩa thống
> kê của win rate. Cần thêm dữ liệu để xác nhận hiệu quả sau khi sửa.

### Chi tiết lệnh đã chốt (13/06)

| Coin | Loại | Side | Stop dist (entry→SL) | R:R | Kết quả |
|------|------|------|----------------------|-----|---------|
| ADA | daytrade | LONG | 0.8% | 1.42 | ✗ SL |
| SOL | daytrade | LONG | 0.8% | 2.98 | ✗ SL |
| TAO | daytrade | LONG | 0.8% | 3.03 | ✗ SL |
| TAO | swing | LONG | 1.69% | 3.61 | ✗ SL |
| BTC | daytrade | SHORT | 0.8% | 1.17 | ✗ SL |
| SOL | swing | SHORT | 1.71% | 1.35 | ✗ SL |

## 2. Nguyên nhân gốc (xếp theo mức độ tác động)

### 🔴 #1 — Stop loss quá chặt, cố định theo %, không theo biến động (ATR)
File: `packages/core/src/orders/tracking-coin-orders.ts`

- Daytrade: SL = `entryLow * 0.995` (LONG) / `entryHigh * 1.005` (SHORT) → **luôn ~0.8%** từ entry-mid.
- Swing: SL bị ép tối thiểu `entryLow*0.992` / `entryHigh*1.008` → ~0.8–1.2%, thực tế ~1.7%.
- Crypto intraday dao động 1–3%/ngày là bình thường → stop 0.8% gần như **chắc chắn bị quét bởi nhiễu** trước khi tới TP.
- Hệ quả số học: dù hướng đúng, lệnh vẫn SL. Đây là lý do **6/6 lệnh đã chốt đều SL, 0 TP**.

**Bằng chứng:** mọi lệnh daytrade đều có stop đúng 0.8% (giá trị cố định, không đổi theo coin/biến động).

### 🔴 #2 — Daytrade và Swing sinh hướng độc lập → mâu thuẫn, đánh ngược trend
File: `tracking-coin-orders.ts` → `determineSide('D1')` (swing) vs `determineSide('H4')` (daytrade)

- Swing quyết định side theo `longScore/shortScore` (D1). Daytrade quyết định theo `utBotH4/h4Trend` (H4). **Hai hàm chạy độc lập, không ràng buộc nhau.**
- Kết quả: 5/10 coin-day có daytrade **ngược chiều** swing:

  | Ngày | Coin | Daytrade | Swing |
  |------|------|----------|-------|
  | 13/06 | ADA | LONG | SHORT |
  | 13/06 | SOL | LONG | SHORT |
  | 14/06 | ADA | LONG | SHORT |
  | 14/06 | SOL | LONG | SHORT |
  | 14/06 | BTC | LONG | SHORT |

- Trong phiên down 13/06, **4/4 lệnh LONG đều SL** — daytrade LONG đánh ngược bias SHORT của khung lớn = bắt dao rơi.

### 🟠 #3 — Chiến lược entry là "fade" (mua tại hỗ trợ / bán tại kháng cự) nhưng không có bộ lọc regime
- LONG đặt limit **dưới** giá hiện tại tại support; SHORT đặt **trên** tại resistance → bản chất là đánh đảo chiều/mean-reversion.
- Trong thị trường trending mạnh, fade + stop chặt = công thức thua. Không có trạng thái "no-trade" / "chỉ đánh thuận trend": **mỗi lần scan luôn ép ra đủ 1 swing + 1 daytrade** bất kể điều kiện.

### 🟠 #4 — `minRR` là setting chết (feature chưa hoàn thiện)
- `swingMinRR` / `daytradeMinRR` được lưu DB, hiển thị ở dialog Setup, nhưng **không hề được dùng** trong `tracking-coin-scan.service.ts` để lọc lệnh.
- Chỉ module `day-trading/setup-analyzer.service.ts` (tính năng khác) mới thực sự dùng `minRR` làm cổng chặn.
- Người dùng chỉnh minRR ở UI nhưng không có tác dụng gì → kỳ vọng sai.

### 🟡 #5 — Lỗi/điểm yếu trong logic đánh giá outcome (`evaluateLimitOrder`)
File: `tracking-coin-orders.ts` + vòng eval trong `tracking-coin-scan.service.ts`

1. **Bias bi quan trong cùng 1 nến:** khi kích hoạt và kiểm tra SL trên *cùng* cây nến, nếu nến có wick chạm cả entry lẫn SL thì luôn tính SL (vì check SL trước). Một wick đơn lẻ quét cả entry+SL trong 1 nến H1/H4 → tính SL ngay, **làm phồng tỉ lệ SL** so với fill thực tế.
2. **Daytrade không hết hạn:** lệnh daytrade nếu chưa fill/chốt sẽ tiếp tục được eval qua **nhiều ngày** (vòng `findUnresolvedOrders`), trong khi đáng lẽ phải hết hạn cuối ngày. Để mở lâu → sớm muộn cũng dính SL.
3. **Cửa sổ nến H1 chỉ 72h:** `h1Klines limit=72`. Lệnh daytrade cũ hơn 3 ngày sẽ bị slice nến thiếu → eval sai.

## 3. Đánh giá: "use tool" hiện tại đã đủ chưa? Cần build thêm gì?

**Phát hiện quan trọng:** các lệnh limit này **được sinh 100% bằng thuật toán hình học** (phát hiện swing high/low + nhân hệ số %). **Không có bất kỳ LLM tool_use nào tham gia** vào việc tạo entry/TP/SL. "AI" duy nhất ở trang này là nút "Tạo prompt" (chat drawer) — chỉ để copy prompt thủ công, không tự đánh giá lệnh.

→ Hiện tại **chưa có tool/agent nào thực sự "phân tích" chất lượng lệnh.** Pipeline chỉ là: indicator → công thức S/R → ghi DB.

### Công cụ/agent đề xuất build thêm

| Mức | Hạng mục | Mô tả |
|-----|----------|-------|
| Bắt buộc | **ATR provider** | Hàm tính ATR (D1/H4/H1) trong `@app/core`. Là input cho stop động — thiếu cái này thì không sửa được #1. |
| Bắt buộc | **Trend/regime gate** | Hàm `shouldTrade(side, sig)` chặn lệnh ngược bias D1 và lệnh trong sideway. Trả về `null` (no-trade) hợp lệ. |
| Nên có | **Backtest harness cho tracking orders** | Hiện `BackTestResult` chỉ phục vụ module strategy khác. Cần script backtest riêng cho logic `computeSwing/DayTradeLimitOrder` trên dữ liệu lịch sử để đo win-rate *trước khi* deploy thay đổi (vì mẫu live quá nhỏ). |
| Tùy chọn | **LLM order-validator (tool_use)** | Một bước LLM (giống `swing-pa-review`) nhận snapshot + lệnh đề xuất, trả về `{approve, adjustedSL?, reason}` bằng structured output. Lọc bỏ lệnh "đẹp về hình học nhưng sai context". Cân nhắc chi phí/độ trễ. |
| Tùy chọn | **Order expiry job** | Cron đánh dấu daytrade quá hạn = `expired` thay vì để eval trôi nhiều ngày. |

> **Trạng thái triển khai (2026-06-14):** ✅ **P1, P2, P3, P4, P5 đã được code**
> (xem `tracking-coin-orders.md` + `p5-backtest-harness.md`). P6 (LLM validator) đã bỏ qua.
> Backtest đầu tiên (5 coin, 180 ngày, 1623 lệnh): tổng thể **E[R] +0.086, PF 1.19** — kỳ vọng
> dương; điểm yếu phát hiện: **side LONG kém SHORT** một cách nhất quán → ứng viên tinh chỉnh.

## 4. Phương án cải thiện đề xuất (ranked, kèm vị trí code)

> Tất cả ở `packages/core/src/orders/tracking-coin-orders.ts` trừ khi ghi khác. **Nhớ build
> `@app/core` trước** rồi tới worker (xem CLAUDE.md / memory build-order).

### P1 — Stop động theo ATR (tác động lớn nhất)
- Thêm tham số `atr` vào `computeSwing/DayTradeLimitOrder`.
- SL = `entry ∓ k * atr` (gợi ý k: daytrade 1.2–1.5, swing 1.5–2.0) thay cho hệ số % cố định.
- TP đặt theo bội số R (vd TP1 = 1.5R, TP2 = 2.5R) hoặc S/R kế tiếp, **lấy cái xa hơn** để đảm bảo R:R.
- Worker truyền ATR vào (cần P1-tool ATR ở mục 3).

### P2 — Đồng bộ hướng + cổng regime
- Daytrade **không được ngược** hướng D1 trừ khi có tín hiệu đảo chiều mạnh (vd RSI quá mua/bán + UT Bot đảo).
- Nếu D1 sideway/score cân bằng → trả `null` (no-trade), không ép ra lệnh.
- Cập nhật UI để hiển thị "Hôm nay không có setup" thay vì lệnh kém.

### P3 — Thực thi `minRR`
- Trong `scanOne`, sau khi compute order: nếu `rrRatio < minRR` tương ứng → **không lưu lệnh** (hoặc lưu kèm cờ `belowMinRR`).
- Biến setting đang chết thành cổng chặn thật.

### P4 — Sửa logic đánh giá
- `evaluateLimitOrder`: tách nến kích hoạt và nến chốt, hoặc giả định fill rồi mới tính TP/SL từ nến **kế tiếp** để giảm bias bi quan.
- Thêm hết hạn cho daytrade (vd 1 ngày) và swing (vd 5 ngày) → outcome `expired`.
- Tăng `h1Klines limit` hoặc tính cửa sổ eval theo tuổi lệnh.

### P5 — Backtest trước khi tin tưởng
- Viết harness chạy logic mới trên N tháng dữ liệu Binance, báo win-rate / expectancy / max drawdown trước khi bật cho user.

## 5. Kết luận

Nguyên nhân SL nhiều **không phải do "AI dự đoán sai"** — mà do **logic hình học cố định**: stop quá
chặt (#1) + cho phép đánh ngược trend (#2) + entry kiểu fade không có bộ lọc regime (#3). `minRR`
người dùng chỉnh không có tác dụng (#4) và bộ đánh giá hơi thiên về SL (#5).

Thứ tự ưu tiên sửa để tăng win-rate: **P1 (ATR stop) → P2 (regime gate) → P3 (minRR) → P4 (eval) → P5 (backtest)**.

Vì mẫu dữ liệu còn nhỏ, khuyến nghị làm **P5 (backtest harness)** song song để đo lường khách
quan thay vì chỉ dựa vào vài lệnh live.

## Related Files (FE / BE / Worker)
- `packages/core/src/orders/tracking-coin-orders.ts` — sinh lệnh (entry/TP/SL/side) + đánh giá outcome. **Nơi sửa chính P1–P4.**
- `apps/worker/src/modules/tracking-coin-scan/tracking-coin-scan.service.ts` — gọi compute, lưu lệnh, vòng eval. Nơi thêm ATR input, minRR gate, expiry.
- `packages/db/src/repositories/tracking-coins.repository.ts` — `upsertOrder`, `findUnresolvedOrders`, `updateOrderEvaluation`.
- `apps/api/src/modules/tracking-coins/tracking-coins.service.ts` — đọc setup (`swingMinRR`/`daytradeMinRR` hiện không tác động logic).
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — hiển thị order history & dialog setup.
- `packages/db/prisma/schema.prisma` — model `TrackingCoinOrder` (cân nhắc thêm `outcome='expired'`).
