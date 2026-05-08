# Swing Signal — Implementation Plan (Refactor to AI Breakout Analysis)

## Tổng quan thay đổi

Thay thế toàn bộ logic RSI(14) oversold cũ bằng AI-driven breakout analysis theo `ANALYSIS_RULES_FLOW.md`.

| Thay đổi | Cũ | Mới |
|---|---|---|
| Logic | RSI(14) ≤ 30 trên H4 | Pre-process + Claude AI analysis + Validator |
| Cron | `0 0,4,8,12,16,20 * * *` (mỗi H4 close) | `30 0 * * *` (00:30 UTC hàng ngày) |
| Watchlist | `User.symbolsTracking` từ DB | Giữ nguyên: `User.symbolsTracking` từ DB |
| Output | Alert đơn giản RSI | Full breakout signal với pattern, setup, R:R, TP/SL |

---

## Breaking Tasks

### Task 1 — Pre-Processing Engine

**File:** `apps/worker/src/modules/swing-signal/swing-signal-preprocessor.ts`

- [ ] **1.1** Implement `detectSwings(candles, leftBars=3, rightBars=3)` → trả về `SwingPoint[]` (type, price, time, index)
- [ ] **1.2** Implement `detectTrend(swings)` → `{ direction: 'UPTREND'|'DOWNTREND'|'SIDEWAYS', strength: 'STRONG'|'MODERATE'|'WEAK', consecutiveHH, consecutiveHL }`
- [ ] **1.3** Implement `analyzeVolume(candles)` → `{ ma20, current, ratio, trend: 'INCREASING'|'DECREASING'|'STABLE', spike: boolean }`
- [ ] **1.4** Implement `calculateAtr(candles, period=14)` → `{ atr, atrPct }`
- [ ] **1.5** Implement `detectKeyLevels(candles, currentPrice, atr)` → `{ support: Level[], resistance: Level[] }` với clustering 1.5%, strength score, zone width
- [ ] **1.6** Implement `calculateFibLevels(candles, trend)` → `{ swingLow, swingHigh, r236..r786, goldenZoneLow, goldenZoneHigh, e1272, e1618 }`
- [ ] **1.7** Implement `preProcess(symbol, weeklyCandles, dailyCandles, fourHourCandles)` → `ProcessedMarketData` (object tổng hợp tất cả trên)

**Types cần define trong cùng file hoặc `swing-signal.types.ts`:**
```ts
SwingPoint, TrendResult, VolumeMetrics, AtrResult, KeyLevel, FibLevels, ProcessedMarketData
```

---

### Task 2 — Prompt Builder

**File:** `apps/worker/src/modules/swing-signal/swing-signal-prompt.ts`

- [ ] **2.1** Define `SWING_SIGNAL_SYSTEM_PROMPT` constant (lấy từ section 2.1 của ANALYSIS_RULES_FLOW.md)
- [ ] **2.2** Implement helper `formatCandles(candles)` → chuỗi text `date | open | high | low | close | vol`
- [ ] **2.3** Implement helper `formatLevels(levels)` → chuỗi text level với zone + strength
- [ ] **2.4** Implement helper `formatSwings(swings)` → chuỗi text swing points
- [ ] **2.5** Implement `buildSwingSignalPrompt(data: ProcessedMarketData)` → string (user prompt theo template section 2.2)

---

### Task 3 — AI Response Types & Validator

**File:** `apps/worker/src/modules/swing-signal/swing-signal-validator.ts`

- [ ] **3.1** Define TypeScript types cho AI response: `SwingSignalAiResponse`, `BuySetup`, `PatternDetected`, `TrendAlignment`
- [ ] **3.2** Implement `parseAiResponse(raw: string)` → `SwingSignalAiResponse | null` (JSON.parse + basic shape check)
- [ ] **3.3** Implement hard rule validation (Rules 1–7 từ section 3.1):
  - TP1 > current price
  - SL < entry_target
  - R:R recompute + override (min 2.0)
  - SL distance 1.5%–15%
  - TPs ascending order
  - TP sizes normalize to 100%
  - Entry target within entry zone
- [ ] **3.4** Implement soft rule warnings (WARN 1–3 từ section 3.2)
- [ ] **3.5** Implement `validateAnalysis(analysis, currentPrice)` → mutates analysis in place, returns cleaned version
- [ ] **3.6** Implement filter logic: remove rejected setups → if empty → set recommendation = SKIP

---

### Task 4 — Telegram Formatter

**File:** `apps/worker/src/modules/swing-signal/swing-signal-formatter.ts`

- [ ] **4.1** Implement `formatSwingSignalBreakoutMessage(analysis: SwingSignalAiResponse)` → HTML string theo template section 4.1
- [ ] **4.2** Emoji mapping: `BUY_NOW → 🟢`, `WAIT_FOR_PULLBACK → 🟡`, `WAIT_FOR_BREAKOUT → 🔵`
- [ ] **4.3** Handle Telegram HTML special chars (escape `<`, `>`, `&` trong text fields)

> Note: File `packages/core/src/telegram/format-swing-signal-message.ts` (RSI formatter cũ) sẽ được giữ nguyên hoặc xoá sau khi confirm không còn dùng.

---

### Task 5 — Claude API Call

Gọi trực tiếp qua `axios` (pattern giống `SwingPaReviewService`), không dùng `tool_use` — dùng plain text response (AI trả raw JSON).

- [ ] **5.1** Implement `callClaudeForSwingSignal(systemPrompt, userPrompt)` trong `swing-signal.service.ts` hoặc tách ra `swing-signal-claude.client.ts`
  - Model: `process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'`
  - `max_tokens: 4000`, `temperature: 0.2`
  - Dùng axios instance với `x-api-key`, `anthropic-version: 2023-06-01`
  - Timeout: 90s (nhiều coin nên cần generous)
  - Extract text từ response `content[0].text`
  - Prompt caching: add `cache_control: { type: "ephemeral" }` trên system prompt block

---

### Task 6 — Rewrite SwingSignalService

**File:** `apps/worker/src/modules/swing-signal/swing-signal.service.ts`

- [ ] **6.1** Xoá toàn bộ logic RSI cũ
- [ ] **6.2** Giữ nguyên: load `symbolsTracking` từ `userRepository.findFirst()`
- [ ] **6.3** Implement `analyzeSymbol(symbol)`:
  1. Fetch W(150) + D(365) + 4H(360) candles song song (`Promise.all`)
  2. `preProcess(symbol, weekly, daily, fourHour)`
  3. `buildSwingSignalPrompt(processed)`
  4. `callClaudeForSwingSignal(systemPrompt, userPrompt)`
  5. `parseAiResponse(rawText)`
  6. `validateAnalysis(analysis, processed.currentPrice)`
  7. Nếu `recommendation !== 'SKIP'` và `buy_setups.length > 0` → gửi Telegram
  8. `await sleep(1500)` giữa mỗi coin (rate limit)
- [ ] **6.4** Update `checkAll()`: gọi `analyzeSymbol()` thay vì `checkSymbol()`; bỏ "no signals" notification kiểu cũ (mỗi coin tự quyết định có gửi hay không)
- [ ] **6.5** Error handling: log error per symbol, tiếp tục với coin tiếp theo (không crash toàn bộ run)

---

### Task 7 — Update Cron Schedule

**File:** `apps/worker/src/modules/scheduler/scheduler.service.ts`

- [ ] **7.1** Đổi cron expression từ `0 0,4,8,12,16,20 * * *` sang `30 0 * * *`
- [ ] **7.2** Đổi comment từ "Runs after every H4 candle close" sang "Runs daily at 00:30 UTC"
- [ ] **7.3** Đổi tên method từ `checkSwingSignals()` sang `runDailySwingScan()` (optional, cho rõ nghĩa)

---

### Task 8 — Update Module

**File:** `apps/worker/src/modules/swing-signal/swing-signal.module.ts`

- [ ] **8.1** Kiểm tra imports — `MarketModule` và `TelegramModule` đã đủ; không cần thêm `LlmGatewayModule` vì dùng axios trực tiếp

---

### Task 9 — Docs

- [ ] **9.1** Update `ANALYSIS_RULES_FLOW.md` — align với NestJS system (done trước khi implement)
- [ ] **9.2** Update hoặc tạo mới feature doc tại `docs/features/swing-signal/swing-signal.md` (cùng commit với code)

---

## File Map

```
apps/worker/src/modules/swing-signal/
  swing-signal.types.ts           NEW — shared types
  swing-signal-preprocessor.ts   NEW — Task 1
  swing-signal-prompt.ts          NEW — Task 2
  swing-signal-validator.ts       NEW — Task 3
  swing-signal-formatter.ts       NEW — Task 4
  swing-signal.service.ts         REWRITE — Task 5 + 6
  swing-signal.module.ts          CHECK — Task 8

apps/worker/src/modules/scheduler/
  scheduler.service.ts            EDIT — Task 7

docs/features/swing-signal/
  ANALYSIS_RULES_FLOW.md          EDIT — Task 9.1
  swing-signal.md                 UPDATE — Task 9.2
```

---

## Notes

- **Watchlist**: vẫn từ `User.symbolsTracking` DB — không thay đổi nguồn dữ liệu
- **Không cần thêm dependency** — axios đã có, MarketModule đã fetch candles, TelegramModule đã send
- **Prompt caching**: add `cache_control: { type: "ephemeral" }` trên system prompt để giảm cost khi scan 30 coin
- **Thời gian chạy ước tính**: 30 coin × ~10s/coin = ~5 phút, cron 00:30 UTC là an toàn
- **Không cần DB** — không lưu signal vào DB, chỉ send Telegram
- **Model**: `process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'` (follow env convention hiện có)
