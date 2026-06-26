## Description
Sinh lệnh limit (swing + day-trade) cho mỗi coin trong trang `/tracking-coins`, kèm
entry zone / TP / SL / R:R, và đánh giá kết quả (kích hoạt, TP/SL) trên dữ liệu nến sau đó.
Logic là thuật toán hình học (S/R từ swing high/low) — không dùng LLM.

Cập nhật 2026-06-14 (P1 + P2) để tăng tỉ lệ thắng sau khi phát hiện toàn bộ lệnh đã chốt
đều SL (xem `win-rate-analysis-2026-06-14.md`):

- **P1 — Stop loss theo ATR:** SL đặt cách entry tối thiểu `k×ATR` (swing k=1.6 / H4 ATR,
  day-trade k=1.3 / H1 ATR), nới rộng thêm nếu cấu trúc S/R đòi hỏi. Thay cho stop cố định
  ~0.8% trước đây vốn bị nhiễu quét. Có fallback theo % khi ATR=0.
- **P1 — TP đảm bảo R:R:** TP1 được đẩy tới mức xa hơn giữa [S/R kế tiếp, mục tiêu theo bội
  số R] để R:R ≥ tối thiểu (1.5).
- **P2 — Regime gate:** nếu D1 đi ngang (|longScore − shortScore| < 1.0 **và** trend D1 không
  rõ up/down) → trả `null` (no-trade), không ép ra lệnh.
- **P2 — Đồng bộ hướng:** day-trade lấy hướng theo bias D1 (không còn tính độc lập theo H4),
  trừ ngoại lệ đảo chiều mạnh H4 (UT Bot đảo + RSI cực trị ≥70/≤30) mới cho scalp ngược.

Cập nhật 2026-06-14 (P3 + P4):

- **P3 — Thực thi `minRR`:** sau khi sinh lệnh, nếu `rrRatio < swingMinRR/daytradeMinRR` (setup
  per-coin) → coi như no-trade (không lưu, xóa lệnh cũ cùng ngày). `null` setup = không chặn.
  Trước đây `minRR` chỉ là setting hiển thị, không có tác dụng.
- **P4 — Đánh giá chính xác hơn:**
  - Bỏ bias bi quan: `evaluateLimitOrder` không còn chấm SL ngay trên cây nến vừa khớp entry —
    chỉ xét TP/SL từ nến kế tiếp (một wick quét cả entry+SL không còn bị tính thua oan).
  - Hết hạn lệnh: cửa sổ đánh giá bị giới hạn theo tuổi lệnh (swing 5 ngày, day-trade 1 ngày);
    quá hạn mà chưa chạm TP/SL → `outcome = 'expired'` (không tính thắng/thua). Tránh việc
    day-trade trôi nhiều ngày rồi sớm muộn cũng dính SL.

Cập nhật 2026-06-14 (bỏ day-trade):

- **Gỡ hẳn lệnh day-trade khỏi tracking-coins** — chỉ còn sinh lệnh **swing**. Lý do: backtest
  P5 cho thấy daytrade (đặc biệt daytrade LONG) kỳ vọng âm, kéo lùi hiệu suất. Worker + API
  ngừng tạo lệnh daytrade và `deleteOrder(...,'daytrade')` để dọn lệnh cũ trong ngày; UI bỏ card
  "Day trade" ở tab Tín hiệu hôm nay và bỏ section day-trade trong dialog Setup. Lịch sử lệnh
  daytrade cũ vẫn giữ (bản ghi quá khứ). Hàm `computeDayTradeLimitOrder` vẫn còn trong core
  (không xoá) để có thể bật lại sau; backtest harness chuyển sang swing-only.
- **Siết side LONG (asymmetric filter):** `resolveD1Regime` chỉ trả `LONG` khi D1 trend là
  `StrongUp`; mọi uptrend nhẹ hơn → no-trade. SHORT không đổi. Lý do: backtest 1 năm cho thấy
  long ở uptrend không-mạnh là net-âm. Kết quả sau khi siết (365 ngày, 5 coin): OVERALL
  E[R] +0.060→**+0.116**, PF 1.13→**1.26**, MDD −36.6R→**−21.9R**; swing LONG từ −0.041 về hòa
  (−0.001), drawdown −49.6R→−15.8R. No-trade rate ~38% (chọn lọc hơn).

Cập nhật 2026-06-26 (lọc xu hướng tuần W1):

- **W1 alignment filter:** `resolveD1Regime` thêm bộ chặn theo **UT Bot khung Tuần**
  (`utBotW1Bullish`, vốn đã được tính & hiển thị trên page nhưng trước đây không dùng cho việc
  sinh lệnh). Chặn LONG khi W1 bearish (`utBotW1Bullish === false`) và chặn SHORT khi W1 bullish
  (`=== true`); `null` (thiếu lịch sử tuần) **không** chặn. `OrderSigSnapshot` thêm field
  `utBotW1Bullish`; cả 3 nơi dựng snapshot (worker scan, API `suggestOrders`, API re-analyze) đều
  truyền vào.
- **Kết quả backtest walk-forward** (xem `claude-backtest/runs/2026-06-26-tracking-coins-w1-filter.md`):
  rổ 5 coin 365 ngày OVERALL E[R] +0.137→**+0.179**, PF 1.33→**1.43**; BTC 365 ngày
  E[R] +0.148→**+0.321**, PF 1.42→**2.03**, win 43.9%→**52.0%**; giảm drawdown ở mọi cửa sổ. Chỉ
  dùng mode UT Bot (mode theo `weekTrend` không generalize trên rổ nên bị loại). Phe LONG vẫn yếu —
  là hạng mục tối ưu kế tiếp.

## Main Flow
1. Scan (cron worker, nút Re-analyze qua API, hoặc tab "Tín hiệu hôm nay" gọi live) lấy nến
   D1/H4/H1 từ Binance.
2. Tính chỉ báo + `longScore/shortScore` + ATR (H4 cho swing, H1 cho day-trade).
3. `resolveD1Regime()` quyết định bias D1 hoặc no-trade (gồm: regime gate, siết LONG StrongUp,
   **lọc W1 UT Bot**). `resolveDayTradeSide()` khóa hướng day-trade theo D1 (có ngoại lệ đảo chiều).
4. `computeSwingLimitOrder` / `computeDayTradeLimitOrder` trả `LimitOrderResult | null`:
   - chọn pivot S/R, dựng entry zone,
   - `buildLongOrder`/`buildShortOrder` tính SL theo ATR và TP theo R.
5. Nếu có lệnh → `upsertOrder`; nếu `null` (no-trade) → `deleteOrder` (xóa lệnh cũ cùng ngày
   nếu có, tránh lệnh cũ tồn đọng).
6. Vòng đánh giá `evaluateLimitOrder` cập nhật `activated` + `outcome` cho lệnh chưa chốt.
7. UI: tab "Tín hiệu hôm nay" hiển thị 2 card; khi `null` hiển thị `NoTradeCard` ("NO-TRADE").

## Edge Cases
- **ATR = 0 / thiếu dữ liệu nến:** fallback SL theo % (swing 1.8%, day-trade 1.0%).
- **No-trade chuyển từ có lệnh:** `deleteOrder` đảm bảo không còn lệnh cũ hiển thị sai.
- **TP2 không hợp lệ** (≤ TP1 với LONG, ≥ TP1 với SHORT) → set `null`.
- **`sig = null`** (chưa scan) → regime trả `null` → no-trade (an toàn, không mặc định LONG).
- **risk ≤ 0:** chặn bằng sàn `1e-9` và `rrRatio` tối thiểu 0.1.
- **Migration:** cột `outcome` nới từ VARCHAR(5) → VARCHAR(10) để chứa `'expired'`
  (`20260614000002_widen_order_outcome`).
- **Chưa làm (xem analysis doc):** P5 backtest harness (đo lường khách quan P1–P4),
  P6 LLM validator (đã quyết định bỏ qua).

## Related Files (FE / BE / Worker)
- `packages/core/src/orders/tracking-coin-orders.ts` — regime gate, đồng bộ hướng, ATR stop, R-based TP, evaluate. **Core logic.**
- `packages/core/src/orders/tracking-coin-orders.spec.ts` — test cho P1/P2.
- `apps/worker/src/modules/tracking-coin-scan/tracking-coin-scan.service.ts` — scan cron: tính ATR, upsert/delete theo no-trade.
- `apps/api/src/modules/tracking-coins/tracking-coins.service.ts` — `suggestOrders` (live) + `scanOneCoin` + `persistSuggestion` (upsert/delete + map về UI), type `OrderSuggestionsResult` (swing/scalp nullable).
- `packages/db/src/repositories/tracking-coins.repository.ts` — `deleteOrder` mới.
- `packages/db/prisma/schema.prisma` + `migrations/20260614000002_widen_order_outcome/` — `outcome` VARCHAR(10) cho `'expired'`.
- `apps/web/src/shared/api/types.ts` — `OrderSuggestions.swing/scalp` nullable.
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — `NoTradeCard`, render null.
- `apps/web/src/app/globals.css` — style `.ord-card--notrade`, `.tt-side-badge--neutral`.
