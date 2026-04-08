# Market Analysis Bot

A pnpm monorepo for scheduled 4h crypto market analysis with a NestJS API, a NestJS worker, a Next.js dashboard, shared domain packages, Prisma persistence, Telegram delivery, and inspection endpoints for signals, analysis runs, orders, and message logs.

## Overview

The project has two runnable apps:

- `apps/api`: read-heavy HTTP API plus a guarded manual worker trigger
- `apps/worker`: scheduled analysis process that fetches candles, builds indicators, asks the LLM for a structured signal, stores results, and sends Telegram messages
- `apps/web`: dashboard UI for overview metrics, trading history, and structured analysis browsing

Shared packages:

- `packages/config`: environment loading and typed config
- `packages/core`: indicators, prompt building, normalization, and Telegram formatting
- `packages/db`: Prisma schema, client, and repository factories

## Architecture

Analysis flow for one symbol:

1. Worker fetches Binance klines for the configured timeframe.
2. The latest closed candle is selected and deduplicated by `symbol + timeframe + candleCloseTime`.
3. Indicator snapshot is built from recent candles.
4. The LLM returns structured JSON validated with Zod.
5. The analysis run and signal are persisted in MySQL.
6. Telegram delivery is attempted and logged without crashing the batch if send fails.

## Setup

### Requirements

- Node.js 18+
- pnpm 10+
- MySQL 8+

### Local MySQL

The repo is configured to work with a local MySQL database named `market_analysis`.

Example Docker Compose service:

```yaml
services:
  mysql:
    image: mysql:8.4.7
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_ROOT_HOST: "%"
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql

volumes:
  mysql_data:
```

### Environment

Copy values from `.env.example` and fill in real secrets:

```env
DATABASE_URL="mysql://root:root@127.0.0.1:3306/market_analysis"
NEXT_PUBLIC_API_BASE_URL="http://localhost:3000"
OPENAI_API_KEY="your-openai-api-key"
LLM_PROVIDER="claude"
CLAUDE_API_KEY="your-claude-api-key"
CLAUDE_MODEL="sonnet"
CLAUDE_TIMEOUT_MS="60000"
TELEGRAM_BOT_TOKEN="your-telegram-bot-token"
TELEGRAM_CHAT_ID="your-telegram-chat-id"
TRACKED_SYMBOLS="BTCUSDT,ETHUSDT"
MANUAL_ANALYSIS_TRIGGER_ENABLED="false"
```

### Install and migrate

```bash
pnpm install
mysql -h 127.0.0.1 -P 3306 -u root -proot -e 'CREATE DATABASE IF NOT EXISTS market_analysis CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;'
DATABASE_URL="mysql://root:root@127.0.0.1:3306/market_analysis" pnpm --filter @app/db prisma migrate dev --name init
```

## Running

Start the API:

```bash
pnpm dev:api
```

Start the worker:

```bash
pnpm dev:worker
```

Start the dashboard:

```bash
pnpm dev:web
```

The dashboard runs on `http://localhost:3001` and uses the API at `NEXT_PUBLIC_API_BASE_URL`.

Run verification:

```bash
pnpm typecheck
pnpm test
```

## API Examples

Health:

```bash
curl http://localhost:3000/health
```

Latest analysis runs:

```bash
curl http://localhost:3000/analysis-runs/latest
```

Latest signals:

```bash
curl http://localhost:3000/signals/latest
```

Simple chat:

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "system", "content": "You are a concise assistant." },
      { "role": "user", "content": "Summarize what this app does." }
    ]
  }'
```

Create an order:

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","side":"long","entryPrice":68000,"quantity":1}'
```

Close an order:

```bash
curl -X PATCH http://localhost:3000/orders/order-1/close \
  -H "Content-Type: application/json" \
  -d '{"closePrice":69000}'
```

Run worker manually when enabled:

```bash
curl -X POST http://localhost:3000/worker/run-analysis \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT"}'
```

## Dashboard Routes

- `/` - overview dashboard
- `/trades` - trading history and manual trade entry
- `/analysis` - structured analysis feed from signals and analysis runs

## Scheduling

The worker uses `ANALYSIS_CRON`, which defaults to `1 0 */4 * * *`, and the supported timeframe is currently `4h`.

The backend now owns an LLM gateway for structured daily analysis. The current implementation supports:

- `LLM_PROVIDER=claude`
- `CLAUDE_MODEL=sonnet` (default) or `CLAUDE_MODEL=opus`
- `CLAUDE_TIMEOUT_MS=60000` by default, and you can raise it if the provider is slow

The daily-analysis flow is now a two-step pipeline:

1. Build structured `market_data` from D1 and H4 only.
2. Run Analyst, then Validator.
3. Apply deterministic hard checks.
4. Publish either a validated plan or a safe `WAIT` / `NO_TRADE` fallback.

Daily analysis records now store:

- derived technical structure from local candle analysis
- structured AI output for the daily trading plan
- publish status plus pipeline debug payload
- provider metadata such as `llmProvider` and `llmModel`
- a formatted `summary` used for Telegram and compatibility consumers

`H1` is intentionally disabled in this version to keep the breakout-following setup focused and less noisy.

This keeps secrets on the backend and allows future API or web flows to reuse the same gateway without calling providers directly from the browser.

## Deduplication

Duplicate analysis is blocked by:

- a pre-insert lookup in the worker persistence flow
- a database unique constraint on `symbol + timeframe + candleCloseTime`

## Current v1 Omissions

- No browser dashboard
- No real queue system yet
- Manual trigger currently returns queued metadata rather than dispatching to a separate worker process
- Chat is stateless and backend-owned; it does not yet persist conversation history or execute DB tools
- Runtime constructors use safe env fallbacks for test/bootstrap friendliness, while the shared config package still provides strict validation for real app config

## Future Improvements

- Replace the manual trigger stub with a real worker handoff
- Move scheduling and retries to BullMQ
- Add richer order lifecycle tracking
- Add PostgreSQL support if MySQL becomes limiting

## Notes For Operators

- To add symbols, update `TRACKED_SYMBOLS` with a comma-separated list such as `BTCUSDT,ETHUSDT,SOLUSDT`.
- To migrate to PostgreSQL later, change the Prisma datasource, update `DATABASE_URL`, regenerate migrations, and revisit MySQL-specific column choices.
- Telegram send failures are intentionally non-fatal and still preserve successful analysis runs.
