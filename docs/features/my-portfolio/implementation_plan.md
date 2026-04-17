# Coin Portfolio Tracker — Implementation Plan

## Overview

Implement portfolio tracking (buy/sell coins, avg cost, PnL) as 4 NestJS modules in `apps/api`, backed by 4 new Prisma/MySQL tables.

Auth is already implemented — all new routes are protected by the existing `AuthGuard`.

---

## Phase 1: Database Layer (`packages/db`)

### 1.1 Prisma Schema — Add 4 models

| Model | Table | Notes |
|-------|-------|-------|
| `Portfolio` | `portfolios` | FK → `users` |
| `CoinTransaction` | `transactions` | soft-delete via `deletedAt` |
| `Holding` | `holdings` | UNIQUE on `(portfolioId, coinId)` |
| `PnlHistory` | `pnl_history` | UNIQUE on `(portfolioId, coinId, date)` |

Also add `portfolios Portfolio[]` relation to existing `User` model.

- [ ] Edit `packages/db/prisma/schema.prisma` — add 4 models + `User` relation

### 1.2 Migration

File: `packages/db/prisma/migrations/20260416200000_add_portfolio_tracker/migration.sql`

Creates the 4 tables with indexes, foreign keys, and constraints per spec.

- [ ] Create migration SQL file

### 1.3 Repositories

| File | Methods |
|------|---------|
| `portfolio.repository.ts` | create, findById, listByUserId, update, remove |
| `coin-transaction.repository.ts` | create, findById, listByPortfolio, softDelete |
| `holding.repository.ts` | upsert, findByPortfolioAndCoin, listByPortfolio, deleteByPortfolio |
| `pnl-history.repository.ts` | upsertSnapshot, listByPortfolio |

Export all from `packages/db/src/index.ts`.

- [ ] Create `portfolio.repository.ts`
- [ ] Create `coin-transaction.repository.ts`
- [ ] Create `holding.repository.ts`
- [ ] Create `pnl-history.repository.ts`
- [ ] Edit `packages/db/src/index.ts` — export all repositories

---

## Phase 2: API Layer (`apps/api`)

### 2.1 Dependency — add `@nestjs/schedule`

Add to `apps/api/package.json` for the daily PnL cron job.

> Run `pnpm install` after files are created.

- [ ] Edit `apps/api/package.json` — add `@nestjs/schedule`

### 2.2 Database Providers

Add 4 new symbols + provider entries to `database.providers.ts`:
- `PORTFOLIO_REPOSITORY`
- `COIN_TRANSACTION_REPOSITORY`
- `HOLDING_REPOSITORY`
- `PNL_HISTORY_REPOSITORY`

- [ ] Edit `apps/api/src/modules/database/database.providers.ts`

### 2.3 Modules

#### PortfolioModule (`/portfolios`)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/portfolios` | List user's portfolios |
| POST | `/portfolios` | Create portfolio |
| GET | `/portfolios/:id` | Get portfolio with summary |
| PATCH | `/portfolios/:id` | Update portfolio |
| DELETE | `/portfolios/:id` | Delete portfolio |

- Ownership validation: only portfolios owned by `authUser.id` are accessible.

- [ ] Create `portfolio.module.ts`
- [ ] Create `portfolio.service.ts`
- [ ] Create `portfolio.controller.ts`
- [ ] Create `dto/create-portfolio.dto.ts`
- [ ] Create `dto/update-portfolio.dto.ts`

#### TransactionModule (`/portfolios/:portfolioId/transactions`)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/portfolios/:portfolioId/transactions` | List transactions (filter: coinId, type, from, to) |
| POST | `/portfolios/:portfolioId/transactions` | Create buy/sell transaction |
| DELETE | `/portfolios/:portfolioId/transactions/:id` | Soft-delete → recalculate holdings |

- BUY flow: insert → `HoldingsService.updateOnBuy()` (in DB transaction)
- SELL flow: validate amount ≤ holdings.totalAmount → insert → `HoldingsService.updateOnSell()` (in DB transaction)
- DELETE: soft-delete → `HoldingsService.recalculate(portfolioId, coinId)`

- [ ] Create `transaction.module.ts`
- [ ] Create `transaction.service.ts`
- [ ] Create `transaction.controller.ts`
- [ ] Create `dto/create-transaction.dto.ts`
- [ ] Create `dto/query-transactions.dto.ts`

#### HoldingsModule (`/portfolios/:portfolioId/holdings`)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/portfolios/:portfolioId/holdings` | List holdings with unrealized PnL |
| POST | `/portfolios/:portfolioId/holdings/recalculate` | Recalculate from transactions |

- `GET` accepts `prices` query param as JSON map `{ "BTC": 50000, "ETH": 3000 }` for unrealized PnL calculation.
- `updateOnBuy(portfolioId, coinId, amount, totalValue)`: upsert holding
- `updateOnSell(portfolioId, coinId, amount, price)`: update realized PnL, reduce amount/cost
- `recalculate(portfolioId, coinId?)`: replay all non-deleted transactions in time order

- [ ] Create `holdings.module.ts`
- [ ] Create `holdings.service.ts`
- [ ] Create `holdings.controller.ts`

#### PnlModule (`/portfolios/:portfolioId/pnl`)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/portfolios/:portfolioId/pnl` | Get PnL history (query: from, to, coinId) |

- Cron job: `@Cron('0 23 * * *')` → `snapshotDaily()`
  - For each portfolio + each coin in holdings: fetch latest Binance price (symbol + USDT), compute unrealized PnL, insert snapshot.
  - Also insert one aggregate snapshot per portfolio (coinId = null).

- [ ] Create `pnl.module.ts`
- [ ] Create `pnl.service.ts`
- [ ] Create `pnl.controller.ts`
- [ ] Create `dto/query-pnl.dto.ts`

### 2.4 App Module

Register in `app.module.ts`:
- `PortfolioModule`
- `TransactionModule`
- `HoldingsModule`
- `PnlModule`

Also add `ScheduleModule.forRoot()` to `app.module.ts` imports.

- [ ] Edit `apps/api/src/app.module.ts`

---

## Post-Implementation Steps

- [ ] Run `pnpm install` to install `@nestjs/schedule`
- [ ] Run `prisma migrate deploy` (or `prisma db push` for dev) to apply migrations
- [ ] Run `prisma generate` to regenerate the Prisma client
