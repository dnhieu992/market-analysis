# Compound Interest Feature

A standalone portfolio management system that mirrors the Portfolio feature with completely separate database tables, API routes, and UI components.

## Overview

The Compound Interest page allows users to manage coin holdings and transactions in a separate context from the main Portfolio. It has the same full-featured workflow:

- List compound portfolios
- View holdings per portfolio with real-time P&L
- View per-coin detail with transaction history
- Add/remove buy and sell transactions
- Automatic holdings recalculation after transaction changes

## Architecture

### Database Models

Three new Prisma models isolated from the portfolio models:

| Model | Table | Purpose |
|-------|-------|---------|
| `CompoundPortfolio` | `compound_portfolios` | Portfolio container per user |
| `CompoundTransaction` | `compound_transactions` | Buy/sell records with soft-delete |
| `CompoundHolding` | `compound_holdings` | Aggregated position per coin |

All three models cascade-delete from `CompoundPortfolio`. The `User` model has a `compoundPortfolios` relation.

**Run migration after schema changes:**
```bash
cd packages/db
npx prisma migrate dev --name add-compound-interest
```

### DB Repositories (`packages/db/src/repositories/`)

| File | Purpose |
|------|---------|
| `compound-portfolio.repository.ts` | CRUD for `CompoundPortfolio` |
| `compound-transaction.repository.ts` | Transaction queries with soft-delete support |
| `compound-holding.repository.ts` | Holding upsert, update, and query |

Exported from `packages/db/src/index.ts`.

### API Modules (`apps/api/src/modules/`)

Three NestJS modules under `/compound-portfolios` routes:

#### `compound-portfolio`
- `GET    /compound-portfolios` — list user's portfolios
- `POST   /compound-portfolios` — create portfolio
- `GET    /compound-portfolios/:id` — get single portfolio
- `PATCH  /compound-portfolios/:id` — update name/description
- `DELETE /compound-portfolios/:id` — delete (cascades holdings + transactions)

#### `compound-holdings`
- `GET  /compound-portfolios/:portfolioId/holdings` — get holdings (optional `?prices={}`)
- `POST /compound-portfolios/:portfolioId/holdings/recalculate` — replay transactions

#### `compound-transaction`
- `GET    /compound-portfolios/:portfolioId/transactions` — list transactions (filterable by `coinId`, `type`, `from`, `to`)
- `POST   /compound-portfolios/:portfolioId/transactions` — create buy/sell
- `DELETE /compound-portfolios/:portfolioId/transactions/:id` — soft-delete + recalculate holdings

All routes are protected by the global `AuthGuard`. Authorization is checked per-portfolio (userId must match).

### Holdings Calculation

The `CompoundHoldingsService` uses the **average cost method**:

- **Buy**: `newAvgCost = (totalCost + newValue) / newTotalAmount`
- **Sell**: `realizedPnl += (salePrice - avgCost) * amount`, avgCost unchanged
- **Recalculate**: Full replay of all non-deleted transactions in chronological order (idempotent)

P&L is split into:
- **Unrealized**: `(currentPrice - avgCost) × totalAmount` — fetched from Binance at render time
- **Realized**: accumulated from past sell transactions

### Frontend

#### Routes

| URL | Component | Description |
|-----|-----------|-------------|
| `/compound-interest` | `CompoundInterestPage` | Portfolio list |
| `/compound-interest/[id]` | `CompoundInterestDetailPage` | Holdings list for a portfolio |
| `/compound-interest/[id]/[coinId]` | `CompoundInterestCoinPage` | Coin detail + transactions |

#### File Locations

**Pages** (`apps/web/src/_pages/`):
- `compound-interest-page/compound-interest-page.tsx`
- `compound-interest-detail-page/compound-interest-detail-page.tsx`
- `compound-interest-coin-page/compound-interest-coin-page.tsx`

**App Router** (`apps/web/src/app/`):
- `compound-interest/page.tsx`
- `compound-interest/[id]/page.tsx`
- `compound-interest/[id]/[coinId]/page.tsx`

**Widgets** (`apps/web/src/widgets/`):
- `compound-portfolios-list/compound-portfolios-list.tsx` — Portfolio list with create/edit/delete dialogs
- `compound-holdings-list/compound-holdings-list.tsx` — Holdings table with stats panel
- `compound-coin-detail/compound-coin-detail.tsx` — Coin detail with transaction table

**Features** (`apps/web/src/features/`):
- `create-compound-portfolio/` — form + model
- `edit-compound-portfolio/` — form + model
- `create-compound-transaction/` — form + model

#### API Client Methods

New methods added to `createApiClient()` in `apps/web/src/shared/api/client.ts`:

```typescript
fetchCompoundPortfolios(): Promise<CompoundPortfolio[]>
fetchCompoundPortfolio(id): Promise<CompoundPortfolio>
createCompoundPortfolio(input): Promise<CompoundPortfolio>
updateCompoundPortfolio(id, input): Promise<CompoundPortfolio>
deleteCompoundPortfolio(id): Promise<void>

fetchCompoundTransactions(portfolioId, query?): Promise<CompoundTransaction[]>
createCompoundTransaction(portfolioId, input): Promise<CompoundTransaction>
deleteCompoundTransaction(portfolioId, id): Promise<void>

fetchCompoundHoldings(portfolioId, prices?): Promise<CompoundHolding[]>
recalculateCompoundHoldings(portfolioId): Promise<void>
```

#### New Types (`apps/web/src/shared/api/types.ts`)

- `CompoundPortfolio`
- `CompoundTransaction`
- `CompoundHolding`
- `CreateCompoundPortfolioInput`
- `UpdateCompoundPortfolioInput`
- `CreateCompoundTransactionInput`
- `QueryCompoundTransactionsInput`

## Getting Started

1. **Run the database migration:**
   ```bash
   cd packages/db
   npx prisma migrate dev --name add-compound-interest
   ```

2. **Regenerate the Prisma client:**
   ```bash
   npx prisma generate
   ```

3. **Restart the API server** — new modules are auto-registered in `AppModule`.

4. **Navigate to `/compound-interest`** in the web app to use the feature.

## Data Isolation

The compound interest data is **completely separate** from portfolio data:
- Different database tables (`compound_*` prefix)
- Different API base path (`/compound-portfolios` vs `/portfolios`)
- Different URL routes (`/compound-interest` vs `/portfolio`)
- Different TypeScript types and API client methods
- No shared business logic or repositories

This means users can have the same coin (e.g., BTC) tracked in both Portfolio and Compound Interest independently.
