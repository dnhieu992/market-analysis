# Crypto Skills Chatbot — Plan & Design Document

## 📋 Tổng quan

Build một web application cho phép user tương tác với **các skill phân tích crypto chuyên biệt**. User chọn skill từ list cards → mở chatbot tương ứng → hỏi về coin → AI tự fetch data, calculate metrics, phân tích và trả lời.

---

## 🎯 Mục tiêu chính

- Cung cấp interface trực quan để user tiếp cận các analysis skills
- Mỗi skill = 1 chuyên gia AI với knowledge cụ thể (price action, breakout, DCA, etc.)
- User trải nghiệm tự nhiên: "click skill → chat → nhận phân tích"
- AI tự động fetch data và compute metrics khi cần (không cần user paste data)
- Lưu conversation history để user có thể quay lại đọc

---

## 👥 User Personas

### Persona 1: Nhà đầu tư cá nhân
- Có 50-500 triệu vốn
- Không có thời gian học sâu phân tích kỹ thuật
- Muốn nhận phân tích chuyên gia trước khi quyết định mua/bán
- **Use case chính:** Hỏi nhanh về 1 coin trước khi DCA/swing

### Persona 2: Swing trader bán chuyên
- Có kinh nghiệm cơ bản về TA
- Muốn second opinion từ AI
- Cần tốc độ và độ chính xác
- **Use case chính:** Phân tích nhanh setup breakout, validate ý tưởng

### Persona 3: Người mới học crypto
- Đang trong giai đoạn học hỏi
- Chưa hiểu rõ chiến lược
- Muốn AI giải thích và hướng dẫn
- **Use case chính:** Học hỏi qua phân tích, hỏi "tại sao"

---

## 🗺️ Application Map

```
┌─────────────────────────────────────────┐
│  HOME (/)                               │
│  Skills List Page                       │
│  - Card grid layout                     │
│  - Filter by category                   │
│  - Search skills                        │
└─────────────────────────────────────────┘
              ↓ Click card
┌─────────────────────────────────────────┐
│  SKILL DETAIL (/skills/:id)             │
│  - Skill description                    │
│  - Capabilities list                    │
│  - Example questions                    │
│  - "Start chat" button                  │
│  (Optional - có thể skip vào chat luôn) │
└─────────────────────────────────────────┘
              ↓ Click start
┌─────────────────────────────────────────┐
│  CHAT (/skills/:id/chat/:sessionId)     │
│  - Skill context indicator              │
│  - Welcome message                      │
│  - Suggested questions                  │
│  - Chat input                           │
│  - Conversation display                 │
│  - History sidebar                      │
└─────────────────────────────────────────┘
              ↕
┌─────────────────────────────────────────┐
│  HISTORY (/history)                     │
│  - List all past conversations          │
│  - Group by skill                       │
│  - Search history                       │
│  - Click → resume chat                  │
└─────────────────────────────────────────┘
```

---

## 📄 Page Specifications

### Page 1: Skills List (Home)

**URL:** `/`

**Mục đích:** Show all available skills as cards, để user discover và chọn.

**Layout components:**

| Component | Description |
|---|---|
| Header | Logo, navigation (Home, History, Settings) |
| Hero section | Title "Crypto Analysis Skills" + tagline |
| Filter bar | Category tabs (All / Trading / Investing / Research / Education) |
| Search input | Search skills by name/keyword |
| Skills grid | Responsive grid 3-4 cols desktop, 2 cols tablet, 1 col mobile |
| Footer | Disclaimer, links |

**Skill card content:**

```
┌──────────────────────────┐
│  [Icon]                  │
│                          │
│  Skill Name              │
│  Category badge          │
│                          │
│  Short description       │
│  (1-2 sentences)         │
│                          │
│  [Use Skill] button      │
└──────────────────────────┘
```

**Card states:**
- Default: clean, minimal
- Hover: slight elevation, button highlights
- Active/Recently used: subtle indicator

**User actions:**
- Click card body → Go to skill detail page
- Click "Use Skill" button → Skip to chat (create new session)
- Filter by category → Update grid
- Search → Filter cards real-time

---

### Page 2: Skill Detail (Optional)

**URL:** `/skills/:id`

**Mục đích:** Educate user về skill trước khi chat. Build trust và set expectation.

**Có thể skip page này** nếu muốn UX nhanh hơn (click card → vào chat luôn).

**Sections:**

1. **Hero**
   - Skill icon (large)
   - Skill name
   - Category
   - Brief description

2. **What this skill can do**
   - Bullet list of capabilities
   - Example: "Phân tích trend đa khung thời gian", "Xác định patterns", etc.

3. **Example questions**
   - 4-6 ví dụ user có thể hỏi
   - Click vào example → Auto-fill khi vào chat

4. **What you'll get**
   - Sample output preview
   - Show structure của analysis result

5. **Tips for best results**
   - Cách hỏi để nhận phân tích tốt nhất
   - VD: "Cung cấp tên coin chính xác (e.g., BTC, BTCUSDT)"

6. **CTA button:** "Start Analysis" → Create session, go to chat

---

### Page 3: Chat Interface

**URL:** `/skills/:id/chat/:sessionId`

**Mục đích:** Main interaction surface. User chat với AI để nhận phân tích.

**Layout:** 2-column desktop, single column mobile

**Left sidebar (collapsible):**
- "← Back to Skills" link
- Current skill indicator (icon + name)
- "New conversation" button
- Recent conversations list (this skill)
- Each item: timestamp + first user message preview

**Main chat area:**

```
┌────────────────────────────────────────┐
│  Chat Header                           │
│  [Skill icon] Skill Name | New chat   │
├────────────────────────────────────────┤
│                                        │
│  Welcome message (system)              │
│  "Hi! I'm Price Action Analyst..."     │
│                                        │
│  Suggested actions:                    │
│  [📊 Analyze BTC] [🎯 Find SOL setup]  │
│                                        │
│  ─────────────────────────────────     │
│                                        │
│  User message                          │
│  "Phân tích BTC ở khung daily"         │
│                                        │
│  AI thinking indicator                 │
│  "Đang fetch data BTC..."              │
│  "Đang tính swing points..."           │
│  "Đang phân tích pattern..."           │
│                                        │
│  AI response                           │
│  [Full analysis with formatting]       │
│                                        │
│  [👍 Helpful] [👎 Not helpful] [🔄]    │
│                                        │
├────────────────────────────────────────┤
│  Input area                            │
│  ┌────────────────────────┐  ┌──────┐  │
│  │ Ask about a coin...    │  │ Send │  │
│  └────────────────────────┘  └──────┘  │
└────────────────────────────────────────┘
```

**Components in detail:**

**Welcome message:**
- Tự động hiển thị khi vào chat
- Customized per skill
- Bao gồm hint cách hỏi tốt nhất

**Suggested actions:**
- 3-4 quick action buttons khi mới vào
- Click → auto-send predefined message
- Disappear sau khi user gửi message đầu tiên

**Thinking/Processing indicator:**
- Show progress khi AI đang process
- Steps visible cho user (fetch data → calculate → analyze)
- Tăng trust và transparency
- Animated typing indicator khi AI đang generate response

**Message bubbles:**
- User messages: right-aligned, primary color background
- AI messages: left-aligned, white/neutral background
- Timestamps on hover
- Copy button on AI messages

**AI response formatting:**
- Markdown rendering (bold, lists, tables)
- Code blocks for data
- Charts/data tables when relevant
- Collapsible sections for long responses

**Message actions:**
- Copy message content
- Regenerate response
- Thumbs up/down feedback (cải thiện skill sau này)

**Input area:**
- Multi-line textarea
- Enter to send, Shift+Enter for new line
- Character/token counter (optional)
- Disabled state while AI responding
- Cancel button khi AI đang generate

---

### Page 4: Conversation History

**URL:** `/history`

**Mục đích:** User xem lại các cuộc trò chuyện trước.

**Layout:**

**Filters:**
- By skill (dropdown)
- By date (today / week / month / all)
- Search by content

**List view:**
- Each conversation as a row
- Show: skill icon, first user message, timestamp, message count
- Click → open chat to read/continue

**Bulk actions:**
- Delete selected
- Export (optional)

---

## 🤖 Skills Catalog (Initial Set)

Chia thành 4 categories, tổng 8-10 skills MVP:

### Category 1: Trading (Active)

#### Skill 1.1: Price Action Analyst
- **Icon:** 📊
- **Name:** Price Action Analysis
- **Description:** Phân tích chart đa khung thời gian, nhận diện pattern, S/R, market structure
- **Required data:** W (150), D (365), 4H (360) candles
- **Calculations:** Swings, trend, key levels, Fibonacci
- **Output style:** Comprehensive multi-TF analysis
- **Example questions:**
  - "Phân tích BTC ở khung daily"
  - "SOL có pattern gì không?"
  - "Đánh giá market structure của ETH"

#### Skill 1.2: Breakout Hunter
- **Icon:** 🎯
- **Name:** Breakout Trading
- **Description:** Tìm setup breakout chất lượng cao, đánh giá volume confirmation
- **Required data:** D (365), 4H (360) candles
- **Calculations:** Pattern detection, volume analysis, ATR
- **Output style:** Trade setup với entry/SL/TP cụ thể
- **Example questions:**
  - "Tìm setup breakout cho SOL"
  - "ADA có sắp breakout không?"
  - "Đánh giá chất lượng breakout của ETH gần đây"

#### Skill 1.3: Swing Trader
- **Icon:** 📈
- **Name:** Swing Trading Setup
- **Description:** Tìm setup swing trade dựa trên pullback, retest, S/R
- **Required data:** W (150), D (365), 4H (360) candles
- **Calculations:** Swings, S/R, Fibonacci, trend
- **Output style:** Multiple setup options với R:R
- **Example questions:**
  - "Setup swing cho BNB"
  - "AVAX có entry tốt không?"
  - "Plan swing trade cho LINK 2-4 tuần"

### Category 2: Investing (Long-term)

#### Skill 2.1: DCA Planner
- **Icon:** 💰
- **Name:** DCA Strategy
- **Description:** Lập kế hoạch DCA dài hạn, xác định vùng tích lũy
- **Required data:** W (150), D (365) candles
- **Calculations:** Major S/R, historical lows, valuation zones
- **Output style:** DCA zones với % allocation
- **Example questions:**
  - "DCA ADA dài hạn thế nào"
  - "Vùng giá nào nên tích lũy ETH?"
  - "Plan DCA $1000/tháng cho BTC"

#### Skill 2.2: Portfolio Allocator
- **Icon:** 🛡️
- **Name:** Portfolio Allocation
- **Description:** Tư vấn phân bổ danh mục theo risk profile
- **Required data:** W candles của BTC, ETH, top alts
- **Calculations:** Correlation, volatility, drawdown
- **Output style:** Allocation table với reasoning
- **Example questions:**
  - "Phân bổ $100M VND cho crypto thế nào?"
  - "Portfolio cho người risk-averse"
  - "Đánh giá portfolio hiện tại của tôi"

### Category 3: Research

#### Skill 3.1: Market Regime Analyst
- **Icon:** 🌡️
- **Name:** Market Regime
- **Description:** Đánh giá tình trạng thị trường tổng thể (bull/bear/transition)
- **Required data:** W (200), D (365) candles của BTC + dominance
- **Calculations:** Trend strength, correlation, market cycle position
- **Output style:** Market overview + recommendations
- **Example questions:**
  - "Thị trường crypto đang ở giai đoạn nào?"
  - "Có nên all-in lúc này?"
  - "Altseason đến chưa?"

#### Skill 3.2: Coin Comparator
- **Icon:** ⚖️
- **Name:** Coin Comparison
- **Description:** So sánh 2-3 coin để chọn coin tốt hơn
- **Required data:** W, D candles cho mỗi coin
- **Calculations:** Performance, momentum, structure, volume
- **Output style:** Side-by-side comparison
- **Example questions:**
  - "So sánh SOL vs AVAX"
  - "BNB hay MATIC tốt hơn để hold?"
  - "ETH vs ADA cho dài hạn"

### Category 4: Education

#### Skill 4.1: Pattern Teacher
- **Icon:** 🎓
- **Name:** Learn Chart Patterns
- **Description:** Giải thích pattern qua coin thực tế
- **Required data:** D candles theo yêu cầu
- **Calculations:** Pattern detection để minh họa
- **Output style:** Educational, step-by-step
- **Example questions:**
  - "Giải thích ascending triangle qua BTC"
  - "Bull flag là gì? Show ví dụ"
  - "Cách nhận diện double bottom"

#### Skill 4.2: Risk Management Coach
- **Icon:** ⚠️
- **Name:** Risk Management
- **Description:** Tư vấn quản lý rủi ro, position sizing, SL/TP
- **Required data:** D candles, ATR
- **Calculations:** ATR-based SL, position size formulas
- **Output style:** Educational + practical numbers
- **Example questions:**
  - "Tính position size cho lệnh BTC vốn $1000"
  - "SL ở đâu cho setup này?"
  - "Quản lý rủi ro cho swing trader mới"

---

## 🔄 Core User Flows

### Flow 1: First-time user — Discovery

```
1. User truy cập home page
2. Browse skill cards
3. Read short descriptions
4. Click vào skill quan tâm (e.g., "Price Action Analysis")
5. Đọc skill detail page (capabilities, examples)
6. Click "Start Analysis"
7. → Vào chat với welcome message
8. Click suggested action OR type câu hỏi
9. Nhận response
10. Tiếp tục conversation hoặc start new
```

### Flow 2: Returning user — Quick analysis

```
1. User truy cập home
2. Click "Use Skill" trên card đã dùng trước
3. → Vào chat ngay (skip detail page)
4. Hỏi câu hỏi cụ thể
5. Nhận response
6. Done
```

### Flow 3: Power user — Multi-coin analysis

```
1. User vào chat skill "Price Action"
2. Hỏi: "Phân tích BTC"
3. Nhận response
4. Hỏi tiếp: "Còn ETH thì sao?"
   → AI hiểu context, phân tích ETH với cùng framework
5. Hỏi: "So sánh 2 coin này"
   → AI tổng hợp từ 2 phân tích trước
6. End conversation
```

### Flow 4: User muốn deep dive

```
1. User vào chat "Breakout Hunter"
2. Hỏi: "SOL có setup breakout không?"
3. AI fetch data → calculate → respond
4. AI: "Có ascending triangle..."
5. User hỏi follow-up: "Volume confirmation thế nào?"
   → AI giải thích chi tiết về volume
6. User: "Vậy SL nên đặt ở đâu?"
   → AI tính ATR, đề xuất SL với reasoning
7. User: "OK lưu lại, tôi sẽ xem lại"
8. → Conversation auto-saved trong history
```

### Flow 5: User return resume

```
1. User vào History page
2. Tìm conversation cũ về SOL
3. Click → mở lại chat
4. Đọc lại context
5. Hỏi tiếp: "Sau 3 ngày, SOL có còn setup tốt không?"
   → AI fetch data MỚI, compare với phân tích cũ
6. Continue conversation
```

---

## 🎬 Detailed Use Cases

### Use Case 1: New user analyzes a coin for the first time

**Actor:** Persona 1 (Nhà đầu tư cá nhân)

**Goal:** Hiểu BTC đang ở vị thế kỹ thuật thế nào trước khi mua

**Preconditions:** User đã vào website lần đầu

**Steps:**

1. User landing on home page
2. System displays 8 skill cards
3. User reads card "Price Action Analysis"
4. User clicks card
5. System navigates to skill detail page
6. User reads about capabilities and examples
7. User clicks "Start Analysis"
8. System creates new chat session, navigates to chat
9. System displays welcome message: "Hi! Tôi là Price Action Analyst. Bạn muốn phân tích coin nào?"
10. System shows suggested actions: [Analyze BTC] [Analyze ETH] [Analyze SOL]
11. User clicks [Analyze BTC]
12. System auto-fills "Phân tích BTC" và sends
13. System shows thinking indicator: "Đang fetch data BTC..."
14. System fetches W/D/4H candles từ Binance
15. System shows: "Đang tính metrics..."
16. System runs swing detection, trend, S/R, fib calculations
17. System shows: "Đang phân tích..."
18. System sends data + prompt to Claude API
19. System receives response, formats markdown
20. System displays response với formatting đẹp
21. User reads analysis
22. User asks follow-up: "Vậy giờ tôi nên DCA hay chờ?"
23. AI responds với context của analysis trước

**Postconditions:**
- Conversation saved trong history
- User có insight về BTC
- User biết workflow của system

**Alternative flows:**

- 11a. User type custom question instead of clicking suggestion
- 18a. AI quyết định không cần thêm data, trả lời từ context có sẵn
- 19a. API error → System retry, hiển thị error message friendly nếu fail

---

### Use Case 2: Detecting required data dynamically

**Actor:** AI System (internal flow)

**Goal:** Skill hiểu cần fetch data gì dựa trên user question

**Trigger:** User gửi message trong chat

**Steps:**

1. System receives user message: "Phân tích BTC daily"
2. System identifies current skill: "Price Action Analysis"
3. System checks skill's required data needs:
   - Default required: W, D, 4H
   - User specified: "daily" → emphasize D
4. System builds AI request with:
   - System prompt of skill
   - Tools available (fetch_candles, calculate_metrics)
   - User message
   - Conversation history
5. AI receives request
6. AI reasoning: "Need BTC W/D/4H data to do proper analysis"
7. AI calls tool: fetch_candles(symbol="BTC", interval="1w", limit=150)
8. System executes tool, returns candle data
9. AI calls tool: fetch_candles(symbol="BTC", interval="1d", limit=365)
10. System executes, returns data
11. AI calls tool: fetch_candles(symbol="BTC", interval="4h", limit=360)
12. System executes, returns data
13. AI calls tool: calculate_all_metrics(candles)
14. System computes: swings, trend, S/R, fib, volume, ATR
15. System returns metrics
16. AI synthesizes analysis based on data + metrics
17. AI returns formatted response
18. System displays to user

**Postconditions:**
- AI has all data needed
- User sees comprehensive analysis
- Tool calls visible (optional) for transparency

**Notes:**
- Different skills declare different required timeframes
- AI có thể skip fetching nếu user provide data trực tiếp
- AI có thể fetch thêm data ngoài default nếu user hỏi sâu

---

### Use Case 3: Conversation context maintained

**Actor:** User trong existing chat session

**Goal:** Hỏi follow-up questions mà không cần repeat context

**Preconditions:** User đã có 1-2 messages trong chat

**Steps:**

1. User trong chat "Breakout Hunter"
2. Previous: User đã hỏi "Tìm setup SOL", AI đã phân tích và đưa ra setup
3. User hỏi: "Vậy entry an toàn nhất là gì?"
4. System sends to AI:
   - Skill system prompt
   - Full conversation history (user msg + AI response trước đó)
   - New user message
5. AI reads context, hiểu rằng "entry an toàn nhất" refer đến setup SOL trước đó
6. AI có thể không cần fetch data lại (đã có trong context)
7. AI responds: "Trong 3 setup của SOL, conservative retest entry là an toàn nhất với R:R 1:3..."
8. User hỏi tiếp: "Còn ETH với cùng strategy thì sao?"
9. AI hiểu user muốn áp dụng cùng analysis framework cho ETH
10. AI calls tools để fetch ETH data
11. AI phân tích ETH, return response
12. Conversation continues

**Postconditions:**
- AI maintain context throughout conversation
- User không cần repeat
- Natural conversation flow

---

### Use Case 4: Resume previous conversation

**Actor:** Persona 2 (Swing trader)

**Goal:** Quay lại conversation cũ về SOL để continue analysis

**Preconditions:** User đã có conversation 3 ngày trước về SOL

**Steps:**

1. User truy cập website
2. User click "History" trong navigation
3. System displays list of past conversations
4. User filter by skill "Breakout Hunter"
5. User search "SOL"
6. System filters list, shows conversation từ 3 ngày trước
7. User clicks vào conversation
8. System navigates to chat URL với existing sessionId
9. System loads conversation history
10. System displays all previous messages
11. User scroll up đọc lại analysis cũ
12. User scroll xuống input area
13. User hỏi: "Sau 3 ngày SOL có thay đổi gì không?"
14. AI receives với full history
15. AI fetch data SOL MỚI
16. AI compare với analysis cũ trong context
17. AI responds với "what's changed" analysis
18. User continues

**Postconditions:**
- User có continuity giữa các session
- AI có thể compare time-based analysis

---

### Use Case 5: User chuyển skill giữa chừng

**Actor:** User active in chat

**Goal:** Chuyển từ Price Action sang DCA Strategy cho cùng coin

**Preconditions:** User đang chat skill "Price Action" về SOL

**Steps:**

1. User trong chat "Price Action - SOL analysis"
2. User hỏi: "OK còn DCA SOL dài hạn thì sao?"
3. AI nhận ra question vượt scope của skill hiện tại
4. AI responds: "Câu hỏi DCA tốt nhất với skill DCA Planner. Bạn muốn switch không?"
5. AI hiển thị suggestion button: [Switch to DCA Planner]
6. User clicks suggestion
7. System creates new chat session với skill "DCA Planner"
8. System auto-fills user message: "DCA strategy cho SOL"
9. System sends, AI processes
10. AI fetch SOL data với perspective của DCA
11. AI returns DCA-focused analysis
12. User now in DCA conversation
13. Original Price Action conversation vẫn được lưu

**Alternative flow:**

- 4a. AI có thể trả lời nhẹ trong skill hiện tại + suggest switch
- 6a. User decline switch, AI cố gắng trả lời với scope của skill hiện tại

**Postconditions:**
- User has separate conversations cho mỗi skill
- Both conversations saved
- Clear context per skill

---

### Use Case 6: Error handling — Invalid coin

**Actor:** User

**Goal:** System handle gracefully khi user nhập coin không tồn tại

**Steps:**

1. User trong chat "Price Action"
2. User hỏi: "Phân tích XYZNOTREAL"
3. AI hiểu user muốn analyze, calls tool fetch_candles
4. Tool returns error: "Symbol not found on Binance"
5. AI receives tool error
6. AI responds graceful: "Tôi không tìm thấy coin XYZNOTREAL trên Binance. Bạn có thể kiểm tra lại tên hoặc dùng symbol khác như BTCUSDT, ETHUSDT?"
7. AI suggest popular coins
8. User type lại với correct symbol
9. AI proceeds with analysis

**Alternative errors:**

- API rate limit → AI báo "đang busy, thử lại trong 1 phút"
- Network error → AI retry 2-3 lần trước khi báo lỗi
- Invalid response → AI report internal error, ask user retry

---

### Use Case 7: Browse and compare skills

**Actor:** Persona 3 (New learner)

**Goal:** Hiểu các skill khác nhau để chọn đúng skill cho nhu cầu

**Steps:**

1. User vào home page
2. Browse all 8 skills
3. User filter by category "Education"
4. System shows 2 education skills
5. User click "Pattern Teacher" detail
6. Read about it, click back
7. User click "Risk Management Coach"
8. Read about it
9. User decide cả 2 đều cần
10. User start with "Pattern Teacher" first
11. After learning patterns, user vào "Risk Management Coach"
12. Each conversation is independent but related

---

## 🧠 AI Behavior Rules

### Rule 1: Skill scope adherence

- AI luôn ở trong scope của skill đang chọn
- Nếu user hỏi off-topic, AI politely steer back hoặc suggest skill phù hợp
- Không trả lời generic crypto questions không liên quan đến skill

### Rule 2: Data fetching transparency

- Khi cần data, AI announce trước: "Để analyze, tôi cần fetch data BTC..."
- Show progress khi đang fetch/calculate
- User biết AI đang làm gì, không phải "magic black box"

### Rule 3: Confidence calibration

- AI phải honest về uncertainty
- Không over-confident về predictions
- Luôn note "không phải lời khuyên tài chính"
- Risk factors luôn được mention

### Rule 4: Context maintenance

- AI nhớ conversation history trong session
- Refer back to previous analysis khi relevant
- Không làm user repeat thông tin

### Rule 5: Output structure

- Mỗi skill có output style riêng
- Consistent formatting trong cùng skill
- Use markdown for readability
- Tables, lists, sections rõ ràng

### Rule 6: Educational tone

- Giải thích "tại sao", không chỉ "cái gì"
- User mới có thể học từ analysis
- Define jargon khi dùng lần đầu

---

## 💾 Data & State Management

### Conversation Data Structure

**Conversation:**
- ID (unique)
- Skill ID (which skill được dùng)
- Created at
- Updated at
- Title (auto-generated từ first message)
- Messages array

**Message:**
- ID
- Role (user / assistant / system)
- Content
- Timestamp
- Optional: tool_calls (nếu AI dùng tools)
- Optional: metadata (token usage, model used)

### Storage Strategy

**Phase 1 (MVP):**
- Local storage (browser) cho conversation history
- No backend persistence
- User mất history nếu clear browser

**Phase 2 (sau):**
- Backend database
- User auth (optional - guest mode + signed-in mode)
- Cross-device sync

### Session Lifecycle

1. **Create:** Khi user start new chat
2. **Active:** User actively chat
3. **Idle:** User không chat trong 30 phút
4. **Saved:** User leave page, conversation persisted
5. **Resumable:** User có thể quay lại bất kỳ lúc nào

---

## 🎨 UI/UX Principles

### Principle 1: Clarity over cleverness
- User hiểu ngay skill làm gì
- Không cần tutorial dài
- Self-explanatory cards và buttons

### Principle 2: Speed perception
- Show loading states immediately
- Progress indicators cho long operations
- Optimistic UI khi possible

### Principle 3: Conversation feel natural
- Như chat với chuyên gia thực sự
- Không quá formal
- Không quá casual cho serious analysis

### Principle 4: Mobile-first
- Đa số crypto users dùng mobile
- Responsive design ưu tiên
- Touch-friendly cards và buttons

### Principle 5: Trust through transparency
- Show AI's process (fetching data, calculating)
- Always include disclaimers
- No fake confidence

---

## 🚦 Edge Cases & Error Handling

### Network Issues
- Binance API down → Cached data + warning
- Claude API down → Friendly error + retry option
- Slow network → Show loading state clearly

### Invalid Inputs
- Wrong coin symbol → Suggest correct format
- Off-topic questions → Redirect to relevant skill
- Empty message → Disable send button

### AI Issues
- Hallucination → Validation layer catches
- Inconsistent output → Retry with clearer prompt
- Token limit → Truncate history intelligently

### User Behavior
- Rapid sending → Rate limit gracefully
- Very long questions → Encourage chunking
- Multiple sessions → Clear context isolation

---

## 📊 Success Metrics

### Engagement Metrics
- DAU/MAU
- Sessions per user
- Messages per session
- Skill usage distribution

### Quality Metrics
- Thumbs up/down ratio per skill
- Conversation completion rate
- Re-engagement rate (return within 7 days)

### Technical Metrics
- Response time (target: <5s for first chunk)
- API success rate (target: >99%)
- Cost per session

---

## 🛣️ Implementation Phases

### Phase 1: MVP (Week 1-3)

**Goals:**
- Functional skill cards page
- Working chat for 3 core skills
- Conversation persistence (local)

**Skills included:**
1. Price Action Analysis
2. Breakout Trading
3. DCA Strategy

**Features:**
- Skills list with cards
- Chat interface
- AI tool use (fetch data, calculate)
- Conversation history (local storage)
- Mobile responsive

**Out of scope:**
- User accounts
- Multi-device sync
- Advanced filters
- Skill detail pages (skip directly to chat)

---

### Phase 2: Production-ready (Week 4-6)

**Goals:**
- More skills
- Better UX
- Reliability

**Adds:**
- 5 more skills (total 8)
- Skill detail pages
- Better error handling
- Conversation search
- Suggested questions
- Quick actions in chat

---

### Phase 3: Growth features (Month 2-3)

**Goals:**
- User retention
- Quality improvement

**Adds:**
- User accounts (optional)
- Cross-device sync
- Conversation export
- Skill ratings/feedback
- Personalized suggestions
- Email notifications (optional)

---

### Phase 4: Advanced (Month 4+)

**Goals:**
- Differentiation
- Monetization

**Adds:**
- Custom watchlist per user
- Premium skills
- Advanced analytics
- API access
- White-label options

---

## ⚠️ Risks & Mitigations

### Risk 1: AI Hallucination
**Impact:** Wrong analysis → user loses money
**Mitigation:**
- Strict pattern definitions in prompts
- Validation layer checks numbers
- Always disclaimer
- Show data source

### Risk 2: API Cost Runaway
**Impact:** Cost > revenue
**Mitigation:**
- Rate limit per user
- Cache common requests
- Use cheaper models cho simple tasks
- Monitor cost daily

### Risk 3: Slow Response Time
**Impact:** Poor UX, user abandons
**Mitigation:**
- Streaming responses
- Show progress immediately
- Cache market data
- Optimize prompt length

### Risk 4: Inappropriate Use
**Impact:** Legal/regulatory issues
**Mitigation:**
- Clear "not financial advice" disclaimers
- Terms of service
- No automated trading suggestions
- Educational positioning

### Risk 5: Crypto Market Down
**Impact:** Less interest, less users
**Mitigation:**
- Educational content (always relevant)
- DCA skill (relevant in bear market)
- Long-term positioning

---

## 🔐 Security & Privacy

### User Data
- No PII collected in MVP (no signup)
- Conversation history in local storage only
- Future: opt-in cloud sync với encryption

### API Keys
- Backend only (never exposed to frontend)
- Rate limiting per session
- Monitor for abuse

### Disclaimers
- Prominent "not financial advice"
- Crypto risks disclosure
- AI limitations notice

---

## 🎯 Out of Scope (Cho MVP)

Những thứ KHÔNG có trong MVP để focus và ship nhanh:

- ❌ User accounts / authentication
- ❌ Payment / subscription
- ❌ Real-time price updates trong chat
- ❌ Charts visualization
- ❌ Multi-language (chỉ tiếng Việt + English)
- ❌ Mobile native app
- ❌ Telegram/Discord integration
- ❌ Auto-trading hoặc execution
- ❌ Social features (share, follow)
- ❌ Notifications

Có thể thêm sau khi validated product-market fit.

---

## 📚 Open Questions Cần Decide

Trước khi implement, làm rõ các điểm sau:

### Q1: Có skill detail page không?
- **Option A:** Click card → trực tiếp vào chat (đơn giản, nhanh)
- **Option B:** Click card → detail page → chat (educational, build trust)
- **Recommendation:** Option A cho MVP, có thể add B sau

### Q2: Welcome message tự động hay không?
- **Option A:** AI luôn say hi đầu mỗi conversation
- **Option B:** Empty chat, user start trước
- **Recommendation:** Option A để guide user

### Q3: Suggested questions hiển thị thế nào?
- **Option A:** Hiển thị mọi lúc (sticky)
- **Option B:** Chỉ hiển thị khi conversation rỗng
- **Option C:** Toggle on/off
- **Recommendation:** Option B cho clean UI

### Q4: Show AI thinking process?
- **Option A:** Hidden, chỉ show final answer
- **Option B:** Show từng step (fetching, calculating, analyzing)
- **Recommendation:** Option B cho transparency và trust

### Q5: Conversation title generation?
- **Option A:** Auto-generate từ first message
- **Option B:** User tự đặt
- **Option C:** AI summarize sau vài turns
- **Recommendation:** Option A đơn giản, có thể edit

### Q6: Skills sorted theo gì trên home page?
- **Option A:** Alphabetical
- **Option B:** Popularity (most used)
- **Option C:** Curated (manual)
- **Recommendation:** Curated cho MVP, popularity sau

### Q7: Có cho phép multiple chats cùng lúc?
- **Option A:** Single tab, single conversation
- **Option B:** Multiple tabs
- **Recommendation:** Option A cho MVP, B nâng cao sau

---

## ✅ Definition of Done (MVP)

Application được coi là DONE cho MVP khi:

### Functional
- [ ] User có thể browse skills cards on home page
- [ ] User có thể click vào skill và mở chat
- [ ] User có thể gửi message và nhận response từ AI
- [ ] AI tự fetch data khi cần
- [ ] AI tự calculate metrics
- [ ] Conversation được lưu trong local storage
- [ ] User có thể xem history of conversations
- [ ] User có thể resume old conversation
- [ ] User có thể start new conversation cùng skill

### Quality
- [ ] Response time first chunk < 5 seconds
- [ ] No JavaScript errors in console
- [ ] Mobile responsive (works on iPhone, Android)
- [ ] All 3 core skills functional với good output
- [ ] Error states handled gracefully
- [ ] Disclaimer visible on every page

### Polish
- [ ] Consistent styling across pages
- [ ] Loading states for all async operations
- [ ] Smooth animations/transitions
- [ ] Accessible (keyboard nav, screen reader basics)
- [ ] Performance acceptable (Lighthouse > 70)

---

## 📝 Summary

### Vision
Một website cung cấp các AI specialists chuyên về crypto analysis, mỗi specialist là 1 skill với chuyên môn riêng. User chọn specialist phù hợp, chat tự nhiên về coin họ quan tâm, nhận phân tích chuyên sâu mà không cần tự fetch data hay calculate gì cả.

### Core Value Proposition
- **For users:** Có "đội ngũ chuyên gia" 24/7, mỗi người giỏi 1 lĩnh vực, available qua chat đơn giản
- **For business:** Scalable, định giá được, có thể grow ecosystem of skills

### Key Differentiators
1. Skill-based (không phải generic chatbot)
2. Domain-specific knowledge cho mỗi skill
3. AI tự fetch data, không cần user technical
4. Transparent process (show thinking)
5. Educational angle (giải thích tại sao, không chỉ kết quả)

### Critical Success Factors
1. **Quality of skills:** Mỗi skill phải thực sự chuyên nghiệp
2. **AI reliability:** Output consistent và đúng đắn
3. **UX simplicity:** User mới hiểu ngay
4. **Performance:** Response phải nhanh
5. **Cost management:** AI calls economy

### Next Steps
1. Review document này, decide các open questions
2. Finalize skill catalog cho MVP (3 skills)
3. Design wireframes cho 4 pages chính
4. Define system prompts cho 3 skills
5. Setup tech stack
6. Start implementation Phase 1

---

**END OF PLAN**

*Document version: 1.0*
*Status: Ready for review and decision-making*
*Estimated MVP duration: 3 weeks*
