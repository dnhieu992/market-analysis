# Chatbot Widget — AI Trading Assistant

## Tổng quan

Một floating chat widget tích hợp với trang `/trades`, cho phép trader hỏi tín hiệu vào lệnh, phân tích cặp coin theo khung thời gian, và review lịch sử giao dịch của mình — tất cả đều được trả lời bởi Claude AI với dữ liệu thời gian thực từ Binance.

---

## Kiến trúc

```
Browser (Next.js)                   API (NestJS)                   External
─────────────────                   ────────────────               ────────
ChatbotWidget (React)               ChatController
  ↓ POST /chat/conversations          ConversationService
  ↓ POST /conversations/:id/messages    ↓ buildSystemPrompt()       → DB (MySQL)
                                        ↓ claude.chatAgentLoop()    → Anthropic API
                                          ↓ toolRegistry             → Binance API
                                            get_klines
                                            get_ticker_price
                                            get_24h_ticker
```

---

## Files

### Backend (`apps/api/`)

| File | Mô tả |
|------|-------|
| `modules/chat/chat.controller.ts` | REST endpoints cho conversation CRUD + send message |
| `modules/chat/conversation.service.ts` | Logic chính: tạo/xoá conversation, gửi tin nhắn, build system prompt |
| `modules/chat/providers/claude-chat.provider.ts` | Gọi Anthropic API trực tiếp (raw fetch), xử lý agentic tool-use loop |
| `modules/chat/tools/binance.tool.ts` | 3 tools: `get_klines`, `get_ticker_price`, `get_24h_ticker` |
| `modules/chat/tools/trading-chat-tool-registry.ts` | Registry đăng ký tất cả Binance tools |
| `modules/chat/dto/create-conversation.dto.ts` | DTO tạo conversation |
| `modules/chat/dto/send-message.dto.ts` | DTO gửi tin nhắn |

### Database (`packages/db/`)

| File | Mô tả |
|------|-------|
| `prisma/schema.prisma` | Thêm model `Conversation` và `ConversationMessage` |
| `prisma/migrations/20260424083201_add_conversations/` | Migration SQL |
| `src/repositories/conversation.repository.ts` | Repository: CRUD conversations + messages |
| `src/index.ts` | Export `createConversationRepository` |

### Frontend (`apps/web/`)

| File | Mô tả |
|------|-------|
| `src/widgets/chatbot/chatbot-widget.tsx` | Toàn bộ UI widget (floating button + panel) |
| `src/widgets/trades-history/trades-history.tsx` | Mount `<ChatbotWidget />` vào trang /trades |
| `src/shared/api/client.ts` | API methods: listConversations, createConversation, deleteConversation, getMessages, sendMessage |
| `src/shared/api/types.ts` | Types: `Conversation`, `ChatMessage` |
| `src/app/globals.css` | CSS cho toàn bộ widget |

---

## API Endpoints

Tất cả endpoints đều yêu cầu authentication (session cookie).

```
GET    /chat/conversations              Lấy danh sách conversations của user
POST   /chat/conversations              Tạo conversation mới
DELETE /chat/conversations/:id          Xoá conversation (cascade xoá messages)
PATCH  /chat/conversations/:id/title    Đổi tiêu đề conversation
GET    /chat/conversations/:id/messages Lấy tất cả messages trong conversation
POST   /chat/conversations/:id/messages Gửi tin nhắn → nhận reply từ AI
```

### Request / Response

**POST `/chat/conversations`**
```json
// Body (optional)
{ "title": "Phân tích BTC" }

// Response
{ "id": "uuid", "userId": "...", "title": "Cuộc trò chuyện mới", "createdAt": "...", "updatedAt": "..." }
```

**POST `/chat/conversations/:id/messages`**
```json
// Body
{ "content": "Hãy phân tích BTCUSDT khung H1 và tìm điểm vào lệnh" }

// Response (assistant message saved to DB)
{
  "id": "uuid",
  "conversationId": "...",
  "role": "assistant",
  "content": "Dựa trên phân tích khung H1 của BTCUSDT...",
  "createdAt": "..."
}
```

---

## Database Schema

```prisma
model Conversation {
  id        String                @id @default(uuid())
  userId    String
  title     String                @db.VarChar(200)
  createdAt DateTime              @default(now())
  updatedAt DateTime              @updatedAt
  user      User                  @relation(...)
  messages  ConversationMessage[]
}

model ConversationMessage {
  id             String       @id @default(uuid())
  conversationId String
  role           String       // 'user' | 'assistant'
  content        String       @db.Text
  createdAt      DateTime     @default(now())
  conversation   Conversation @relation(...)
}
```

---

## Claude Integration

### Provider: `ClaudeChatProvider`

Gọi trực tiếp `https://api.anthropic.com/v1/messages` bằng raw fetch (không dùng SDK).

**Env vars cần thiết:**
```env
CLAUDE_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6   # full model ID, dùng trực tiếp
LLM_PROVIDER=claude
```

> `CLAUDE_MODEL` được đọc trực tiếp làm model ID (không map qua alias). Default fallback: `claude-sonnet-4-6`.

### Agentic Tool-Use Loop

Khi Claude cần dữ liệu thị trường, nó trả về `stop_reason: "tool_use"`. Server tự động:
1. Detect tool_use blocks trong response
2. Execute tool (gọi Binance API)
3. Gửi tool_result về Claude
4. Lặp tối đa **5 vòng** cho đến khi Claude trả về `stop_reason: "end_turn"`

```
User message → Claude
                ↓ stop_reason: tool_use
             Execute get_klines("BTCUSDT", "1h", 50)
                ↓ tool_result: [{t, o, h, l, c, v}...]
             Claude (with candle data)
                ↓ stop_reason: end_turn
             Final reply → Save to DB → Return to client
```

### System Prompt

Mỗi request tự động inject vào context:
- Thời gian hiện tại (GMT+7)
- Tổng trades đã đóng, win rate, profit factor
- Top 5 cặp giao dịch nhiều nhất
- 5 lệnh gần nhất (symbol, side, entry, close, PnL)
- Hướng dẫn sử dụng tools và format response

---

## Binance Tools

| Tool | Endpoint | Mô tả |
|------|----------|-------|
| `get_klines` | `GET /api/v3/klines` | OHLCV candles, tối đa 200 nến |
| `get_ticker_price` | `GET /api/v3/ticker/price` | Giá hiện tại |
| `get_24h_ticker` | `GET /api/v3/ticker/24hr` | Thống kê 24h (high/low/volume/%) |

Tất cả là **public endpoints**, không cần API key Binance.

**Intervals hợp lệ:** `1m 3m 5m 15m 30m 1h 2h 4h 6h 8h 12h 1d 3d 1w 1M`

---

## Frontend Widget

### Layout

```
┌─────────────────────────┐  ← top: 16px (full height)
│ [☰]  Conv title  [+][×] │  header
├─────────────────────────┤
│ ┌──────────┐            │
│ │ Lịch sử  │  messages  │  ← history drawer slide-in từ trái
│ │ Conv 1 ● │            │
│ │ Conv 2   │            │
│ └──────────┘            │
├─────────────────────────┤
│  [textarea]    [send]   │  ← bottom: 88px (trên FAB)
└─────────────────────────┘
```

### UX Flow

```
[FAB] → Click → [Panel full height]
  ├── [☰] Hamburger  → Drawer lịch sử slide-in từ trái
  │     ├── Click conv  → Load messages, đóng drawer, active highlight
  │     └── Click ✕     → Xoá conversation
  ├── [+]              → Tạo conversation mới
  ├── [×] top right    → Đóng panel
  └── Messages area    → Luôn hiển thị (không switching view)
        ├── Input + Enter   → Gửi (optimistic UI)
        ├── Typing indicator khi chờ AI
        └── @ trong input   → Dropdown chọn strategy
```

### Features

- **Full height**: Panel từ `top: 16px` đến `bottom: 88px` — tận dụng toàn bộ màn hình
- **Close button** (`×`) góc trên phải đóng panel
- **Hamburger** (`☰`) góc trên trái mở/đóng history drawer; click backdrop hoặc `Escape` để đóng
- **History drawer**: slide-in từ trái, conversation đang active có highlight xanh + border trái
- **@ mention strategy**: gõ `@` trong input → dropdown lọc danh sách strategies đã lưu; `↑↓` navigate, `Enter` chọn, `Escape` đóng
- **Auto-title**: Tiêu đề tự cập nhật từ 80 ký tự đầu của tin nhắn đầu tiên
- **Optimistic UI**: Tin nhắn user hiển thị ngay, không chờ server
- **Markdown rendering**: Bold, italic, code, heading, list được render đúng
- **Keyboard**: `Enter` gửi, `Shift+Enter` xuống dòng
- **Input disabled** khi chưa có conversation active

### Ví dụ câu hỏi

```
Phân tích BTCUSDT khung H1 và tìm điểm vào lệnh

@Sonic R phân tích BTCUSDT, vào lệnh M15 follow H1

Giá ETHUSDT hiện tại bao nhiêu?

Tôi hay thua ở cặp nào nhất?

SOLUSDT đang trong uptrend hay downtrend khung 4H?
```

---

## Kịch bản hoạt động

### Kịch bản 1: Phân tích kỹ thuật (cần real-time data)

> User: "Phân tích BTCUSDT khung H1, tìm điểm vào long"

1. Claude nhận câu hỏi
2. Claude gọi `get_klines("BTCUSDT", "1h", 100)` và `get_24h_ticker("BTCUSDT")`
3. Server fetch từ Binance, trả về 100 nến H1 + stats 24h
4. Claude phân tích: trend, S/R, momentum
5. Claude đưa ra: entry zone, stop loss, take profit, lý do

### Kịch bản 2: Review lịch sử giao dịch (chỉ dùng context)

> User: "Tôi hay thua ở cặp nào nhất?"

1. Claude đọc system prompt (đã có trade history inject sẵn)
2. Claude phân tích trực tiếp từ context, không cần gọi tool
3. Claude trả lời với thống kê cụ thể

### Kịch bản 3: Kết hợp

> User: "Tôi vừa thua 3 lệnh ETHUSDT liên tiếp, hiện tại ETH đang như thế nào?"

1. Claude đọc history (biết user hay trade ETH, đang thua)
2. Claude gọi `get_klines("ETHUSDT", "4h", 50)` + `get_ticker_price("ETHUSDT")`
3. Claude phân tích nguyên nhân thua (dựa trên giá entry/exit) + context thị trường hiện tại

---

## Giới hạn hiện tại

- **Max 5 tool calls/request** — nếu Claude cần nhiều hơn 5 lần gọi tool thì trả về message lỗi cứng
- **Conversation history không giới hạn** — load toàn bộ từ DB, conversation dài tốn nhiều token
- **Trade history cố định 200 orders** — inject vào mỗi request dù user không hỏi về lịch sử
- **Không có streaming** — user chờ toàn bộ response mới nhận được kết quả

---

## Mở rộng trong tương lai

| Feature | Mô tả |
|---------|-------|
| **Streaming** | SSE để stream từng token thay vì chờ full response |
| **get_strategy tool** | Claude tự fetch strategy từ DB khi user mention `@name` |
| **More tools** | Fear & Greed index, on-chain data, funding rate |
| **Image upload** | Gửi chart screenshot để Claude phân tích |
| **Alert bot** | Claude chủ động notify khi signal match điều kiện |
| **Export** | Export conversation thành PDF/Markdown |
