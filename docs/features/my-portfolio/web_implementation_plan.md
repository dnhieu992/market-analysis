# Coin Portfolio Tracker — Web App Implementation Plan

## Overview

Build the frontend for the portfolio tracker following the existing Feature-Sliced Design:
`shared/api` → `features` (forms) → `widgets` (display) → `_pages` → `app` (routing).

---

## Phase 1: Shared API Layer (`apps/web/src/shared/api`)

### 1.1 Add Types to `types.ts`

New types to add:

| Type | Fields |
|------|--------|
| `Portfolio` | id, name, description, userId, createdAt |
| `CoinTransaction` | id, portfolioId, coinId, type (BUY/SELL), amount, price, totalValue, date, deletedAt |
| `Holding` | portfolioId, coinId, totalAmount, avgCost, totalInvested, realizedPnl |
| `PnlSnapshot` | id, portfolioId, coinId, date, unrealizedPnl, totalValue |

New input types:

| Type | Fields |
|------|--------|
| `CreatePortfolioInput` | name, description? |
| `UpdatePortfolioInput` | name?, description? |
| `CreateTransactionInput` | coinId, type, amount, price, date |
| `QueryTransactionsInput` | coinId?, type?, from?, to? |
| `QueryPnlInput` | from?, to?, coinId? |

- [x] Add `Portfolio`, `CoinTransaction`, `Holding`, `PnlSnapshot` types
- [x] Add input types for portfolio, transaction, pnl queries
- [x] Add `mapPortfolio()`, `mapTransaction()`, `mapHolding()`, `mapPnlSnapshot()` helper functions

### 1.2 Add API Methods to `createApiClient()`

Portfolio endpoints:
- `fetchPortfolios()` → `GET /portfolios`
- `fetchPortfolio(id)` → `GET /portfolios/:id`
- `createPortfolio(input)` → `POST /portfolios`
- `updatePortfolio(id, input)` → `PATCH /portfolios/:id`
- `deletePortfolio(id)` → `DELETE /portfolios/:id`

Transaction endpoints:
- `fetchTransactions(portfolioId, query?)` → `GET /portfolios/:portfolioId/transactions`
- `createTransaction(portfolioId, input)` → `POST /portfolios/:portfolioId/transactions`
- `deleteTransaction(portfolioId, id)` → `DELETE /portfolios/:portfolioId/transactions/:id`

Holdings endpoints:
- `fetchHoldings(portfolioId, prices?)` → `GET /portfolios/:portfolioId/holdings`
- `recalculateHoldings(portfolioId)` → `POST /portfolios/:portfolioId/holdings/recalculate`

PnL endpoints:
- `fetchPnlHistory(portfolioId, query?)` → `GET /portfolios/:portfolioId/pnl`

- [x] Add portfolio API methods
- [x] Add transaction API methods
- [x] Add holdings API methods
- [x] Add PnL API methods

---

## Phase 2: Features (Forms & Dialogs)

Follow the same pattern as `features/create-trade/` and `features/edit-trade/`.

### 2.1 Create Portfolio (`features/create-portfolio/`)

- `create-portfolio-form.tsx` — form with name + description fields
- `create-portfolio.model.ts` — `parseCreatePortfolioFormData()` + `submitCreatePortfolio()`

- [x] Create `features/create-portfolio/create-portfolio-form.tsx`
- [x] Create `features/create-portfolio/create-portfolio.model.ts`

### 2.2 Edit Portfolio (`features/edit-portfolio/`)

- `edit-portfolio-form.tsx` — pre-filled form
- `edit-portfolio.model.ts` — `parseEditPortfolioFormData()` + `submitEditPortfolio()`

- [x] Create `features/edit-portfolio/edit-portfolio-form.tsx`
- [x] Create `features/edit-portfolio/edit-portfolio.model.ts`

### 2.3 Create Transaction (`features/create-transaction/`)

- `create-transaction-form.tsx` — fields: coinId, type (BUY/SELL toggle), amount, price, date
- `create-transaction.model.ts` — parse + submit, passes `portfolioId`

- [x] Create `features/create-transaction/create-transaction-form.tsx`
- [x] Create `features/create-transaction/create-transaction.model.ts`

---

## Phase 3: Widgets (Display Components)

Follow the same pattern as `widgets/trades-history/`.

### 3.1 Portfolios List (`widgets/portfolios-list/`)

- Server component — fetches portfolios via `createServerApiClient()`
- Renders a list/table of portfolios with name, number of coins held, total value
- Inline actions: Edit (dialog), Delete (confirm dialog)
- "New Portfolio" button → opens create dialog
- Each row links to the portfolio detail page (`/portfolio/:id`)

- [x] Create `widgets/portfolios-list/portfolios-list.tsx`

### 3.2 Portfolio Holdings (`widgets/portfolio-holdings/`)

- Client component — receives holdings data as props
- Displays table: coin, amount, avg cost, total invested, unrealized PnL
- "Add Transaction" button → opens create-transaction dialog
- "Recalculate" button → calls `recalculateHoldings()`
- Accepts optional `prices` map prop for unrealized PnL display

- [x] Create `widgets/portfolio-holdings/portfolio-holdings.tsx`

### 3.3 Transactions List (`widgets/portfolio-transactions/`)

- Client component — receives transactions as props, supports filter by coinId/type
- Displays table: date, coin, type (BUY/SELL badge), amount, price, total value
- Delete action (soft-delete with confirm dialog)

- [x] Create `widgets/portfolio-transactions/portfolio-transactions.tsx`

### 3.4 PnL Chart (`widgets/portfolio-pnl/`)

- Client component — receives PnL snapshots as props
- Line chart of portfolio value / unrealized PnL over time (use an existing chart lib if available, otherwise a simple table)
- Filter by coinId or show aggregate

- [x] Create `widgets/portfolio-pnl/portfolio-pnl.tsx`

---

## Phase 4: Pages & Routing

### 4.1 Portfolio List Page

- `_pages/portfolio-page/portfolio-page.tsx` — server component
  - Fetches portfolios via `createServerApiClient()`
  - Renders `<PortfoliosList />`

- `app/portfolio/page.tsx` — re-exports `PortfolioPage`

- [x] Create `_pages/portfolio-page/portfolio-page.tsx`
- [x] Create `app/portfolio/page.tsx`

### 4.2 Portfolio Detail Page

- `_pages/portfolio-detail-page/portfolio-detail-page.tsx` — server component
  - Fetches `portfolio`, `holdings`, `transactions`, `pnlHistory` in parallel
  - Renders `<PortfolioHoldings />`, `<PortfolioTransactions />`, `<PortfolioPnl />`

- `app/portfolio/[id]/page.tsx` — dynamic route, re-exports `PortfolioDetailPage`

- [x] Create `_pages/portfolio-detail-page/portfolio-detail-page.tsx`
- [x] Create `app/portfolio/[id]/page.tsx`

---

## Phase 5: Navigation

### 5.1 Add "Portfolio" to Sidebar

- Edit `widgets/app-shell/sidebar-nav.tsx` — add nav item:
  - Label: `Portfolio`
  - Icon: appropriate icon (e.g. wallet/chart)
  - Route: `/portfolio`

- [x] Edit `widgets/app-shell/sidebar-nav.tsx`

---

## File Checklist

```
apps/web/src/
  shared/api/
    types.ts                                         [DONE]

  features/
    create-portfolio/
      create-portfolio-form.tsx                      [DONE]
      create-portfolio.model.ts                      [DONE]
    edit-portfolio/
      edit-portfolio-form.tsx                        [DONE]
      edit-portfolio.model.ts                        [DONE]
    create-transaction/
      create-transaction-form.tsx                    [DONE]
      create-transaction.model.ts                    [DONE]

  widgets/
    portfolios-list/
      portfolios-list.tsx                            [DONE]
    portfolio-holdings/
      portfolio-holdings.tsx                         [DONE]
    portfolio-transactions/
      portfolio-transactions.tsx                     [DONE]
    portfolio-pnl/
      portfolio-pnl.tsx                              [DONE]
    app-shell/
      sidebar-nav.tsx                                [DONE]

  _pages/
    portfolio-page/
      portfolio-page.tsx                             [DONE]
    portfolio-detail-page/
      portfolio-detail-page.tsx                      [DONE]

  app/
    portfolio/
      page.tsx                                       [DONE]
      [id]/
        page.tsx                                     [DONE]
```
