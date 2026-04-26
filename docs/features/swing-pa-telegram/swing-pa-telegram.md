# Swing PA Telegram Bot

## Tổng quan

Gõ lệnh `/BTCUSDT swing` (hoặc bất kỳ symbol nào) vào Telegram, worker tự động trả về:
1. **Text analysis** — xu hướng, S/R zones, active market setup (nếu có), pending limit order plans
2. **Chart image** — candlestick chart daily với vùng S/R, swing markers, current price line

Toàn bộ phân tích dựa trên **Pure Price Action** — không dùng bất kỳ indicator nào (không EMA, RSI, ATR, Bollinger). Chỉ dùng cấu trúc HH/HL, swing highs/lows, volume, và S/R zones từ weekly candles.

---

## Kiến trúc

```
Telegram User
  ↓ gõ "/BTCUSDT swing"
TelegramPollingService          (long-polling every 2s)
  ↓ regex: /([A-Z0-9]+)\s+swing/i
  ↓ reply "⏳ Analyzing..."
SwingPaService
  ↓ fetch parallel:
    MarketDataService.getCandles('1d', 60)   → Binance klines
    MarketDataService.getCandles('1w', 52)   → Binance klines
    MarketDataService.getCandles('4h', 100)  → Binance klines
  ↓
analyzeSwingPa()              → SwingPaAnalysis
renderSwingPaChart()          → Buffer (PNG)
  ↓
SwingPaReviewService.review() → SwingPaReview | null   [Claude API]
  ↓
formatSwingPaMessage(analysis, review)  → HTML string (parse_mode HTML)
  ↓
TelegramService.sendToChat()       → text message (2 sections: PA + Claude Review)
TelegramService.sendPhotoToChat()  → chart image
```

---

## Cách sử dụng

Gửi vào Telegram chat bất kỳ lệnh có format:

```
/BTCUSDT swing
/ETHUSDT swing
/SOLUSDT swing
```

Symbol phải là **uppercase** và kết thúc bằng `swing`. Không phân biệt hoa thường với phần `swing`.

---

## Chiến lược — Pure Price Action (Daily Swing)

### Nguyên tắc cốt lõi

| Quy tắc | Chi tiết |
|---------|----------|
| Không indicator | Không EMA, RSI, ATR, Bollinger, MACD |
| Xu hướng | Chỉ từ cấu trúc HH/HL (Higher High / Higher Low) hoặc LH/LL |
| S/R zones | Lấy từ weekly candles (52 tuần), cluster 0.5%, zone width ±0.5% |
| Volume | Dùng để xác nhận breakout và liquidity sweep |
| Timeframe chính | Daily (1d) — 60 nến |
| Timeframe phụ | 4H — xác nhận pattern (pin bar, engulfing) |

### Xác định xu hướng

```
Uptrend:   cần ≥ 2 HH liên tiếp VÀ ≥ 2 HL liên tiếp
Downtrend: cần ≥ 2 LH liên tiếp VÀ ≥ 2 LL liên tiếp
Sideway:   không thỏa mãn cả hai điều kiện trên
```

Swing highs/lows được detect bằng cửa sổ 2 nến mỗi bên (standard 5-bar swing).

### CHoCH — Change of Character

Phát hiện khi giá đóng cửa xuyên qua HL cuối cùng (uptrend) hoặc LH cuối cùng (downtrend), báo hiệu khả năng đảo chiều xu hướng.

---

## Các Setup

### Market Setups (Active — vào lệnh ngay)

#### 1. Liquidity Sweep + Reversal

Giá "quét" thanh khoản dưới swing low (hoặc trên swing high) rồi đóng cửa ngược lại.

**Điều kiện Long:**
- Nến hiện tại có `low < swing low gần nhất`
- Close > swing low (đóng cửa trở lại bên trên)
- Lower wick ≥ 1.5× body
- Volume spike ≥ 1.5× avg 20 nến

**Điều kiện Short:** Đối xứng — wick trên swept swing high.

**SL/TP:**
- SL: `current.low × 0.997`
- TP1: swing high gần nhất (long) / swing low (short)

---

#### 2. Break & Retest

Giá phá vỡ zone S/R với volume cao, sau đó pullback về retest zone đó.

**Điều kiện Long (uptrend):**
- Trong 5 nến gần nhất: một nến đóng cửa *trên* vùng resistance (`close > zone.high`, `open < zone.high`)
- Volume nến breakout > avg 20 nến
- Nến hiện tại overlap vào zone (retest): `low ≤ zone.high AND high ≥ zone.low`
- Bonus: có 4H pin bar hoặc engulfing

**Confidence:**
- HIGH: volume cao + 4H pattern
- MEDIUM: volume cao hoặc 4H pattern
- LOW: cả hai đều không có (skip nếu thiếu cả hai)

**SL/TP:**
- SL: `zone.low × 0.995` (long)
- TP1: `zone.midpoint × 1.03` (long)

---

#### 3. Pullback to Higher Low

Trong uptrend mạnh, giá pullback về HL cuối cùng.

**Điều kiện:**
- Xu hướng: uptrend với ≥ 3 HH hoặc ≥ 3 HL liên tiếp
- Giá hiện tại cách HL cuối ≤ 3%
- Volume 3 nến gần nhất giảm dần (pullback tự nhiên)
- HL có confluence với S/R zone (trong 2%)

**SL/TP:**
- SL: `lastHl × 0.985`
- TP1: swing high gần nhất

---

### Pending Limit Setups (Không có active setup)

Khi không có market setup nào kích hoạt, hệ thống tự động tạo **limit order plans** dựa trên S/R zones và swing levels.

#### Limit Buy @ Support

Với mỗi support zone nằm *dưới* giá hiện tại (tối đa 2 zone gần nhất):

| Field | Giá trị |
|-------|---------|
| Limit price | `zone.midpoint` |
| Entry zone | `[zone.low, zone.high]` |
| SL | `zone.low × 0.995` |
| TP1 | Swing high gần nhất trên giá |
| TP2 | S/R resistance tiếp theo |
| Confidence | HIGH nếu ≥3 lần test + HL confluence; MEDIUM nếu ≥2 test hoặc HL confluence |

Nếu last Higher Low chưa được cover bởi S/R zone nào → tự động thêm limit buy tại HL đó.

#### Limit Sell @ Resistance

Đối xứng — resistance zones nằm *trên* giá, tối đa 2 zone gần nhất. Thêm limit sell tại LH cuối cùng nếu chưa có zone cover.

---

## Files

### Worker (`apps/worker/src/modules/analysis/`)

| File | Mô tả |
|------|-------|
| `swing-pa-analyzer.ts` | Engine phân tích thuần PA: trend, CHoCH, S/R zones, 3 market setups, pending limit setups |
| `swing-pa-formatter.ts` | Format `SwingPaAnalysis` + `SwingPaReview` thành HTML message Telegram (2 sections) |
| `swing-pa-chart.ts` | Render PNG chart (1200×700) bằng Chart.js + chartjs-node-canvas |
| `swing-pa.service.ts` | Orchestrate: fetch candles → analyze → review → format → send Telegram |
| `swing-pa-review.service.ts` | **[PLANNED]** Gọi Claude API với analysis JSON + 30 daily candles, parse tool_use response |
| `analysis.module.ts` | NestJS module export `SwingPaService`, `SwingPaReviewService` |

### Worker (`apps/worker/src/modules/ema-signal/`)

| File | Mô tả |
|------|-------|
| `telegram-polling.service.ts` | Long-polling Telegram, regex `/([A-Z0-9]+)\s+swing/i`, gọi `SwingPaService` |
| `ema-signal.module.ts` | Import `AnalysisModule` để inject `SwingPaService` |

### Worker (`apps/worker/src/modules/telegram/`)

| File | Mô tả |
|------|-------|
| `telegram.service.ts` | `sendToChat(chatId, text)` và `sendPhotoToChat(chatId, buffer, caption)` |

### Worker (`apps/worker/src/modules/market/`)

| File | Mô tả |
|------|-------|
| `binance-market-data.service.ts` | Thêm interval `'1w': '1w'` để fetch weekly candles |

### Worker root

| File | Mô tả |
|------|-------|
| `worker.module.ts` | Import `EmaSignalModule` (chứa `TelegramPollingService`) |

---

## Types

```typescript
// swing-pa-analyzer.ts

type SwingTrend = 'uptrend' | 'downtrend' | 'sideway';


type SRZone = {
  low: number; high: number; midpoint: number;
  touches: number; role: 'support' | 'resistance';
};

type SwingSetup = {
  type: 'break-retest' | 'pullback-hl' | 'liquidity-sweep'
      | 'limit-support' | 'limit-resistance' | null;
  entryType: 'market' | 'limit';
  direction: 'long' | 'short' | null;
  confidence: 'high' | 'medium' | 'low';
  limitPrice: number | null;
  entryZone: [number, number] | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  notes: string[];
};

type SwingPaAnalysis = {
  symbol: string;
  currentPrice: number;
  trend: SwingTrend;
  swingHighs: number[];        // last 5 swing highs
  swingLows: number[];         // last 5 swing lows
  consecutiveHhCount: number;
  consecutiveHlCount: number;
  srZones: SRZone[];           // max 5 zones within 30% of price
  choch: ChochSignal;
  setup: SwingSetup;           // active market setup or null
  pendingLimitSetups: SwingSetup[]; // limit order plans (always populated)
  avgVolume20: number;
};

// swing-pa-review.service.ts  [PLANNED]

type SwingPaSetupReview = {
  setupType: string;                      // 'limit-support' | 'break-retest' | ...
  direction: 'long' | 'short';
  verdict: 'valid' | 'adjusted' | 'skip';
  adjustedConfidence?: 'high' | 'medium' | 'low';
  adjustedEntry?: [number, number];       // null nếu không điều chỉnh
  adjustedSl?: number;
  adjustedTp1?: number;
  adjustedTp2?: number;
  reason: string;
};

type SwingPaReview = {
  verdict: 'confirmed' | 'adjusted' | 'no-trade';
  model: string;                          // e.g. 'claude-sonnet-4-6'
  trendComment: string;
  activeSetupReview?: SwingPaSetupReview;
  limitSetupReviews: SwingPaSetupReview[];
  warnings: string[];
  summary: string;
};
```

---

## Chart

Render bằng `chartjs-node-canvas` (server-side, không cần browser).

| Thành phần | Chi tiết |
|------------|---------|
| Canvas | 1200 × 700px, background `#1a1a2e` (dark) |
| Candles | Custom plugin vẽ OHLC (green/red body + wicks) |
| S/R zones | Colored bands: xanh lá (support), đỏ (resistance), dashed midline + label |
| Swing markers | Tam giác xanh (swing low ▲) và đỏ (swing high ▼) |
| Current price | Đường dashed vàng ngang |
| X-axis | Ngày tháng từ candle timestamp |

---

## Ví dụ output Telegram

Message gồm **2 section phân biệt** bằng separator `════`:

```
════════════════════════
📊 PA ANALYSIS  [Pure Rules]
════════════════════════
TREND: 📈 UPTREND (HH + HL)
  Highs: 85,000 → 90,000 → 94,500
  Lows:  78,000 → 82,000 → 87,000
  Consecutive: 3 HH / 3 HL

🔵 CHoCH: Not detected

KEY ZONES (Weekly S/R):
  🟢 S: 86,800 – 87,680  (3x tested)
  🔴 R: 95,200 – 96,000  (2x tested)

NO ACTIVE MARKET SETUP

PENDING LIMIT ORDERS (2):
  🟢 LIMIT BUY @ $87,200  [Medium]
    ...
  🔴 LIMIT SELL @ $95,600  [Medium]
    ...

💰 Price: $91,180

════════════════════════
🤖 CLAUDE REVIEW  [claude-sonnet-4-6]
════════════════════════
Verdict: ✅ ADJUSTED

Trend: Uptrend còn nguyên vẹn. 3 HH/HL xác nhận. Cấu trúc đang giữ tốt.

📋 Limit Buy @ $87,200  →  🟡 ADJUSTED
  Confidence: Low → Medium
  Entry điều chỉnh:  $86,800 – $87,500
  SL điều chỉnh:     $85,900
  TP1 giữ nguyên:    $94,500
  TP2 điều chỉnh:    $96,000
  Lý do: Nên mua tại lower edge của zone, không phải midpoint.

📋 Limit Sell @ $95,600  →  ⏭ SKIP
  Lý do: Zone chỉ test 1x weekly. R:R = 1:0.8 — không đủ.

⚠️ Warnings:
  • R:R của Limit Buy gốc < 1 — đã điều chỉnh SL để đạt R:R = 1:3
  • 3 nến gần nhất volume tăng → pullback có thể chưa kết thúc

Tóm tắt: Setup long tại $86,800 hợp lý. Chờ 4H confirmation trước khi đặt lệnh.

⚠️ Tín hiệu tự động — xác nhận trước khi vào lệnh
```

---

## Env vars cần thiết

```env
TELEGRAM_BOT_TOKEN=...     # Bot token từ @BotFather
TELEGRAM_CHAT_ID=...       # Default chat ID (fallback)
CLAUDE_API_KEY=...         # Anthropic API key (dùng cho Claude Review)
CLAUDE_MODEL=sonnet        # 'sonnet' | 'opus' (default: sonnet)
```

Không cần Binance API key vì chỉ dùng public endpoints.

---

## Luồng xử lý lỗi

| Tình huống | Hành vi |
|------------|---------|
| Symbol không tồn tại trên Binance | Binance trả lỗi → catch → bot reply "❌ Analysis failed" |
| Dữ liệu daily candles < 10 nến | `analyzeSwingPa` throw Error → catch → reply lỗi |
| Chart render fail | Text vẫn gửi, chart không gửi (log warning) |
| Telegram API timeout | Log warning, không retry |
| Claude API fail / timeout (>30s) | Review = null → gửi PA analysis như bình thường, không có section Claude Review, log warning |
| Claude trả về JSON không hợp lệ | Parse fail → review = null → fallback như trên |

---

## Mở rộng trong tương lai

| Feature | Mô tả |
|---------|-------|
| `/BTCUSDT swing 4h` | Hỗ trợ timeframe khác ngoài daily |
| Scheduled alerts | Worker tự động quét danh sách symbol mỗi ngày và push analysis |
| Setup alert | Chỉ notify khi có active market setup (không phải on-demand) |
| Multi-symbol | `/swing BTCUSDT ETHUSDT SOLUSDT` — batch analysis |
| Backtest integration | Link kết quả phân tích với back-test của `price-action.strategy.ts` |

---

## Plan: Claude Review Integration

### Mục tiêu

Sau khi `analyzeSwingPa()` ra kết quả, gửi analysis JSON + 30 daily candles gần nhất lên Claude API. Claude đóng vai **senior PA trader** để:
- Validate xu hướng và cấu trúc swing (có đúng HH/HL không)
- **Explicitly review each item in pendingLimitSetups** — tạo entry tương ứng trong `limitSetupReviews` với các tiêu chí R:R ≥ 2 và zone quality (≥2 touches)
- **Guarantee a valid setup:** Nếu tất cả limit setups được đánh giá là "skip" hoặc `pendingLimitSetups` rỗng, Claude **PHẢI** thêm ít nhất một replacement limit order vào `limitSetupReviews` với verdict "adjusted". Chọn support/resistance zone mạnh nhất từ `srZones` và cung cấp `adjustedEntry [low, high]`, `adjustedSl`, `adjustedTp1`, cùng lý do bằng Tiếng Việt.
- Điều chỉnh confidence, entry, SL, TP nếu thấy cần thiết
- Thêm warnings khi phát hiện vấn đề
- Đưa ra verdict cuối: **Confirmed / Adjusted / No-Trade**

Output giữ nguyên section PA Analysis gốc, thêm section **Claude Review** bên dưới, phân biệt bằng separator `════`.

### Data gửi lên Claude

```
Model: claude-sonnet-4-6  (hỗ trợ tool_use, đủ nhanh)

System prompt:
  "You are a senior pure price action swing trader reviewing an automated analysis.
   Review the setups strictly — prioritize R:R ≥ 2, zone quality (≥2 touches),
   and trend alignment. Adjust or skip setups that don't meet the bar.

   For each item in pendingLimitSetups, add a corresponding entry to limitSetupReviews —
   apply the same R:R ≥ 2 and zone quality criteria.

   If all limit setups are judged skip, or pendingLimitSetups is empty, you MUST add
   at least one replacement limit order to limitSetupReviews with verdict "adjusted".
   Choose the strongest support or resistance zone from srZones in the analysis data.
   Provide adjustedEntry [low, high], adjustedSl, adjustedTp1, and a reason in Vietnamese.

   Always respond in Vietnamese."

User message (text only):
  1. SwingPaAnalysis JSON — trend, swing levels, S/R zones, active setup, pending limits
  2. Last 30 daily candles dạng compact text:
     "YYYY-MM-DD | open | high | low | close | volume"

Tool use (structured output):
  tool name: record_swing_pa_review
  schema: SwingPaReview (xem phần Types)
```

Lý do chọn **candle data** thay vì chart image:
- Claude cần validate số (R:R, khoảng cách %, zone logic) → text data chính xác hơn vision
- Không mất token vào visual parsing
- Nhanh hơn, rẻ hơn, kết quả ổn định hơn

### Checklist Implementation

#### 1. Tạo `swing-pa-review.service.ts`

- [x] Tạo class `SwingPaReviewService` (`@Injectable`)
- [x] Method `review(analysis: SwingPaAnalysis, dailyCandles: Candle[]): Promise<SwingPaReview | null>`
- [x] Build system prompt (vai trò senior PA trader, tiêu chí review)
- [x] Build user message: serialize `SwingPaAnalysis` JSON + format 30 candles gần nhất thành compact text
- [x] Định nghĩa tool schema `record_swing_pa_review` với đầy đủ fields của `SwingPaReview`
- [x] Gọi Claude API bằng axios POST `https://api.anthropic.com/v1/messages` (pattern giống `ClaudeDailyAnalysisProvider`)
- [x] Parse response: tìm `tool_use` block, extract `input` field
- [x] Bọc toàn bộ trong try/catch với timeout 30s → return `null` nếu fail
- [x] Log warning khi review fail (không throw)

#### 2. Cập nhật `swing-pa.service.ts`

- [x] Inject `SwingPaReviewService` vào constructor
- [x] Trong `analyze()`: sau khi có `analysis` và `chartBuffer`, gọi `reviewService.review(analysis, dailyCandles)`
- [x] Truyền `review` (có thể là `null`) vào `formatSwingPaMessage(analysis, review)`
- [x] Trả về `review` trong `SwingPaResult` để tiện debug nếu cần

#### 3. Cập nhật `swing-pa-formatter.ts`

- [x] Thêm param `review?: SwingPaReview | null` vào `formatSwingPaMessage()`
- [x] Wrap section PA Analysis hiện tại trong separator `════ PA ANALYSIS [Pure Rules] ════`
- [x] Nếu `review` tồn tại: thêm section `════ CLAUDE REVIEW [model] ════` với:
  - [x] Verdict badge (✅ CONFIRMED / 🔧 ADJUSTED / 🚫 NO-TRADE)
  - [x] Trend comment
  - [x] Active setup review (nếu có): verdict + adjusted levels + reason
  - [x] Từng pending limit review: verdict (VALID / ADJUSTED / SKIP) + adjusted levels + reason
  - [x] Warnings list
  - [x] Summary
- [x] Nếu `review` là null: chỉ hiện section PA gốc, không hiện gì thêm

#### 4. Cập nhật `analysis.module.ts`

- [x] Thêm `SwingPaReviewService` vào `providers`
- [x] Thêm `SwingPaReviewService` vào `exports`

#### 5. Build & deploy

- [x] Chạy `tsc --noEmit` để check TypeScript errors
- [x] Commit tất cả thay đổi
- [x] Push lên `main`
- [x] Trên server: `git pull && yarn workspace @app/worker build && pm2 restart worker`
- [x] Test: gửi `/BTCUSDT swing` trên Telegram, verify message có cả 2 sections
