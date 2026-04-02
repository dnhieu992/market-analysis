# Market Analysis Bot Scaffold

## Goal

Build a personal **market analysis bot** with the following behavior:

- On every **4h candle close**, fetch market data for configured symbols.
- Compute indicators locally.
- Ask an LLM to generate a concise Vietnamese analysis.
- Send the analysis to Telegram.
- Store analysis history, signal history, order history, and Telegram delivery logs.
- Expose a small web/API app to inspect history.

This project should be scaffolded as a **pnpm monorepo** with a shared database package and separate `api` and `worker` apps.

---

## Tech Stack

Use the following stack unless there is a very strong reason not to:

- **Monorepo:** pnpm workspaces
- **Language:** TypeScript
- **Runtime:** Node.js
- **API:** NestJS
- **Worker:** NestJS standalone application or lightweight NestJS app
- **ORM:** Prisma
- **Database (v1):** SQLite
- **Scheduler (v1):** cron-based scheduler inside worker
- **Queue (future-ready):** BullMQ-compatible structure, but do **not** require Redis in v1
- **HTTP client:** Axios
- **Telegram:** Telegram Bot API
- **LLM provider:** OpenAI-compatible client wrapper
- **Validation:** Zod or class-validator
- **Logging:** Pino or NestJS logger
- **Config:** dotenv + typed config layer

---

## Product Scope

### v1 features

1. Track one or more symbols, starting with `BTCUSDT`.
2. Run analysis when each **4h candle closes**.
3. Store all analysis runs in DB.
4. Store normalized signal results in DB.
5. Send Telegram messages for each analysis.
6. Store Telegram delivery logs.
7. Provide API endpoints to view:
   - latest analysis runs
   - latest signals
   - order history
   - Telegram delivery logs
8. Support manual order logging from the API/UI.

### Not required in v1

- Auto-trading
- Exchange order execution
- Multi-user auth
- Redis/BullMQ mandatory setup
- Advanced chart rendering
- Websocket live dashboard

---

## Architecture

Use **one codebase, two processes**:

- `apps/api`: HTTP API and optional admin web server
- `apps/worker`: cron/scheduled analysis worker

Shared packages:

- `packages/db`: Prisma schema + Prisma client
- `packages/core`: indicators, prompt builders, common types, domain utilities
- `packages/config`: shared env/config helpers

### Why this architecture

- API restarts must not stop scheduled jobs.
- Worker logic must be isolated from web concerns.
- Shared business logic should live in packages, not duplicated.
- DB schema should be reusable from both API and worker.

---

## Expected Repository Structure

```text
market-analysis-bot/
  apps/
    api/
      src/
        main.ts
        app.module.ts
        modules/
          health/
          analysis/
          signals/
          orders/
          telegram-logs/
      test/
      package.json
      tsconfig.json
    worker/
      src/
        main.ts
        worker.module.ts
        modules/
          scheduler/
          market/
          analysis/
          telegram/
          persistence/
      test/
      package.json
      tsconfig.json
  packages/
    db/
      prisma/
        schema.prisma
        migrations/
      src/
        client.ts
        index.ts
      package.json
      tsconfig.json
    core/
      src/
        indicators/
        prompts/
        types/
        utils/
        constants/
      package.json
      tsconfig.json
    config/
      src/
        env.ts
        index.ts
      package.json
      tsconfig.json
  .env.example
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  README.md
```

---

## Environment Variables

Create `.env.example` with at least:

```env
NODE_ENV=development
PORT=3000
DATABASE_URL="file:./dev.db"

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

BINANCE_BASE_URL=https://api.binance.com
TRACKED_SYMBOLS=BTCUSDT
ANALYSIS_TIMEFRAME=4h
ANALYSIS_CRON=1 0 */4 * * *

LOG_LEVEL=debug
```

Notes:
- `ANALYSIS_CRON` can be adjusted, but should default to running **slightly after candle close**.
- Use UTC internally unless explicitly configured otherwise.

---

## Database Design

Use Prisma with SQLite first.

### Required models

#### AnalysisRun
Represents one completed analysis execution for one symbol and one timeframe.

Fields:
- `id`
- `symbol`
- `timeframe`
- `candleOpenTime`
- `candleCloseTime`
- `priceOpen`
- `priceHigh`
- `priceLow`
- `priceClose`
- `rawIndicatorsJson`
- `llmInputJson`
- `llmOutputJson`
- `status` (`success` | `failed`)
- `errorMessage` (nullable)
- `createdAt`
- `updatedAt`

#### Signal
Represents the normalized signal extracted from the analysis.

Fields:
- `id`
- `analysisRunId`
- `symbol`
- `timeframe`
- `trend` (`uptrend` | `downtrend` | `sideways`)
- `bias` (`bullish` | `bearish` | `neutral`)
- `confidence`
- `summary`
- `supportLevelsJson`
- `resistanceLevelsJson`
- `invalidation`
- `bullishScenario`
- `bearishScenario`
- `createdAt`

#### Order
Represents a manually entered or future automated order.

Fields:
- `id`
- `signalId` (nullable)
- `source` (`manual` | `auto`)
- `symbol`
- `side` (`long` | `short`)
- `entryPrice`
- `stopLoss` (nullable)
- `takeProfit` (nullable)
- `quantity` (nullable)
- `leverage` (nullable)
- `exchange` (nullable)
- `status` (`open` | `closed` | `cancelled`)
- `openedAt`
- `closedAt` (nullable)
- `closePrice` (nullable)
- `pnl` (nullable)
- `note` (nullable)
- `createdAt`
- `updatedAt`

#### TelegramMessageLog
Represents each Telegram send attempt.

Fields:
- `id`
- `analysisRunId` (nullable)
- `chatId`
- `messageType` (`analysis` | `alert` | `error`)
- `content`
- `success`
- `errorMessage` (nullable)
- `sentAt`
- `createdAt`

### DB requirements

- Add indexes for:
  - `AnalysisRun(symbol, timeframe, candleCloseTime)`
  - `Signal(symbol, timeframe, createdAt)`
  - `Order(symbol, status, openedAt)`
- Add proper foreign keys.
- Use JSON string fields in SQLite where needed.
- Keep the schema easy to migrate to PostgreSQL later.

---

## Domain Flow

### Scheduled analysis flow

1. Cron job triggers.
2. For each configured symbol:
   1. Fetch recent candles from exchange.
   2. Validate candle close timing.
   3. Compute indicators locally.
   4. Create `AnalysisRun` record with initial data.
   5. Build compact LLM input.
   6. Request LLM analysis.
   7. Normalize LLM output into a strict schema.
   8. Save `Signal`.
   9. Update `AnalysisRun` with final output and success state.
   10. Send Telegram message.
   11. Save `TelegramMessageLog`.
3. If any step fails, mark `AnalysisRun.status = failed` and store error.

### Manual order flow

1. User creates order manually via API.
2. API validates payload.
3. API stores `Order`.
4. API returns created order.

### Closing an order

1. User calls close-order endpoint.
2. API updates status to `closed`.
3. API stores close price, closedAt, pnl.

---

## Candle Timing Rules

Implement strict timing logic so the worker does not analyze the wrong candle.

Requirements:
- Use the exchange candle close timestamp.
- Run the cron slightly after the expected close, for example 1 minute later.
- Deduplicate by `symbol + timeframe + candleCloseTime`.
- If the job runs twice for the same closed candle, do not create duplicate analysis runs.
- Prefer safe idempotency over speed.

---

## Exchange Layer Requirements

Create a market data service abstraction.

### Interface

The implementation should expose methods like:
- `getRecentCandles(symbol, timeframe, limit)`
- `getLatestClosedCandle(symbol, timeframe)`
- `isCandleAlreadyProcessed(symbol, timeframe, candleCloseTime)`

### v1 provider

Implement Binance REST support first.

Requirements:
- Fetch enough candles for indicator calculation, e.g. 200 to 300 candles.
- Map raw exchange payloads into internal candle DTOs.
- Handle transient HTTP failures with light retry.
- Add timeout and structured error handling.

---

## Indicator Requirements

Indicators must be computed **locally in code**, not by the LLM.

Implement at least:
- EMA 20
- EMA 50
- EMA 200
- RSI 14
- MACD
- ATR 14
- Volume average / volume ratio
- Simple swing high / swing low detection
- Nearest support / resistance extraction

### Output shape

Return a normalized object like:

```ts
{
  price: {
    open: number;
    high: number;
    low: number;
    close: number;
  };
  ema20: number;
  ema50: number;
  ema200: number;
  rsi14: number;
  macd: {
    macd: number;
    signal: number;
    histogram: number;
  };
  atr14: number;
  volumeRatio: number;
  supportLevels: number[];
  resistanceLevels: number[];
  lastCandles: Array<{ open: number; high: number; low: number; close: number }>;
}
```

---

## LLM Integration Requirements

Create a provider wrapper so the app is not tightly coupled to one SDK.

### Requirements

- Use `OPENAI_API_KEY` and `OPENAI_MODEL` from config.
- Build a compact JSON-based prompt.
- Force a structured output format.
- Validate model output before saving.
- If model output is invalid, either:
  - retry once with a repair prompt, or
  - fail gracefully and mark the run as failed.

### Prompt rules

- Analysis must be in **Vietnamese**.
- Do not invent news.
- Do not calculate indicators in the prompt.
- Use only supplied market data.
- Return concise output.
- Do not guarantee profits.

### Expected structured output

```json
{
  "trend": "uptrend",
  "bias": "bullish",
  "confidence": 78,
  "summary": "...",
  "supportLevels": [67200, 66550],
  "resistanceLevels": [68700, 69500],
  "invalidation": "...",
  "bullishScenario": "...",
  "bearishScenario": "..."
}
```

Use schema validation before persisting.

---

## Telegram Requirements

Create a Telegram service abstraction.

### Requirements

- Send formatted Markdown or HTML messages.
- Support message types:
  - analysis
  - error
- Store every delivery attempt in `TelegramMessageLog`.
- If Telegram send fails, do not crash the whole worker.
- Message formatting must be readable on mobile.

### Example message shape

```text
📊 BTCUSDT - Phân tích nến 4h vừa đóng

Xu hướng: Bullish
Độ tin cậy: 78%

Tóm tắt:
...

Hỗ trợ:
- 67,200
- 66,550

Kháng cự:
- 68,700
- 69,500

Kịch bản chính:
...

Kịch bản ngược:
...

Lưu ý: Đây là phân tích tự động, không phải khuyến nghị đầu tư.
```

---

## API Requirements

Implement the following HTTP endpoints.

### Health
- `GET /health`

### Analysis
- `GET /analysis-runs`
- `GET /analysis-runs/:id`
- `GET /analysis-runs/latest?symbol=BTCUSDT&timeframe=4h`

### Signals
- `GET /signals`
- `GET /signals/:id`
- `GET /signals/latest?symbol=BTCUSDT&timeframe=4h`

### Orders
- `GET /orders`
- `GET /orders/:id`
- `POST /orders`
- `PATCH /orders/:id/close`

### Telegram logs
- `GET /telegram-logs`
- `GET /telegram-logs/:id`

### Optional manual trigger
- `POST /worker/run-analysis`

If you implement manual trigger, protect it behind a basic internal guard or env toggle.

---

## API DTO Requirements

Use explicit DTOs and validation.

### CreateOrder DTO

Fields:
- `symbol`
- `side`
- `entryPrice`
- `stopLoss` (optional)
- `takeProfit` (optional)
- `quantity` (optional)
- `leverage` (optional)
- `exchange` (optional)
- `openedAt` (optional)
- `note` (optional)
- `signalId` (optional)

### CloseOrder DTO

Fields:
- `closePrice`
- `closedAt` (optional)
- `note` (optional)

---

## Worker Requirements

### Scheduling

Implement cron-based scheduling in v1.

Requirements:
- Schedule based on env config.
- Process all configured symbols.
- Prevent duplicate processing.
- Log start/end/error per run.

### Future-ready structure

Structure the worker so it can later switch to BullMQ or another queue without major refactor.

Recommended pattern:
- `AnalysisOrchestratorService`
- `MarketDataService`
- `IndicatorService`
- `PromptBuilderService`
- `LlmService`
- `TelegramService`
- `PersistenceService`

---

## Error Handling Rules

Implement consistent error handling.

Requirements:
- Never let one symbol failure crash the whole scheduled batch.
- Capture and store failure reason.
- Telegram failures should be logged but should not roll back a successful analysis.
- Use structured logging.
- Return normalized API errors.

---

## Idempotency Rules

This is important.

The worker must not create duplicate analysis entries for the same closed candle.

Implement one of these:
- unique DB constraint for `symbol + timeframe + candleCloseTime`
- or existence check before insert
- ideally both

---

## Testing Requirements

Add meaningful tests, not just placeholders.

### Unit tests
- indicator calculations
- support/resistance extraction
- prompt builder
- LLM output normalization
- Telegram message formatter

### Integration tests
- create manual order
- close order
- run one analysis flow with mocked market/LLM/Telegram

Do not overbuild the tests, but cover the core flow.

---

## Code Quality Requirements

- Use strict TypeScript.
- Avoid barrel-file-heavy architecture where it harms clarity.
- Keep modules small and focused.
- Use dependency injection cleanly.
- Avoid putting business logic in controllers.
- Add ESLint and Prettier.
- Add scripts for lint, typecheck, test, dev, and build.

Required root scripts:

```json
{
  "scripts": {
    "dev:api": "pnpm --filter api start:dev",
    "dev:worker": "pnpm --filter worker start:dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "prisma:generate": "pnpm --filter @app/db prisma generate",
    "prisma:migrate": "pnpm --filter @app/db prisma migrate dev"
  }
}
```

---

## Implementation Phases

### Phase 1: workspace scaffold
- Create pnpm workspace
- Create apps and packages folders
- Configure TypeScript base config
- Configure lint/format/test basics

### Phase 2: database
- Add Prisma package
- Define schema
- Generate client
- Add migration
- Add seed or minimal bootstrap if useful

### Phase 3: shared core
- Add market types
- Add indicator services
- Add prompt builder
- Add output schema validation

### Phase 4: worker
- Add cron scheduler
- Add Binance market service
- Add orchestration flow
- Add Telegram integration
- Add persistence flow

### Phase 5: api
- Add NestJS API app
- Add modules for analysis, signals, orders, telegram logs
- Add DTOs and validation

### Phase 6: tests and polish
- Add unit tests
- Add core integration tests
- Improve logs and docs

---

## Deliverables

Codex should produce:

1. Full monorepo scaffold
2. Working Prisma schema and migration
3. Worker that can run one full 4h analysis cycle
4. Telegram integration
5. API endpoints for viewing history
6. Manual order CRUD-lite endpoints
7. `.env.example`
8. README with local setup instructions

---

## README Requirements

README should include:

- project overview
- architecture explanation
- local setup
- env variables
- how to run API
- how to run worker
- how scheduling works
- how candle deduplication works
- example API requests
- future improvements

---

## Important Constraints

- Keep the implementation practical and minimal.
- Do not introduce Redis in v1 unless absolutely needed.
- Do not add authentication unless needed for local admin usage.
- Do not over-engineer the UI.
- Focus on correctness, maintainability, and clean separation between API and worker.

---

## Nice-to-have (only after core works)

- simple web dashboard page
- symbol filter
- basic pagination
- CSV export for orders
- summary stats for win/loss and pnl
- manual “run now” button
- upgrade path to BullMQ-based scheduling

---

## Final Instruction to Codex

Implement this as a clean, production-minded scaffold for a personal project.
Start with the simplest working version that respects the architecture above.
Prefer correct structure and clean boundaries over unnecessary features.
