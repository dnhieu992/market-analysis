## Description
Trang `/deepseek` — **DeepSeek Agents**, nơi chạy các agent dùng model của DeepSeek. Hiện có 1 agent: **"Thị trường hôm nay"**, bấm nút **Analyze** thì hệ thống chụp số liệu 24h của thị trường crypto từ Binance rồi để DeepSeek viết bản tin tiếng Việt dựa trên đúng số liệu đó.

Nguyên tắc thiết kế quan trọng nhất: **model không tự lấy dữ liệu**. DeepSeek không có dữ liệu thị trường realtime và không duyệt web, nên bất kỳ con số nào không được đưa vào prompt là con số nó sẽ **bịa**. Vì vậy:
- `MarketSnapshotService` lo phần số liệu (Binance public REST), DeepSeek chỉ lo phần diễn giải.
- System prompt cấm bịa số/tin tức, và yêu cầu nói thẳng "dữ liệu không có" khi thiếu.
- API trả **cả bản tin lẫn snapshot**; UI hiển thị bảng số liệu ngay dưới bài viết để trader đối chiếu từng câu.

DeepSeek dùng API **tương thích OpenAI** (`POST /chat/completions`, bearer token), nên `deepseek.client.ts` cố tình giữ đúng hình dạng của `OpenAiChatProvider` sẵn có — khác biệt thật sự chỉ là host, tên model, và trường `reasoning_content` mà model reasoner trả thêm.

| Model (`DEEPSEEK_MODEL`) | Là gì | Ghi chú |
|---|---|---|
| `deepseek-v4-pro` (mặc định) | DeepSeek-V4-Pro-0813 | Bản GA 13/08/2026, mạnh nhất |
| `deepseek-v4-flash` | DeepSeek-V4-Flash-0731 | Nhanh và rẻ hơn, đủ cho việc viết bản tin từ dữ liệu có sẵn |

Hai tên cũ `deepseek-chat` / `deepseek-reasoner` (V3 / R1) đã bị khai tử 24/07/2026 — vai trò "suy luận trước khi trả lời" nay nằm ở thinking mode của chính V4. Client gửi `reasoning_effort` theo `DEEPSEEK_REASONING_EFFORT`, mặc định `high` (đúng mặc định của DeepSeek), đổi được sang `low` hoặc `max`. Phần model nghĩ trả về ở `reasoning_content` và hiện trong mục "Quá trình suy luận của model".

Hai điểm cần nhớ khi thinking đang bật: `temperature` / `top_p` / `presence_penalty` / `frequency_penalty` bị API bỏ qua (nhận nhưng không có tác dụng), nên `temperature: 0.3` trong client chỉ có ý nghĩa nếu sau này tắt thinking; và token nghĩ ăn chung ngân sách với câu trả lời, nên `max_tokens` để 8000 chứ không phải 2000.

## Main Flow
1. **SSR** — `/deepseek` gọi `fetchDeepseekStatus()` để biết đã có key chưa và model nào đang dùng. Lỗi API → rơi về `{ configured: false }` để trang vẫn render kèm hướng dẫn.
2. **Bấm Analyze** → `POST /deepseek/agents/market-today`.
3. **Chụp dữ liệu** (`MarketSnapshotService.build()`) — **một** call `/api/v3/ticker/24hr` (weight 80, ~1MB) lấy toàn bộ symbol, lọc còn cặp USDT hợp lệ, rồi rút ra 3 thứ từ cùng bộ dữ liệu đó:
   - **Coin vốn hoá lớn**: BTC, ETH, SOL, BNB, XRP, DOGE, ADA, AVAX, LINK, TON.
   - **Độ rộng thị trường**: số cặp tăng/giảm/đứng giá, tỷ lệ cặp tăng, tổng khối lượng 24h — con số phân biệt "BTC xanh và cả thị trường xanh" với "BTC xanh một mình".
   - **Top tăng/giảm 24h**: chỉ tính cặp có khối lượng ≥ `MIN_MOVER_VOLUME_USD`.
   Thêm 1 call daily-kline cho BTC và ETH để có biến động 7 ngày / 30 ngày.
4. **Dựng prompt** (`DeepseekService.buildPrompt`) — render snapshot thành text, kèm mốc thời gian chụp và ghi rõ nguồn là Binance spot.
5. **Gọi DeepSeek** — `temperature: 0.3` (đây là việc tóm tắt số liệu, không phải sáng tạo), `stream: false`, timeout 120s.
6. **Trả kết quả** — `{ analysis (markdown), reasoning, model, generatedAt, snapshot, usage }`.
7. **Render** — bản tin markdown ở trên; dưới là khối "Dữ liệu đã đưa cho model" gồm 4 ô thống kê (tỷ lệ cặp tăng, tổng khối lượng, BTC, ETH) và 3 bảng (vốn hoá lớn / tăng mạnh / giảm mạnh); cuối cùng là dòng meta model · giờ chụp dữ liệu · giờ trả lời · số token.

## Edge Cases
- **Chưa cấu hình `DEEPSEEK_API_KEY`**: `GET /deepseek/status` trả `configured: false`, nút Analyze bị disable và trang chỉ rõ cần thêm biến nào — thay vì để người dùng bấm rồi nhận lỗi. Nếu vẫn gọi thẳng API thì nhận 503 kèm câu tiếng Việt tương ứng.
- **Key đọc tại thời điểm gọi**, không phải lúc khởi tạo class — `pm2 restart --update-env` là đủ để nhận key mới, không cần đổi code. (Lưu ý cũ vẫn đúng: sửa `.env` suông thì pm2 KHÔNG nạp lại — xem `project_live_trading_kill_switch`.)
- **Lỗi từ DeepSeek được dịch sang câu hành động được**: 401 → key sai, 402 → hết số dư, 429 → bị giới hạn tần suất, còn lại lấy `error.message` gốc. Tất cả về 503 kèm message hiện thẳng trong panel đỏ.
- **Model trả về rỗng** (ví dụ bị cắt vì `max_tokens`): coi là lỗi và ném ra, vì panel trắng trơn khó hiểu hơn một thông báo lỗi. Log kèm `finish_reason`.
- **Binance lỗi**: call ticker là bắt buộc — hỏng thì 503 "Không lấy được dữ liệu thị trường", KHÔNG gọi DeepSeek (bản tin không có dữ liệu còn tệ hơn không có bản tin). Ngược lại, call daily-kline cho BTC/ETH là best-effort: hỏng thì 7d/30d hiện `—`, bản tin vẫn chạy với dữ liệu 24h.
- **Ngưỡng khối lượng của top mover**: cố ý để thấp ($2M). Đo thực tế trong một phiên yên tĩnh, ngưỡng $20M chỉ có 8 cặp lọt qua — kết quả là "top tăng" chứa ETH +0.06% còn BTC nằm trong "top giảm", tức là danh sách majors được sắp xếp lại chứ không phải coin biến động mạnh.
- **Tách theo chiều, không cắt đầu/cuối**: `topGainers` lọc `> 0`, `topLosers` lọc `< 0`. Nếu chỉ `slice(0,5)` và `slice(-5)` thì hôm nào ít cặp vượt ngưỡng, hai lát cắt sẽ chồng nhau và một coin bị báo vừa tăng mạnh nhất vừa giảm mạnh nhất.
- **Loại stablecoin, fiat và token đòn bẩy** khỏi cả độ rộng lẫn top mover: cặp USDT/USDC là chênh lệch peg, cặp USDT/EUR là tỷ giá, token `*UP`/`*DOWN`/`*BULL`/`*BEAR` biến động theo cơ chế đòn bẩy — không phải thông tin thị trường crypto.
- **Snapshot chỉ là Binance spot**, không phải toàn thị trường (không có vốn hoá tổng, dominance, funding, thanh lý, dòng tiền ETF, tin tức). Điều này được ghi thẳng vào system prompt để model không nói quá phạm vi dữ liệu.
- **Thời gian chờ**: gọi Binance rồi chờ model, thinking ở mức `high`/`max` có thể lâu — client timeout 120s, UI hiện dòng "có thể mất 10–60 giây" và disable nút trong lúc chạy.
- **Chưa chạy thật với key**: đường dữ liệu (Binance → snapshot → prompt) đã chạy thử end-to-end với dữ liệu thật. Key đã có trong `.env` và xác thực OK (17/08/2026), nhưng tài khoản DeepSeek **hết số dư** — API trả `Insufficient Balance` (402), nên **phần gọi model vẫn chưa được kiểm chứng**. Nạp tiền vào tài khoản là chạy được ngay, không cần đổi code.

## Related Files (FE / BE / Worker)
**Web**
- `apps/web/src/app/deepseek/page.tsx` — route `/deepseek` (re-export mỏng).
- `apps/web/src/_pages/deepseek-agents-page/deepseek-agents-page.tsx` — Server Component, SSR trạng thái cấu hình.
- `apps/web/src/widgets/deepseek/market-today-agent.tsx` — Client Component: nút Analyze, trạng thái loading/lỗi, bản tin markdown + bảng snapshot.
- `apps/web/src/shared/api/types.ts` — khối type `Deepseek*`.
- `apps/web/src/shared/api/client.ts` — `fetchDeepseekStatus()`, `runDeepseekMarketToday()` (ném đúng `message` của API để panel lỗi có nội dung).
- `apps/web/src/app/globals.css` — khối `.ds-*`.
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — mục "DeepSeek Agents".

**API**
- `apps/api/src/modules/deepseek/deepseek.client.ts` — client DeepSeek (OpenAI-compatible), đọc key lúc gọi, bóc `reasoning_content` + `usage`.
- `apps/api/src/modules/deepseek/market-snapshot.service.ts` — dựng snapshot thị trường từ Binance (majors, độ rộng, top mover, xu hướng 7d/30d).
- `apps/api/src/modules/deepseek/deepseek.service.ts` — system prompt, dựng prompt từ snapshot, gọi model, dịch lỗi sang tiếng Việt.
- `apps/api/src/modules/deepseek/deepseek.controller.ts` — `GET /deepseek/status`, `POST /deepseek/agents/market-today`.
- `apps/api/src/modules/deepseek/deepseek.module.ts`
- `apps/api/src/modules/market/binance-market-data.service.ts` — thêm `fetchTicker24h()` (lấy toàn bộ, lọc phía client — cùng lý do với `fetchCurrentPrices`: Binance 400 cả batch nếu `symbols=[...]` có mã không tồn tại).
- `apps/api/src/app.module.ts` — đăng ký `DeepseekModule`.

**Worker**
- Không dùng. Agent chạy theo yêu cầu từ UI, không có cron.

**Shared**
- `.env.example` — `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_API_BASE_URL`.
