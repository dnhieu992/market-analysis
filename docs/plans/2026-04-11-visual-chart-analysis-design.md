# Visual Chart Analysis Design

**Goal:** Improve the existing daily plan feature by replacing the text-only JSON-based LLM pipeline with a simple visual flow — generate an H4 candlestick chart image and send it directly to Claude Vision for free-form trading analysis.

**Why Change**

The current two-step analyst/validator pipeline produces good plans but is complex:

- Two LLM calls (analyst → validator) with forced tool use and rigid schemas
- Full indicator JSON serialization passed as text
- Post-LLM hard checks and publish gates

In practice, sending a clear chart image with a simple prompt produces equally good results because Claude can see visual patterns (EMA fans, candle clusters, RSI divergence) that are difficult to express in JSON. The simpler approach is easier to maintain.

**Direction**

Single LLM call with:
- H4 candlestick chart image (last 150 candles)
- Vietnamese prompt: `"Phân tích {symbol} và cho plan giao dịch hôm nay"`
- Free-form text response — no tool use, no schema enforcement

---

## Current Flow vs New Flow

```
CURRENT
─────────────────────────────────────────────────────
SchedulerService.runDailyAnalysisForSymbols()
  └─ DailyAnalysisService.analyzeAndSave()
       ├─ getCandles D1 + H4 (200 each)
       ├─ buildDailyAnalysisMarketData (JSON)
       ├─ LlmGatewayService (2 LLM calls: analyst → validator)
       ├─ publishDailyAnalysisPlan (hard checks)
       ├─ save to DB
       └─ return { skipped, result.summary }
  └─ TelegramService.sendAnalysisMessage(result.summary)   ← text only


NEW
─────────────────────────────────────────────────────
SchedulerService.runDailyAnalysisForSymbols()           ← same entry point
  └─ VisualAnalysisService.analyze(symbol)              ← replaces DailyAnalysisService call
       ├─ MarketDataService.getCandles(symbol, '4h', 150)
       ├─ ChartService.generateChartImage(candles)
       │    └─ H4 PNG: candles + EMA20/50/200 + S/R lines
       └─ Claude Vision API (1 call, no tool use)
            content: [ image, text prompt ]
            → free-form analysis text
  ├─ TelegramService.sendPhoto(chartBuffer)              ← new method
  └─ TelegramService.sendAnalysisMessage(analysisText)   ← existing method, unchanged
```

---

## Files Changed vs Files Added

### Modified (existing files)

| File | Change |
|---|---|
| `apps/worker/src/modules/scheduler/scheduler.service.ts` | Inject `VisualAnalysisService`, update `runDailyAnalysisForSymbols()` to call it instead of `DailyAnalysisService` |
| `apps/worker/src/modules/scheduler/scheduler.module.ts` | Import `ChartModule` + `VisualAnalysisModule` |
| `apps/worker/src/modules/telegram/telegram.service.ts` | Add `sendPhoto(buffer, caption?)` method |
| `apps/worker/src/worker.module.ts` | Add `ChartModule` + `VisualAnalysisModule` to imports |
| `apps/worker/package.json` | Add `chartjs-node-canvas`, `chart.js`, `chartjs-chart-financial` |

### New Files

```
apps/worker/src/modules/chart/
  chart.types.ts          # ChartInput / ChartOutput types
  chart-renderer.ts       # Pure chart-building logic (no DI, testable)
  chart.service.ts        # NestJS injectable wrapping the renderer
  chart.module.ts         # Exports ChartService, imports MarketModule

apps/worker/src/modules/visual-analysis/
  visual-analysis.service.ts   # getCandles → generateChart → Claude Vision → text
  visual-analysis.module.ts    # Exports VisualAnalysisService
```

---

## Key Integration: `SchedulerService`

`runDailyAnalysisForSymbols()` is the single entry point called both:
- On boot (`main.ts`) when `WORKER_SEND_DAILY_ON_BOOT=true`
- By the `@Cron('0 0 * * *')` job via `sendDailySignals()`

**Before:**
```ts
const { skipped, result } = await this.dailyAnalysisService.analyzeAndSave(symbol);
if (!skipped) {
  await this.telegramService.sendAnalysisMessage({ content: result.summary, messageType: 'daily-plan' });
}
```

**After:**
```ts
const { chartBuffer, analysisText } = await this.visualAnalysisService.analyze(symbol);
await this.telegramService.sendPhoto(chartBuffer, `${symbol} H4`);
await this.telegramService.sendAnalysisMessage({ content: analysisText, messageType: 'daily-plan' });
```

The `skipped` deduplication logic is removed — visual analysis always runs fresh.

---

## Key Integration: `TelegramService`

Add `sendPhoto()` alongside the existing `sendAnalysisMessage()` and `sendToChat()` methods. Reuses the existing `this.httpClient` (Axios instance already configured with `baseURL: 'https://api.telegram.org'`).

```ts
async sendPhoto(imageBuffer: Buffer, caption?: string): Promise<{ success: boolean }>
// POST /bot{token}/sendPhoto with multipart/form-data: chat_id, photo (buffer), caption
```

---

## Chart Design

**Library:** `chartjs-node-canvas` + `chartjs-chart-financial`
- Server-side, no browser needed; `node-canvas` is Cairo-backed
- On Linux/Docker: requires system `cairo` + `pango` packages

**Canvas:** 1200 × 800px, PNG output

**Content:**
- Candlestick OHLCV bars (150 candles)
- EMA20 (blue), EMA50 (orange), EMA200 (red)
- S1/S2 support (dashed green horizontal lines) — from existing `findNearestSwingLows()`
- R1/R2 resistance (dashed red horizontal lines) — from existing `findNearestSwingHighs()`
- Current price marker (yellow dashed)

EMA values are computed as full per-candle series using existing `calculateEma()` from `@app/core`.

---

## LLM Call Design

**SDK:** `@anthropic-ai/sdk` — same Anthropic client already used in `LlmModule`

**Request:**
```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 2000,
  "messages": [{
    "role": "user",
    "content": [
      { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "<base64>" } },
      { "type": "text", "text": "Phân tích BTCUSDT và cho plan giao dịch hôm nay" }
    ]
  }]
}
```

**Response:** `response.content[0].text` — sent directly to Telegram.

---

## Implementation Tasks

- [x] **Task 1:** Install packages — `chartjs-node-canvas@5`, `chart.js@4` in `apps/worker/package.json` (dropped `chartjs-chart-financial` — v3 only; candlesticks drawn via custom plugin)
- [x] **Task 2:** Create `apps/worker/src/modules/chart/chart.types.ts` — `ChartInput` / `ChartOutput` types
- [x] **Task 3:** Create `apps/worker/src/modules/chart/chart-renderer.ts` — pure chart-building function, no DI
- [x] **Task 4:** Create `apps/worker/src/modules/chart/chart.service.ts` + `chart.module.ts`
- [x] **Task 5:** Create `apps/worker/src/modules/visual-analysis/visual-analysis.service.ts` — getCandles → chart → Claude Vision → `{ chartBuffer, analysisText }`
- [x] **Task 6:** Create `apps/worker/src/modules/visual-analysis/visual-analysis.module.ts`
- [x] **Task 7:** Add `sendPhoto(buffer, caption?)` to `apps/worker/src/modules/telegram/telegram.service.ts`
- [x] **Task 8:** Update `apps/worker/src/modules/scheduler/scheduler.service.ts` — inject `VisualAnalysisService`, update `runDailyAnalysisForSymbols()` to call visual analysis + `sendPhoto`
- [x] **Task 9:** Update `apps/worker/src/modules/scheduler/scheduler.module.ts` — import `VisualAnalysisModule` (ChartModule already imported transitively via VisualAnalysisModule)
- [x] **Task 10:** No changes needed to `worker.module.ts` — `VisualAnalysisModule` is wired transitively via `SchedulerModule`. Typecheck passes clean.

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **Same entry point** (`runDailyAnalysisForSymbols`) | Cron job and boot trigger stay unchanged; only the internal implementation changes |
| **Remove dedup/skip logic** | Visual analysis is cheap enough to run every time; no DB write means no dedup needed |
| **No DB persistence** | Visual analysis result is ephemeral — Telegram only. The DB model (`DailyAnalysis`) is left untouched for potential future use |
| **Reuse existing Axios client in TelegramService** | `sendPhoto` adds one method, no new HTTP client needed |
| **Reuse `@anthropic-ai/sdk`** | Already installed; `VisualAnalysisService` creates its own Anthropic client instance (same pattern as `ClaudeDailyAnalysisProvider`) |
| **150 H4 candles** | Enough trend history without crowding the chart; EMA200 needs ~200 bars to compute so fetch 200, render last 150 |
| **No RSI/MACD subcharts** | Keep chart clean; Claude reads candlestick + EMA patterns well without oscillator panels |

---

## Non-Goals

- Keeping the two-step analyst/validator LLM pipeline for Telegram output
- Persisting visual analysis to the database
- Adding D1 chart
- Structured output / schema validation of the LLM response
