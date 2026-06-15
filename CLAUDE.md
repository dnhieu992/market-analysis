# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Backtesting

When the user asks to **backtest** anything, ALWAYS:
1. Read `claude-backtest/README.md` first — it documents the user's preferred flow
   (UTBot trend **stop-and-reverse on candle close**, always in market) and the run scripts.
2. Run the appropriate script in `scripts/` (no API/auth needed; fetches public Binance klines).
   The flow script is `scripts/run-flip-backtest.ts`; the in-repo engine runner is `scripts/run-backtest.ts`.
3. **Write a summary of every run** to `claude-backtest/runs/<YYYY-MM-DD>-<slug>.md` (see existing files for format).

User's real trading fee is **0.05%/side** (0.1% per round-trip). Default capital assumption: **$1000 compounded**.

## Commands

```bash
# Install dependencies
pnpm install

# Dev (individual apps)
pnpm dev:api        # NestJS API on :3000
pnpm dev:worker     # NestJS Worker
pnpm dev:web        # Next.js dashboard on :3001

# Type-check all
pnpm typecheck

# Test all
pnpm test

# Test single workspace
pnpm --filter worker test
pnpm --filter api test

# Lint all
pnpm lint

# Build all (required before deploy)
pnpm -r build

# Prisma
pnpm prisma:generate          # regenerate client after schema changes
pnpm prisma:migrate           # dev migration (creates migration file)
pnpm --filter @app/db exec prisma migrate deploy   # production migration

# Deploy (runs on server: pull → install → migrate → build → pm2 restart)
./deploy.sh

# Manual build order (when NOT using deploy.sh)
# MUST build shared packages before apps — API/worker use compiled dist/ from core
pnpm --filter @app/core build          # 1. build core first
pnpm --filter @app/db build            # 2. build db
pnpm --filter api build                # 3. then API
pnpm --filter worker build             # 3. and/or worker
set -a && source .env && set +a && pnpm --filter web build  # web needs env vars at build time

# After any manual build, restart the affected pm2 process:
pm2 restart market-api                 # after API changes
pm2 restart market-worker              # after worker changes
pm2 restart market-web                 # after web changes
```

## Build & Deploy Rules

**Always use `./deploy.sh` for production deploys.** It handles the full pipeline:
1. `git pull` — pull latest code
2. `pnpm install --frozen-lockfile` — install deps
3. `pnpm prisma:generate` — regenerate Prisma client
4. `pnpm --filter @app/db exec prisma migrate deploy` — apply DB migrations
5. `pnpm -r build` — build ALL packages in correct dependency order
6. `pm2 restart` for each process: `market-api` (:3000), `market-worker`, `market-web` (:3001)

**Manual builds must respect dependency order.** `@app/core` and `@app/db` are shared packages consumed by API and worker as compiled `dist/`. If you add a new export to `@app/core` and only run `pnpm --filter api build`, the runtime will throw "X is not a function" because API's dist still references the old core dist. Always build shared packages first, or use `pnpm -r build` to build everything in order.

**Web builds require env vars.** `NEXT_PUBLIC_*` vars are baked into the JS bundle at build time. The `.env` file lives at the monorepo root but Next.js reads from `apps/web/`. A permanent fix is `apps/web/.env.local` (already exists). For manual builds without `deploy.sh`, source the root `.env` first: `set -a && source .env && set +a && pnpm --filter web build`.

## Architecture

**pnpm monorepo** with three apps and three shared packages. Package manager: `pnpm@10`.

### Apps

| App | Framework | Role |
|-----|-----------|------|
| `apps/api` | NestJS + Express | Read-heavy REST API, auth, order management, manual worker trigger |
| `apps/worker` | NestJS (no HTTP) | Scheduled analysis, Telegram polling, swing PA bot |
| `apps/web` | Next.js | Dashboard UI (overview, trades, analysis, login) |

### Shared Packages

| Package | Name | Contents |
|---------|------|----------|
| `packages/core` | `@app/core` | Candle types, indicators, prompt builders, Telegram formatters, Zod validation |
| `packages/db` | `@app/db` | Prisma schema (MySQL), client, repository factories |
| `packages/config` | `@app/config` | Typed env config with strict validation |

### Worker Modules (`apps/worker/src/modules/`)

- **scheduler** — cron jobs: daily signal at `0 0 * * *` UTC, 4H EMA signal at `1 0 */4 * * *`
- **analysis** — `AnalysisOrchestratorService` → fetches candles → builds indicators → calls LLM → persists; also hosts `SwingPaService` and `SwingPaReviewService` (Claude API review in Vietnamese)
- **swing-pa** logic is in `analysis/`: `swing-pa-analyzer.ts`, `swing-pa-formatter.ts`, `swing-pa-chart.ts`, `swing-pa.service.ts`, `swing-pa-review.service.ts`
- **ema-signal** — `TelegramPollingService` handles long-polling; regex `/([A-Z0-9]+)\s+swing/i` routes to `SwingPaService`
- **market** — `BinanceMarketDataService` fetches public Binance klines (`1d`, `4h`, `1w`, etc.)
- **llm** — Claude API gateway, supports `claude-sonnet-4-6` (default) or `claude-opus-4-6`; uses `tool_use` for structured output
- **telegram** — `TelegramService.sendToChat()` / `sendPhotoToChat()`; messages auto-chunked at 4096 chars
- **visual-analysis** — chart rendering with `chartjs-node-canvas`

### API Modules (`apps/api/src/modules/`)

Auth (`/auth/*`), signals, analysis-runs, orders (with images via Cloudinary), daily-analysis, back-test, portfolio, PnL, holdings, chat (stateless LLM proxy), settings, telegram-logs, worker trigger.

All routes except `/health` and `/auth/*` are protected by session cookie auth.

### Analysis Pipeline (4H scheduled)

1. Fetch Binance klines → deduplicate by `symbol + timeframe + candleCloseTime`
2. Build indicator snapshot from `@app/core`
3. LLM Analyst → LLM Validator (two-step) → deterministic hard checks
4. Persist `AnalysisRun` + `Signal` to MySQL
5. Send formatted Telegram message (non-fatal on failure)

### Swing PA Bot (on-demand via Telegram)

Triggered by `/BTCUSDT swing` → fetches 1D/4H/1W candles → pure price action analysis (no indicators, only HH/HL structure, weekly S/R zones, volume) → renders PNG chart → Claude review (`SwingPaReviewService`, responds in Vietnamese) → sends 2-section HTML message + chart image.

### Database

MySQL 8, Prisma ORM. Key models: `AnalysisRun` (unique on `symbol+timeframe+candleCloseTime`), `Signal`, `Order` (supports images as JSON), `DailyAnalysis`, `User`, `TelegramMessageLog`.

After any schema change:
1. Run `pnpm prisma:generate` to regenerate the TypeScript client.
2. **Always create a migration file manually** in `packages/db/prisma/migrations/<timestamp>_<description>/migration.sql`. Use the format `YYYYMMDDHHMMSS` for the timestamp. `pnpm prisma:generate` does NOT create migration files — only `pnpm prisma:migrate` does, and that requires a live `DATABASE_URL` which is not available locally. Without a migration file, `prisma migrate deploy` on the server will report "no pending migrations" and the schema change will never reach the database.

Migration file template for adding a column:
```sql
-- AlterTable
ALTER TABLE `ModelName` ADD COLUMN `columnName` COLUMN_TYPE NOT NULL DEFAULT value;
```

### Production

Managed by **pm2**. Process names: `market-api`, `market-worker`, `market-web`. Deploy via `./deploy.sh` from repo root on the server.

## Feature Documentation

Whenever a new feature is implemented or an existing feature is modified, create or update a markdown file in `docs/features/`. Use one file per feature, named after the feature (e.g., `docs/features/swing-pa-telegram/swing-pa-telegram.md`).

Required format:

```markdown
## Description
_Brief explanation of what the feature does and why it exists._

## Main Flow
_Step-by-step description of the happy path, from trigger to output._

## Edge Cases
- _List known edge cases and how they are handled._

## Related Files (FE / BE / Worker)
- `path/to/file.ts` — what it does in this feature
```

Rules:
- Update the doc in the same commit as the code change.
- Include files from all affected layers (API, Worker, Web) under **Related Files**.
- If a doc already exists for the feature, update it rather than creating a new one.

---

## NestJS Conventions (API & Worker)

### Module structure
Every feature lives in its own module folder: `controller.ts`, `service.ts`, `module.ts`, and a `dto/` subfolder. Register new modules in `app.module.ts` (API) or the relevant parent module (Worker).

### Auth
`AuthGuard` is registered as a global `APP_GUARD`. All routes are protected by default. To make a route public, decorate with `@Public()` (uses `PUBLIC_ROUTE_KEY` reflector metadata). Never bypass the guard by removing it from `AppModule`.

### Controllers
- Use `@ApiTags`, `@ApiOperation`, and `@ApiCookieAuth('market_analysis_session')` on every controller for Swagger.
- Use NestJS HTTP decorators (`@Get`, `@Post`, `@Patch`, `@Delete`) and inject services via `@Inject(ServiceClass)` in the constructor.
- Keep controllers thin — no business logic, only call service methods and return results directly.

### Services
- Annotate with `@Injectable()`. All dependencies injected via constructor.
- External HTTP calls (Binance, Claude API, Telegram) use `axios` directly (not `HttpModule`) — see `BinanceMarketDataService` and `SwingPaReviewService` as reference.
- LLM calls use `tool_use` / `tool_choice: { type: 'tool', name }` for structured output. Always wrap in try/catch with a timeout and return `null` on failure (non-fatal pattern).
- Telegram send failures must never throw — log with `Logger.warn()` and continue.

### DTOs
Use `class-validator` decorators on DTOs. The API uses `ValidationPipe` globally. Keep DTOs in a `dto/` subfolder per module.

### Cron jobs
Defined with `@Cron()` in `SchedulerService`. Always specify `timeZone: 'UTC'`. Add new scheduled tasks there, not in individual services.

---

## Next.js Conventions (Web)

### Page routing
App Router (`apps/web/src/app/`). Each route folder contains a `page.tsx` that is a thin re-export:
```ts
export { default } from '@web/pages/my-page/my-page';
```
The actual implementation lives under `src/pages/<page-name>/`. This keeps `app/` clean and page logic independently testable.

### Server vs Client components
- `app/` pages and layouts are **Server Components** by default — fetch data directly with `createApiClient({ headers })` using the request cookie from `next/headers`.
- Interactive components (forms, state, event handlers) must have `'use client'` at the top.
- Never call the API from a Client Component on initial render — pass data as props from the Server Component parent.

### API client
All API calls go through `createApiClient()` from `@web/shared/api/client`. The client uses `credentials: 'include'` by default to forward the session cookie. Responses are mapped through typed `map*` functions (e.g., `mapOrder`, `mapSignal`) — add a mapper for every new resource type.

### Testing pages
Page tests use `renderToStaticMarkup` (not `@testing-library/react`) to test Server Components. Mock `next/headers` and `createApiClient`:
```ts
jest.mock('next/headers', () => ({
  headers: jest.fn(() => new Headers({ cookie: 'market_analysis_session=test-token' }))
}));
jest.mock('@web/shared/api/client', () => ({ createApiClient: jest.fn() }));
```

### Auth / middleware
`middleware.ts` checks the `market_analysis_session` cookie and redirects unauthenticated requests to `/login`. Protected pages do not need their own auth checks.

### Path aliases
- `@web/*` → `src/*` (configured in `tsconfig.json`)
- Use `@web/shared/api/client`, `@web/features/...`, `@web/components/...`, `@web/widgets/...` — never use relative `../../../` imports across layer boundaries.

---

## Key Env Vars

```env
DATABASE_URL                    # MySQL connection string
CLAUDE_API_KEY                  # Anthropic key (worker LLM + swing PA review)
CLAUDE_MODEL                    # "sonnet" (default) | "opus"
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
TRACKED_SYMBOLS                 # comma-separated, e.g. "BTCUSDT,ETHUSDT"
ANALYSIS_CRON                   # defaults to "1 0 */4 * * *"
MANUAL_ANALYSIS_TRIGGER_ENABLED # "true" to enable POST /worker/run-analysis
```
