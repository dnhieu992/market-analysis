# Market Analysis Bot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a pnpm monorepo with a NestJS API, a NestJS worker, shared Prisma/core/config packages, scheduled 4h candle analysis, Telegram delivery, and history/order inspection APIs.

**Architecture:** The system uses one repository and two runnable processes: `apps/api` for HTTP endpoints and `apps/worker` for scheduled analysis. Shared domain logic, configuration, and database access live in `packages/core`, `packages/config`, and `packages/db` so the worker and API stay thin and testable. v1 is API-first and intentionally excludes a browser dashboard.

**Tech Stack:** pnpm workspaces, TypeScript, Node.js, NestJS, Prisma, SQLite, Axios, Zod, Pino, dotenv, Jest, ESLint, Prettier

---

### Task 1: Initialize the monorepo workspace

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.npmrc`
- Create: `.eslintrc.cjs`
- Create: `.prettierrc`

**Step 1: Write the failing check**

Define the expected root scripts and workspace layout in `package.json` and `pnpm-workspace.yaml`, but do not create packages yet.

**Step 2: Run check to verify the workspace is incomplete**

Run: `pnpm -r lint`
Expected: FAIL because no workspace packages exist yet.

**Step 3: Write minimal implementation**

Add:
- workspace package globs for `apps/*` and `packages/*`
- root scripts for `dev:api`, `dev:worker`, `build`, `lint`, `typecheck`, `test`, `prisma:generate`, `prisma:migrate`
- strict shared TypeScript config
- base ESLint and Prettier config
- ignore rules for `node_modules`, build output, Prisma SQLite files, coverage, env files

**Step 4: Run check to verify the root config parses**

Run: `pnpm install`
Expected: PASS with a lockfile and root dependencies installed.

**Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore .npmrc .eslintrc.cjs .prettierrc pnpm-lock.yaml
git commit -m "chore: initialize monorepo workspace"
```

### Task 2: Scaffold the shared config package

**Files:**
- Create: `packages/config/package.json`
- Create: `packages/config/tsconfig.json`
- Create: `packages/config/src/env.ts`
- Create: `packages/config/src/index.ts`
- Create: `packages/config/src/types.ts`
- Test: `packages/config/src/env.spec.ts`

**Step 1: Write the failing test**

Add tests that verify:
- required env keys are validated
- `TRACKED_SYMBOLS` becomes a string array
- cron, timeframe, and log level get defaults
- missing `OPENAI_API_KEY` or Telegram config fails clearly

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @app/config test -- --runInBand`
Expected: FAIL because the package does not exist yet.

**Step 3: Write minimal implementation**

Implement:
- a Zod-backed env schema
- `loadEnv()` and `getConfig()` helpers
- typed config objects for API, worker, market, llm, telegram, and logging

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @app/config test -- --runInBand`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/config
git commit -m "feat: add shared config package"
```

### Task 3: Scaffold the Prisma database package

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/src/repositories/analysis-run.repository.ts`
- Create: `packages/db/src/repositories/signal.repository.ts`
- Create: `packages/db/src/repositories/order.repository.ts`
- Create: `packages/db/src/repositories/telegram-message-log.repository.ts`
- Create: `packages/db/prisma/migrations/<timestamp>_init/migration.sql`
- Test: `packages/db/src/client.spec.ts`

**Step 1: Write the failing test**

Add a basic database package test that asserts:
- the Prisma client can be imported
- repository methods expose the expected functions
- the schema contains a unique candle key and required indexes

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @app/db test -- --runInBand`
Expected: FAIL because the database package is missing.

**Step 3: Write minimal implementation**

Define Prisma models:
- `AnalysisRun`
- `Signal`
- `Order`
- `TelegramMessageLog`

Include:
- enum fields as Prisma enums where practical
- unique constraint on `symbol + timeframe + candleCloseTime`
- indexes from the scaffold
- nullable FKs where required
- JSON-as-string fields for SQLite portability

Add a thin exported Prisma client plus package-level repository helpers shared by both apps.

**Step 4: Run generation and tests**

Run: `pnpm prisma:generate`
Expected: PASS

Run: `pnpm prisma:migrate --name init`
Expected: PASS and create the initial migration.

Run: `pnpm --filter @app/db test -- --runInBand`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/db
git commit -m "feat: add prisma database package"
```

### Task 4: Build the shared core market domain package

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/types/candle.ts`
- Create: `packages/core/src/types/analysis.ts`
- Create: `packages/core/src/types/signal.ts`
- Create: `packages/core/src/constants/timeframes.ts`
- Create: `packages/core/src/indicators/ema.ts`
- Create: `packages/core/src/indicators/rsi.ts`
- Create: `packages/core/src/indicators/macd.ts`
- Create: `packages/core/src/indicators/atr.ts`
- Create: `packages/core/src/indicators/volume.ts`
- Create: `packages/core/src/indicators/support-resistance.ts`
- Create: `packages/core/src/analysis/indicator-snapshot.ts`
- Create: `packages/core/src/prompts/build-analysis-prompt.ts`
- Create: `packages/core/src/validation/llm-signal.schema.ts`
- Create: `packages/core/src/normalizers/normalize-llm-signal.ts`
- Create: `packages/core/src/telegram/format-analysis-message.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/src/indicators/indicator-suite.spec.ts`
- Test: `packages/core/src/indicators/support-resistance.spec.ts`
- Test: `packages/core/src/prompts/build-analysis-prompt.spec.ts`
- Test: `packages/core/src/validation/llm-signal.schema.spec.ts`
- Test: `packages/core/src/telegram/format-analysis-message.spec.ts`

**Step 1: Write the failing tests**

Add unit tests for:
- EMA 20, 50, 200 output shape
- RSI 14 range handling
- MACD structure
- ATR 14 calculation sanity
- volume ratio calculation
- swing high / swing low support and resistance extraction
- prompt builder using only provided market data
- LLM output normalization and schema validation
- Telegram message formatting in Vietnamese-friendly mobile layout

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @app/core test -- --runInBand`
Expected: FAIL because the package is missing.

**Step 3: Write minimal implementation**

Implement:
- candle and signal domain types
- deterministic indicator functions
- `buildIndicatorSnapshot()` returning the normalized indicator object
- prompt builder that creates a compact JSON-based instruction payload
- Zod schema for LLM output
- normalization helper that trims strings and constrains confidence
- Telegram formatter with analysis disclaimer

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @app/core test -- --runInBand`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core
git commit -m "feat: add shared market analysis domain package"
```

### Task 5: Scaffold the API app foundation

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/modules/health/health.module.ts`
- Create: `apps/api/src/modules/health/health.controller.ts`
- Create: `apps/api/src/common/filters/http-exception.filter.ts`
- Create: `apps/api/src/common/interceptors/logging.interceptor.ts`
- Create: `apps/api/src/common/pipes/zod-validation.pipe.ts`
- Create: `apps/api/test/health.e2e-spec.ts`

**Step 1: Write the failing test**

Add an e2e test asserting `GET /health` returns a success payload and the app boots with global validation and logging enabled.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- --runInBand health.e2e-spec.ts`
Expected: FAIL because the API app does not exist yet.

**Step 3: Write minimal implementation**

Implement:
- NestJS bootstrap
- global validation
- normalized error filter
- health module
- logger wiring

**Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- --runInBand health.e2e-spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: scaffold api application"
```

### Task 6: Add read-only analysis and signal API modules

**Files:**
- Create: `apps/api/src/modules/analysis/analysis.module.ts`
- Create: `apps/api/src/modules/analysis/analysis.controller.ts`
- Create: `apps/api/src/modules/analysis/analysis.service.ts`
- Create: `apps/api/src/modules/signals/signals.module.ts`
- Create: `apps/api/src/modules/signals/signals.controller.ts`
- Create: `apps/api/src/modules/signals/signals.service.ts`
- Create: `apps/api/src/modules/analysis/dto/query-analysis-runs.dto.ts`
- Create: `apps/api/src/modules/signals/dto/query-signals.dto.ts`
- Test: `apps/api/test/analysis.e2e-spec.ts`
- Test: `apps/api/test/signals.e2e-spec.ts`

**Step 1: Write the failing tests**

Add e2e tests that verify:
- `GET /analysis-runs`
- `GET /analysis-runs/:id`
- `GET /analysis-runs/latest`
- `GET /signals`
- `GET /signals/:id`
- `GET /signals/latest`

Use mocked repository data first.

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test -- --runInBand analysis.e2e-spec.ts signals.e2e-spec.ts`
Expected: FAIL because the modules are missing.

**Step 3: Write minimal implementation**

Implement controllers and services that query the shared DB package, plus DTO validation for symbol/timeframe filters.

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter api test -- --runInBand analysis.e2e-spec.ts signals.e2e-spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/modules/analysis apps/api/src/modules/signals apps/api/test
git commit -m "feat: add analysis and signals api endpoints"
```

### Task 7: Add orders and Telegram logs API modules

**Files:**
- Create: `apps/api/src/modules/orders/orders.module.ts`
- Create: `apps/api/src/modules/orders/orders.controller.ts`
- Create: `apps/api/src/modules/orders/orders.service.ts`
- Create: `apps/api/src/modules/orders/dto/create-order.dto.ts`
- Create: `apps/api/src/modules/orders/dto/close-order.dto.ts`
- Create: `apps/api/src/modules/telegram-logs/telegram-logs.module.ts`
- Create: `apps/api/src/modules/telegram-logs/telegram-logs.controller.ts`
- Create: `apps/api/src/modules/telegram-logs/telegram-logs.service.ts`
- Test: `apps/api/test/orders.e2e-spec.ts`
- Test: `apps/api/test/telegram-logs.e2e-spec.ts`

**Step 1: Write the failing tests**

Add tests for:
- `GET /orders`
- `GET /orders/:id`
- `POST /orders`
- `PATCH /orders/:id/close`
- `GET /telegram-logs`
- `GET /telegram-logs/:id`

Cover validation failures for missing or malformed order fields.

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test -- --runInBand orders.e2e-spec.ts telegram-logs.e2e-spec.ts`
Expected: FAIL because the modules are missing.

**Step 3: Write minimal implementation**

Implement:
- create order flow
- close order flow with PnL calculation rules documented in service code
- telegram log query endpoints
- DTO validation and normalized errors

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter api test -- --runInBand orders.e2e-spec.ts telegram-logs.e2e-spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/modules/orders apps/api/src/modules/telegram-logs apps/api/test
git commit -m "feat: add orders and telegram logs api endpoints"
```

### Task 8: Scaffold the worker app foundation

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/main.ts`
- Create: `apps/worker/src/worker.module.ts`
- Create: `apps/worker/src/modules/scheduler/scheduler.module.ts`
- Create: `apps/worker/src/modules/scheduler/scheduler.service.ts`
- Create: `apps/worker/src/modules/analysis/analysis.module.ts`
- Create: `apps/worker/src/modules/analysis/analysis-orchestrator.service.ts`
- Create: `apps/worker/test/worker-bootstrap.spec.ts`

**Step 1: Write the failing test**

Add a bootstrap test that asserts the worker app starts as a Nest standalone application and registers a scheduler service.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter worker test -- --runInBand worker-bootstrap.spec.ts`
Expected: FAIL because the worker app does not exist yet.

**Step 3: Write minimal implementation**

Implement:
- worker bootstrap
- scheduler module
- orchestrator service shell
- structured logger setup

**Step 4: Run test to verify it passes**

Run: `pnpm --filter worker test -- --runInBand worker-bootstrap.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat: scaffold worker application"
```

### Task 9: Implement the market data provider and candle timing rules

**Files:**
- Create: `apps/worker/src/modules/market/market.module.ts`
- Create: `apps/worker/src/modules/market/market-data.service.ts`
- Create: `apps/worker/src/modules/market/binance-market-data.service.ts`
- Create: `apps/worker/src/modules/market/dto/binance-kline.dto.ts`
- Create: `apps/worker/src/modules/market/utils/candle-timing.ts`
- Test: `apps/worker/test/market-data.service.spec.ts`
- Test: `apps/worker/test/candle-timing.spec.ts`

**Step 1: Write the failing tests**

Add tests for:
- mapping Binance klines to internal candle DTOs
- retry and timeout handling
- latest closed candle selection
- dedup key derivation by `symbol + timeframe + candleCloseTime`
- rejecting candles that are not closed yet

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter worker test -- --runInBand market-data.service.spec.ts candle-timing.spec.ts`
Expected: FAIL because the market module is missing.

**Step 3: Write minimal implementation**

Implement:
- Axios-based Binance client
- exchange abstraction methods from the scaffold
- strict UTC candle-close checks
- helper for `isCandleAlreadyProcessed`

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter worker test -- --runInBand market-data.service.spec.ts candle-timing.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/worker/src/modules/market apps/worker/test
git commit -m "feat: add binance market data provider"
```

### Task 10: Implement LLM and Telegram integrations

**Files:**
- Create: `apps/worker/src/modules/llm/llm.module.ts`
- Create: `apps/worker/src/modules/llm/llm.service.ts`
- Create: `apps/worker/src/modules/llm/openai-compatible.client.ts`
- Create: `apps/worker/src/modules/telegram/telegram.module.ts`
- Create: `apps/worker/src/modules/telegram/telegram.service.ts`
- Test: `apps/worker/test/llm.service.spec.ts`
- Test: `apps/worker/test/telegram.service.spec.ts`

**Step 1: Write the failing tests**

Add tests for:
- valid structured LLM output
- one retry on invalid structured output
- graceful failure after retry exhaustion
- Telegram send success logging payload
- Telegram failure not throwing from message logging helper

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter worker test -- --runInBand llm.service.spec.ts telegram.service.spec.ts`
Expected: FAIL because the modules are missing.

**Step 3: Write minimal implementation**

Implement:
- OpenAI-compatible wrapper that accepts model and API key from shared config
- prompt submission using the core prompt builder
- Zod validation of model output
- Telegram Bot API client
- non-fatal send behavior and message-type logging support

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter worker test -- --runInBand llm.service.spec.ts telegram.service.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/worker/src/modules/llm apps/worker/src/modules/telegram apps/worker/test
git commit -m "feat: add llm and telegram integrations"
```

### Task 11: Implement persistence and end-to-end analysis orchestration

**Files:**
- Create: `apps/worker/src/modules/persistence/persistence.module.ts`
- Create: `apps/worker/src/modules/persistence/persistence.service.ts`
- Modify: `apps/worker/src/modules/analysis/analysis-orchestrator.service.ts`
- Modify: `apps/worker/src/modules/scheduler/scheduler.service.ts`
- Create: `apps/worker/test/analysis-orchestrator.spec.ts`
- Create: `apps/worker/test/analysis-flow.integration-spec.ts`

**Step 1: Write the failing tests**

Add tests that verify:
- one symbol run creates `AnalysisRun`, `Signal`, and `TelegramMessageLog`
- a duplicate candle does not create a second `AnalysisRun`
- a single symbol failure is recorded as failed without crashing the batch
- Telegram failure still preserves a successful analysis run

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter worker test -- --runInBand analysis-orchestrator.spec.ts analysis-flow.integration-spec.ts`
Expected: FAIL because orchestration is incomplete.

**Step 3: Write minimal implementation**

Implement:
- `PersistenceService` for analysis run lifecycle
- orchestrated analysis flow in the required order
- scheduler loop over configured symbols
- duplicate protection with DB constraint and pre-insert check
- per-symbol try/catch boundaries with structured logging

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter worker test -- --runInBand analysis-orchestrator.spec.ts analysis-flow.integration-spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/worker/src/modules/analysis apps/worker/src/modules/persistence apps/worker/src/modules/scheduler apps/worker/test
git commit -m "feat: implement scheduled analysis orchestration"
```

### Task 12: Add optional manual worker trigger endpoint

**Files:**
- Create: `apps/api/src/modules/worker/worker.module.ts`
- Create: `apps/api/src/modules/worker/worker.controller.ts`
- Create: `apps/api/src/modules/worker/worker.service.ts`
- Create: `apps/api/src/modules/worker/dto/run-analysis.dto.ts`
- Test: `apps/api/test/worker.e2e-spec.ts`

**Step 1: Write the failing test**

Add an e2e test verifying `POST /worker/run-analysis`:
- is disabled by default
- can be enabled with an env toggle
- accepts optional symbol override

**Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- --runInBand worker.e2e-spec.ts`
Expected: FAIL because the worker trigger module is missing.

**Step 3: Write minimal implementation**

Implement:
- env-gated manual trigger endpoint
- service handoff to the worker orchestration path or a shared trigger abstraction
- normalized forbidden response when disabled

**Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- --runInBand worker.e2e-spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/modules/worker apps/api/test/worker.e2e-spec.ts
git commit -m "feat: add optional manual analysis trigger"
```

### Task 13: Add environment template, docs, and repo polish

**Files:**
- Create: `.env.example`
- Modify: `README.md`
- Create: `apps/api/test/orders.integration-spec.ts`
- Create: `apps/worker/test/full-run.smoke-spec.ts`

**Step 1: Write the failing checks**

Add checks that confirm:
- `.env.example` includes all required env vars
- README documents setup, scheduling, deduplication, and example API requests
- order creation and close flow work end to end
- one full worker run can execute against mocked dependencies

**Step 2: Run checks to verify they fail**

Run: `pnpm test`
Expected: FAIL until docs, examples, and remaining tests are in place.

**Step 3: Write minimal implementation**

Add:
- `.env.example` from the approved scaffold
- README sections for overview, architecture, setup, running, API examples, scheduling, deduplication, and future improvements
- final integration coverage for manual orders and worker smoke flow

**Step 4: Run the full verification suite**

Run: `pnpm lint`
Expected: PASS

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm test`
Expected: PASS

Run: `pnpm build`
Expected: PASS

**Step 5: Commit**

```bash
git add .env.example README.md apps/api/test apps/worker/test
git commit -m "docs: finalize setup and verification coverage"
```

### Task 14: Final verification and handoff

**Files:**
- Review only: `package.json`
- Review only: `apps/api/src/main.ts`
- Review only: `apps/worker/src/main.ts`
- Review only: `packages/db/prisma/schema.prisma`
- Review only: `README.md`

**Step 1: Run final verification**

Run: `pnpm lint`
Expected: PASS

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm test`
Expected: PASS

Run: `pnpm build`
Expected: PASS

**Step 2: Manual sanity checks**

Verify:
- API starts with `pnpm dev:api`
- worker starts with `pnpm dev:worker`
- Prisma DB file is created locally
- the worker can process `BTCUSDT` using mocked or live credentials

**Step 3: Prepare handoff notes**

Document:
- any intentional v1 omissions
- how to add symbols
- how to migrate from SQLite to PostgreSQL
- how to replace cron with BullMQ later

**Step 4: Commit**

```bash
git add README.md
git commit -m "chore: finalize market analysis bot scaffold"
```
