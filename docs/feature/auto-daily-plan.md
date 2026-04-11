# Feature: Auto Daily Plan

## Overview

The auto daily plan feature runs once per day and sends a trading analysis for each tracked symbol to Telegram. It generates an H4 candlestick chart image, sends it to Claude Vision with a Vietnamese prompt, and delivers both the chart and the AI analysis text to the user. The result is also persisted to the database.

---

## Requirements

- Every day at **00:00 UTC** (07:00 Vietnam time UTC+7), the worker automatically runs a visual analysis for all tracked symbols
- On worker boot, if `WORKER_SEND_DAILY_ON_BOOT=true`, the analysis runs immediately
- For each symbol:
  - An H4 candlestick chart (last 150 candles) is generated with EMA20/50/200 and support/resistance levels
  - The chart image and a Vietnamese prompt are sent to Claude Vision
  - The chart photo is sent to Telegram first, followed by the analysis text
  - The result is saved to the `DailyAnalysis` database table
  - If a record already exists for the same symbol + date, the DB save is skipped (dedup)
- If the analysis fails for one symbol, the error is logged and the loop continues for the next symbol

---

## Flow

```
Worker boot or 00:00 UTC cron
  │
  └─ SchedulerService.runDailyAnalysisForSymbols(symbols)
       │
       └─ for each symbol:
            │
            ├─ VisualAnalysisService.analyze(symbol)
            │    │
            │    ├─ MarketDataService.getCandles(symbol, '4h', 200)
            │    │
            │    ├─ computeEmaSeries(closes, 20/50/200)
            │    │
            │    ├─ extractSupportAndResistanceLevels(last 150 candles)
            │    │
            │    ├─ ChartService.generateChartImage()
            │    │    └─ chart-renderer.ts → PNG Buffer (1200×800px)
            │    │         ├─ Candlestick OHLCV bars (green/red)
            │    │         ├─ EMA20 (blue), EMA50 (orange), EMA200 (red)
            │    │         ├─ S1/S2 support (dashed green)
            │    │         ├─ R1/R2 resistance (dashed red)
            │    │         └─ Current price marker (yellow dashed)
            │    │
            │    ├─ Claude Vision API (single call)
            │    │    content: [ H4 chart image, "Phân tích {symbol} và cho plan giao dịch hôm nay" ]
            │    │    → free-form Vietnamese analysis text
            │    │
            │    └─ saveToDatabase()
            │         ├─ check existing record for symbol + today's date
            │         └─ create DailyAnalysis row if not exists
            │
            ├─ TelegramService.sendPhoto(chartBuffer, "{symbol} H4")
            └─ TelegramService.sendAnalysisMessage(analysisText)
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `WORKER_SEND_DAILY_ON_BOOT` | No | Set to `true` to trigger analysis immediately on worker startup |
| `CLAUDE_API_KEY` | Yes | Anthropic API key for Claude Vision calls |
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot token for sending messages |
| `TELEGRAM_CHAT_ID` | Yes | Telegram chat ID to send analysis to |
| `DATABASE_URL` | Yes | MySQL connection string for persisting results |
| `TRACKED_SYMBOLS` | Yes | Comma-separated list of symbols e.g. `BTCUSDT,ETHUSDT` |

---

## Affected Code

### App
`apps/worker`

### New Files
| File | Description |
|---|---|
| `apps/worker/src/modules/chart/chart.types.ts` | `ChartInput` / `ChartOutput` / `OhlcCandle` types |
| `apps/worker/src/modules/chart/chart-renderer.ts` | Pure function that renders PNG using `chartjs-node-canvas` |
| `apps/worker/src/modules/chart/chart.service.ts` | NestJS injectable wrapping `chart-renderer.ts` |
| `apps/worker/src/modules/chart/chart.module.ts` | NestJS module exporting `ChartService` |
| `apps/worker/src/modules/visual-analysis/visual-analysis.service.ts` | Orchestrates candles → chart → Claude Vision → DB save |
| `apps/worker/src/modules/visual-analysis/visual-analysis.module.ts` | NestJS module exporting `VisualAnalysisService` |

### Modified Files
| File | Change |
|---|---|
| `apps/worker/src/modules/scheduler/scheduler.service.ts` | Replaced `DailyAnalysisService` with `VisualAnalysisService` in `runDailyAnalysisForSymbols()` |
| `apps/worker/src/modules/scheduler/scheduler.module.ts` | Added `VisualAnalysisModule` import |
| `apps/worker/src/modules/telegram/telegram.service.ts` | Added `sendPhoto(buffer, caption?)` method |
| `apps/worker/src/worker.module.ts` | Removed `MarketSummaryModule` (disabled H4 summary messages) |
| `apps/worker/package.json` | Added `chartjs-node-canvas@5`, `chart.js@4` |
| `packages/db/prisma/schema.prisma` | Made structural fields optional on `DailyAnalysis` model |
| `packages/db/prisma/migrations/20260411000000_*/migration.sql` | ALTER TABLE to allow NULL on structural fields |

---

## Database

**Table:** `DailyAnalysis`

**Unique constraint:** `(symbol, date)` — one record per symbol per day.

**Fields saved by this feature:**

| Field | Value |
|---|---|
| `symbol` | e.g. `BTCUSDT` |
| `date` | Today's date at UTC midnight |
| `status` | `PUBLISHED` |
| `llmProvider` | `claude` |
| `llmModel` | `claude-sonnet-4-6` |
| `aiOutputJson` | `{ "analysisText": "..." }` |
| `summary` | Full Claude Vision response text |

Structural fields (`d1Trend`, `h4Trend`, `d1S1`…`h4R2`) are nullable and left empty by this feature.

---

## Chart Library

- **Package:** `chartjs-node-canvas@5` + `chart.js@4`
- **Native dependency:** `canvas@3` (Cairo-backed, requires system libs)
- **Linux/VPS install:** `sudo apt-get install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev build-essential pkg-config`
- **Build canvas after install:** `npm run install` inside `node_modules/.pnpm/canvas@3.x.x/node_modules/canvas/`
- **Note:** `chartjs-chart-financial` was not used — incompatible with chart.js v4. Candlesticks are drawn via a custom Chart.js plugin in `chart-renderer.ts`.

---

## LLM

- **Provider:** Anthropic Claude
- **Model:** `claude-sonnet-4-6`
- **Call type:** Single vision call — no tool use, no schema enforcement
- **Input:** H4 chart PNG (base64) + Vietnamese text prompt
- **Output:** Free-form Vietnamese analysis text sent directly to Telegram
- **Timeout:** 90 seconds

---

## Known Constraints

- The cron job fires at `00:00 UTC`. For Vietnam time (UTC+7) this means 07:00 AM local.
- Chart generation requires Cairo system libraries on the server — must be manually installed on new VPS deployments.
- If `DATABASE_URL` is not set or DB connection fails, the analysis still sends to Telegram but the DB save is skipped with an error log.
- Image is not persisted — it is generated in memory, used once for Claude + Telegram, then discarded.
