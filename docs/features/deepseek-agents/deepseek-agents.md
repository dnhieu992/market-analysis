## Description
Trang `/deepseek` — **DeepSeek Agents**, nơi chạy các agent dùng model của DeepSeek. Hiện có 1 agent: **BTC day trading — price action đa khung**. Bấm **Phân tích BTC** thì hệ thống chụp dữ liệu BTCUSDT trên 4 khung 1D / 4H / 1H / 15m từ Binance, để DeepSeek đọc top-down thành **một** tín hiệu vào lệnh trong ngày, rồi **kiểm tra lại hình học của lệnh bằng code** trước khi trả về.

Hai nguyên tắc thiết kế:

**1. Model không tự lấy dữ liệu.** DeepSeek không có dữ liệu thị trường realtime và không duyệt web, nên bất kỳ con số nào không được đưa vào prompt là con số nó sẽ **bịa**. `BtcPaSnapshotService` lo toàn bộ phần số, DeepSeek chỉ lo phần đọc. API trả **cả tín hiệu, bài phân tích lẫn snapshot**; UI hiển thị bảng dữ liệu ngay dưới để trader đối chiếu từng câu.

**2. Price action thuần — KHÔNG chỉ báo.** Snapshot cố ý không có EMA / RSI / MACD / ATR / Bollinger. Agent chỉ được dùng ba thứ:
- **Price action**: cấu trúc thị trường (HH/HL/LH/LL), swing high/low, hỗ trợ – kháng cự ngang, hành vi nến gần nhất, volume thô.
- **Trend line**: đường nối 2 đáy gần nhất / 2 đỉnh gần nhất, kèm giá trị đường tại hiện tại, độ dốc, số lần chạm, đã gãy hay chưa.
- **Fibonacci**: retracement 0.236 / 0.382 / 0.5 / 0.618 / 0.786 của chân sóng gần nhất, extension 1.272 / 1.618 làm mục tiêu.

Vì snapshot không có chỉ báo, system prompt phải **cấm nhắc tới chỉ báo** chứ không chỉ im lặng: một model được hỏi setup sẽ theo thói quen viết "RSI đang quá bán", và ở đây con số đó chắc chắn là bịa.

Phần được tính bằng code (không giao cho model) là phần phải giống nhau ở mọi lần chạy: nến nào là pivot, cấu trúc đang HH/HL hay LH/LL, trend line hôm nay nằm ở đâu, fib của chân sóng hiện tại là bao nhiêu. Model đọc những thứ đó rồi quyết định — nó không bao giờ phải làm số học trên 180 cây nến, đúng thứ nó làm dở nhất.

DeepSeek dùng API **tương thích OpenAI** (`POST /chat/completions`, bearer token), nên `deepseek.client.ts` cố tình giữ đúng hình dạng của `OpenAiChatProvider` sẵn có — khác biệt thật sự chỉ là host, tên model, và trường `reasoning_content` mà model reasoner trả thêm.

| Model (`DEEPSEEK_MODEL`) | Là gì | Ghi chú |
|---|---|---|
| `deepseek-v4-pro` (mặc định) | DeepSeek-V4-Pro-0813 | Bản GA 13/08/2026, mạnh nhất |
| `deepseek-v4-flash` | DeepSeek-V4-Flash-0731 | Nhanh và rẻ hơn |

Hai tên cũ `deepseek-chat` / `deepseek-reasoner` (V3 / R1) đã bị khai tử 24/07/2026 — vai trò "suy luận trước khi trả lời" nay nằm ở thinking mode của chính V4. Client gửi `reasoning_effort` theo `DEEPSEEK_REASONING_EFFORT`, mặc định `high`, đổi được sang `low` hoặc `max`. Phần model nghĩ trả về ở `reasoning_content` và hiện trong mục "Quá trình suy luận của model".

Hai điểm cần nhớ khi thinking đang bật: `temperature` / `top_p` / `presence_penalty` / `frequency_penalty` bị API bỏ qua (nhận nhưng không có tác dụng), nên `temperature: 0.2` trong service chỉ có ý nghĩa nếu sau này tắt thinking; và token nghĩ ăn chung ngân sách với câu trả lời, nên `max_tokens` để 8000 chứ không phải 2000.

## Main Flow
1. **SSR** — `/deepseek` gọi `fetchDeepseekStatus()` để biết đã có key chưa và model nào đang dùng. Lỗi API → rơi về `{ configured: false }` để trang vẫn render kèm hướng dẫn.
2. **Bấm Phân tích BTC** → `POST /deepseek/agents/btc-daytrade`.
3. **Chụp dữ liệu** (`BtcPaSnapshotService.build()`) — 4 call `/api/v3/klines` song song (1D / 4H / 1H / 15m), mỗi khung 181 nến (180 đã đóng + 1 đang chạy). Với mỗi khung, tính **chỉ trên nến đã đóng**:
   - **Pivot fractal 5 nến** — đây là primitive duy nhất cả file dựa vào, nên cấu trúc / mốc ngang / trend line / chân fib không bao giờ mâu thuẫn nhau.
   - **Cấu trúc**: nhãn HH/LH/HL/LL cho từng pivot so với pivot cùng loại trước đó; đỉnh cuối HH **và** đáy cuối HL → uptrend, LH **và** LL → downtrend, còn lại → range.
   - **Swing 20 nến** (cao/thấp + biên % giá) và **mốc ngang**: pivot dưới giá = hỗ trợ, trên giá = kháng cự, gần nhất trước, gom mức trùng trong 0.15%.
   - **Trend line**: qua 2 pivot đáy gần nhất và 2 pivot đỉnh gần nhất, chiếu tới cây nến hiện tại.
   - **Fibonacci** trên chân sóng gần nhất (pivot cuối ngược về pivot ngược loại liền trước).
   - **8 nến gần nhất** kèm volume thô + volume trung bình 20 nến làm mốc so sánh.
   Giá hiện tại lấy từ nến 15m đang chạy (không cần call ticker riêng); 24h change/high/low suy từ 24 nến 1H đã đóng để nhất quán với phần còn lại.
4. **Dựng prompt** (`DeepseekService.buildPrompt`) — render snapshot thành text (~9.2k ký tự, ~2.6k token), kèm mốc thời gian chụp và nguồn Binance spot, kết bằng khối `### YÊU CẦU`.
5. **Gọi DeepSeek** — system prompt (cách đọc top-down, 3 kịch bản vào lệnh, quy tắc SL/TP, cấm chỉ báo, định dạng trả lời), `temperature: 0.2`, `stream: false`, timeout 120s.
6. **Bóc câu trả lời** (`parseAnswer`) — khối ```json là tín hiệu, phần còn lại là markdown. Khối JSON bị **cắt khỏi** markdown vì UI đã render nó thành thẻ tín hiệu.
7. **Kiểm tra bằng code** (`verify`) — xem mục dưới. Kết quả về `signal.warnings[]`.
8. **Trả kết quả** — `{ analysis, signal, reasoning, model, generatedAt, snapshot, usage }`.
9. **Render** — thẻ tín hiệu (hướng, vùng vào, SL, TP, R/R, bias 4 khung, điều kiện huỷ, cảnh báo) → bài phân tích markdown → suy luận của model (thu gọn) → khối "Dữ liệu đã đưa cho model" (ô thống kê + bảng price action theo khung) → dòng meta model · giờ chụp · giờ trả lời · token.

### Các hard check trong `verify()`
Model tự khai R/R **không được tin** — API tính lại từ chính giá nó đưa. Lỗi được báo thành `warnings[]` chứ không xoá tín hiệu: một setup đặt SL sai chỗ vẫn đáng xem, miễn là được dán nhãn.
- SL / TP nằm sai phía so với điểm vào.
- R/R tính lại tới TP1 < 1.5 (ngưỡng của chính prompt).
- Model khai R/R lệch > 20% so với R/R tính lại.
- **SL chưa ra ngoài cấu trúc**: phải nằm ngoài mốc hỗ trợ/kháng cự 15m gần nhất tính từ điểm vào, fallback là đáy/đỉnh swing 20 nến 15m.
- TP1 cách điểm vào ≤ 3× phí khứ hồi (0.1%) — quá mỏng để lãi thật.
- Vùng vào cách giá hiện tại > 2% — là lệnh chờ, không vào được ngay.

## Edge Cases
- **Chưa cấu hình `DEEPSEEK_API_KEY`**: `GET /deepseek/status` trả `configured: false`, nút bị disable và trang chỉ rõ cần thêm biến nào. Nếu vẫn gọi thẳng API thì nhận 503 kèm câu tiếng Việt tương ứng.
- **Key đọc tại thời điểm gọi**, không phải lúc khởi tạo class — `pm2 restart --update-env` là đủ để nhận key mới. (Sửa `.env` suông thì pm2 KHÔNG nạp lại — xem `project_live_trading_kill_switch`.)
- **Lỗi từ DeepSeek được dịch sang câu hành động được**: 401 → key sai, 402 → hết số dư, 429 → giới hạn tần suất, còn lại lấy `error.message` gốc. Tất cả về 503, hiện thẳng trong panel đỏ.
- **Binance lỗi ở bất kỳ khung nào là fatal** → 503, KHÔNG gọi model. Tín hiệu "đa khung" dựng trên 3/4 khung là một phân tích khác, yếu hơn, đội lốt cùng cái tên.
- **Chỉ tính trên nến đã đóng.** Nến 15m đang chạy được tách riêng, dán nhãn "CHƯA ĐÓNG" trong prompt và chỉ dùng làm giá hiện tại. Nếu đưa nó vào phần tính pivot thì mọi con số sẽ nhảy giữa hai lần chạy cách nhau một phút.
- **Dung sai trend line theo biên dao động của từng khung**, không phải phần trăm cố định: band = 10% biên swing 20 nến của khung đó. Đo thực tế 18/08/2026 — band cố định 0.15% (~$96) trên khung 15m có biên swing chỉ 0.62% (~$400) đánh dấu gần như mọi cây nến là "chạm", báo một đường vẽ 2 tiếng trước là đã test 7 lần; đổi sang band theo biên thì còn 2 lần.
- **Trend line có thể vẽ được nhưng vô nghĩa**: đường 0 lần chạm, hoặc cách giá vài phần trăm, vẫn được trả về nhưng kèm đúng số lần chạm và khoảng cách để model tự đánh giá. Đường bị coi là **gãy** khi có nến **đóng** ra ngoài band — râu xuyên qua là cách trend line được test, không phải cách nó hỏng.
- **Cấu trúc có thể mâu thuẫn giữa các khung** (18/08/2026: 1D uptrend, 4H range, 1H downtrend, 15m uptrend) — đó là thông tin thật, không phải lỗi. Prompt yêu cầu ưu tiên NO_TRADE khi 4H và 1H ngược nhau.
- **Chân sóng quá nhỏ thì không vẽ fib** (< 0.3% biên) — trả `fib: null`, prompt ghi rõ "không vẽ" thay vì đưa mốc vô nghĩa.
- **Không đủ pivot** (khung mới, ít nến): cấu trúc trả `range` kèm ghi chú "không đủ pivot để đọc cấu trúc", trend line rỗng.
- **Model không trả khối JSON đúng định dạng**: không fatal — `signal: null`, UI hiện dòng cảnh báo và vẫn render phần phân tích. Có fallback bắt cặp ngoặc khi model quên hàng rào ```json.
- **Snapshot chỉ là Binance spot BTCUSDT**: không có funding, open interest, thanh lý, dòng tiền ETF, tin tức, và không có coin nào khác. Điều này được ghi thẳng vào system prompt để model không nói quá phạm vi dữ liệu.
- **Thời gian chờ**: 4 call Binance rồi chờ model, thinking `high`/`max` có thể lâu — client timeout 120s, UI hiện "có thể mất 10–60 giây" và disable nút trong lúc chạy.
- **Chưa chạy thật với key**: đường dữ liệu (Binance → snapshot → prompt) đã chạy end-to-end với dữ liệu thật (18/08/2026, prompt ~2.6k token, pivot/trend line/fib đều ra số hợp lý). Key đã có trong `.env` và xác thực OK (17/08/2026), nhưng tài khoản DeepSeek **hết số dư** — API trả `Insufficient Balance` (402), nên **phần gọi model vẫn chưa được kiểm chứng**. Nạp tiền là chạy được ngay, không cần đổi code.

## Related Files (FE / BE / Worker)
**Web**
- `apps/web/src/app/deepseek/page.tsx` — route `/deepseek` (re-export mỏng).
- `apps/web/src/_pages/deepseek-agents-page/deepseek-agents-page.tsx` — Server Component, SSR trạng thái cấu hình.
- `apps/web/src/widgets/deepseek/btc-daytrade-agent.tsx` — Client Component: nút phân tích, loading/lỗi, thẻ tín hiệu, bài markdown, bảng price action theo khung.
- `apps/web/src/shared/api/types.ts` — khối type `Deepseek*` (pivot, trend line, fib, tín hiệu, snapshot).
- `apps/web/src/shared/api/client.ts` — `fetchDeepseekStatus()`, `runDeepseekBtcDaytrade()` (ném đúng `message` của API để panel lỗi có nội dung).
- `apps/web/src/app/globals.css` — khối `.ds-*` (thẻ tín hiệu, bias, cảnh báo, bảng).
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — mục "DeepSeek Agents".

**API**
- `apps/api/src/modules/deepseek/deepseek.client.ts` — client DeepSeek (OpenAI-compatible), đọc key lúc gọi, bóc `reasoning_content` + `usage`.
- `apps/api/src/modules/deepseek/btc-pa-snapshot.service.ts` — snapshot price action đa khung: pivot, cấu trúc HH/HL, mốc ngang, trend line, Fibonacci, nến thô + volume. **Không có chỉ báo nào.**
- `apps/api/src/modules/deepseek/deepseek.service.ts` — system prompt price action, dựng prompt từ snapshot, gọi model, bóc JSON tín hiệu, `verify()` hình học lệnh, dịch lỗi sang tiếng Việt.
- `apps/api/src/modules/deepseek/deepseek.controller.ts` — `GET /deepseek/status`, `POST /deepseek/agents/btc-daytrade`.
- `apps/api/src/modules/deepseek/deepseek.module.ts`
- `apps/api/src/modules/market/binance-market-data.service.ts` — `fetchKlines()` dùng chung với worker.
- `apps/api/src/app.module.ts` — đăng ký `DeepseekModule`.

**Worker**
- Không dùng. Agent chạy theo yêu cầu từ UI, không có cron.

**Shared**
- `.env` (root, không commit) — `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_API_BASE_URL`, `DEEPSEEK_REASONING_EFFORT`. Repo **không có** `.env.example`, và các biến này cũng không đi qua `@app/config` — `deepseek.client.ts` đọc thẳng `process.env` tại thời điểm gọi.
