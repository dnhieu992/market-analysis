## Description
Thêm nút "Ask AI" vào trang chi tiết coin trong portfolio. Khi click, một drawer trượt từ phải mở ra với AI chatbot đã được pre-load context về coin đó (holdings, giao dịch, P&L). Người dùng có thể hỏi câu hỏi về vị thế coin, phân tích kỹ thuật, hay bất cứ thông tin nào liên quan.

## Main Flow
1. User vào `/portfolio/[id]/[coinId]` — trang coin detail.
2. Click nút **Ask AI** ở header (cạnh "+ Add Transaction").
3. Frontend kiểm tra `localStorage` key `coin-chat:<portfolioId>:<coinId>`:
   - Nếu có conversation ID cũ → load lại message history từ API.
   - Nếu không → gọi `POST /chat/conversations` với `{ coinId, portfolioId }` → lưu conversation ID vào localStorage.
4. Drawer hiện ra ở bên phải màn hình, hiển thị lịch sử chat (nếu có).
5. User gõ câu hỏi, Enter → gọi `POST /chat/conversations/:id/messages`.
6. Backend build system prompt kèm coin context (holdings, 10 giao dịch gần nhất) rồi gọi Claude.
7. Claude trả lời; response hiển thị dưới dạng bubble với markdown rendering.
8. User click nút ✕ hoặc backdrop để đóng drawer.

## Edge Cases
- Conversation cũ bị xóa trên server → localStorage trỏ đến ID không tồn tại → xóa cache, tạo conversation mới.
- Coin chưa có holdings → `buildCoinContext` trả về chuỗi rỗng → system prompt chỉ có context trading chung.
- Lỗi khi gửi tin → optimistic message bị xóa khỏi list, user thấy input không đổi để thử lại.
- Drawer đóng khi click backdrop (overlay đen phía sau).

## Swing PA System Prompt (cập nhật)
Khi `coinId` có trong conversation metadata, `buildSystemPrompt()` tạo prompt chuyên biệt thay vì prompt chung:
- **Framework**: Swing PA thuần price action (HH/HL structure, CHoCH, S/R zones từ weekly, Fibonacci 0.382/0.5/0.618)
- **Mục tiêu chính**: tìm điểm DCA và vùng chốt lời, không phải trading chung
- **Bắt buộc dùng tool**: Claude phải gọi `analyze_market_structure` trước rồi mới phân tích
- **Định dạng output cố định**: Xu hướng → DCA table (ưu tiên + RR) → TP1/TP2/TP3 → Invalidation → Nhận xét vị thế
- **Ràng buộc R:R**: chỉ đề xuất DCA khi R:R ≥ 2:1; chỉ DCA theo chiều weekly trend

## Related Files (FE / BE / Worker)

### Frontend
- `apps/web/src/widgets/coin-chat-drawer/coin-chat-drawer.tsx` — drawer component với chat UI
- `apps/web/src/widgets/portfolio-coin-detail/portfolio-coin-detail.tsx` — thêm "Ask AI" button và mount drawer
- `apps/web/src/shared/api/client.ts` — `createConversation()` nhận thêm `coinId` và `portfolioId`

### Backend (API)
- `apps/api/src/modules/chat/dto/create-conversation.dto.ts` — thêm field `coinId` và `portfolioId`
- `apps/api/src/modules/chat/chat.controller.ts` — pass `coinId`/`portfolioId` xuống service
- `apps/api/src/modules/chat/conversation.service.ts` — `createConversation()` lưu metadata; `buildCoinContext()` fetch holdings+transactions; `buildSystemPrompt()` inject coin context

### Database
- `packages/db/prisma/schema.prisma` — thêm field `metadata Json?` vào model `Conversation`
- `packages/db/prisma/migrations/20260515000000_add_conversation_metadata/migration.sql` — migration
- `packages/db/src/repositories/conversation.repository.ts` — `create()` nhận thêm `metadata`
