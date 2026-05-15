# Plan: Portfolio Coin AI Chat

## Mục tiêu
Thêm nút "Ask AI" vào trang chi tiết coin trong portfolio. Khi click, một drawer trượt từ phải mở ra với chatbot đã được pre-load context về coin đó (holdings, giao dịch, P&L). Người dùng có thể hỏi thêm bất cứ điều gì về coin.

---

## Tasks

### Task 1 — DB: Thêm cột `metadata` vào bảng `Conversation`

- [x] Thêm `metadata Json?` vào `Conversation` model trong `packages/db/prisma/schema.prisma`
- [x] Tạo migration file `packages/db/prisma/migrations/20260515000000_add_conversation_metadata/migration.sql`
  ```sql
  ALTER TABLE `conversations` ADD COLUMN `metadata` JSON NULL;
  ```
- [x] Update `packages/db/src/repositories/conversation.repository.ts` — hàm `create()` nhận thêm tham số `metadata?: Record<string, unknown>`
- [x] Chạy `pnpm prisma:generate` để regenerate Prisma client

---

### Task 2 — Backend: Mở rộng createConversation để nhận coin context

- [x] Update `apps/api/src/modules/chat/dto/create-conversation.dto.ts` — thêm `coinId?: string` và `portfolioId?: string`
- [x] Update `apps/api/src/modules/chat/chat.controller.ts` — truyền `coinId`/`portfolioId` xuống service
- [x] Update `apps/api/src/modules/chat/conversation.service.ts`:
  - [x] `createConversation()` — lưu `{ coinId, portfolioId }` vào `metadata` khi được cung cấp
  - [x] Inject `HOLDING_REPOSITORY` + `COIN_TRANSACTION_REPOSITORY` (đã có sẵn qua `DatabaseModule`)
  - [x] `buildSystemPrompt()` — khi conversation metadata có `coinId`+`portfolioId`, fetch holding + 10 giao dịch gần nhất và inject vào đầu system prompt

  **System prompt coin block:**
  ```
  === Portfolio Context: BTC ===
  Holdings: 0.45 BTC | Avg buy price: $58,200 | Total invested: $26,190
  Realized P&L: $0

  Recent transactions (last 10):
    - BUY 0.2 BTC @ $55,000 on Jan 15, 2026
    - BUY 0.25 BTC @ $61,000 on Mar 3, 2026
  ===========================
  ```

---

### Task 3 — Frontend: Update API client

- [x] Update `apps/web/src/shared/api/client.ts` — hàm `createConversation()` nhận thêm `coinId?` và `portfolioId?`, include trong JSON body

---

### Task 4 — Frontend: Build component `CoinChatDrawer`

- [x] Tạo file `apps/web/src/widgets/coin-chat-drawer/coin-chat-drawer.tsx`
  - Props: `coinId`, `portfolioId`, `holding`, `currentPrice`, `onClose`
  - On mount: check `localStorage` key `coin-chat:${portfolioId}:${coinId}` để reuse conversation cũ, hoặc tạo mới rồi lưu ID
  - Drawer cố định bên phải (~420px), full chiều cao, z-index cao
  - Header: tên coin + nút đóng + unrealized P&L
  - Message list: scrollable, bubble user/assistant
  - Typing indicator khi đang chờ response
  - Input textarea dưới cùng (Enter gửi, Shift+Enter xuống dòng)
  - Markdown cơ bản cho reply của assistant (tái dụng regex từ `skill-chat-client.tsx`)

---

### Task 5 — Frontend: Gắn button vào coin detail widget

- [x] Update `apps/web/src/widgets/portfolio-coin-detail/portfolio-coin-detail.tsx`
  - Thêm state `askOpen`
  - Thêm nút "Ask AI" cạnh nút "+ Add Transaction" trong header row
  - Render `<CoinChatDrawer>` khi `askOpen === true`

---

### Task 6 — Docs: Tạo feature doc

- [x] Tạo `docs/features/portfolio-coin-chat/portfolio-coin-chat.md` theo chuẩn format của dự án

---

### Task 7 — Verify

- [x] `pnpm prisma:generate` — không có lỗi
- [x] `pnpm typecheck` — pass
- [x] `pnpm test` — pass (17/17, lỗi `@app/skills` là pre-existing)
- [ ] Manual test:
  - Vào trang coin detail → click "Ask AI" → drawer mở
  - Hỏi "What's my BTC position?" → AI trả lời với dữ liệu holdings thực tế
  - Đóng và mở lại drawer → conversation cũ được load lại
