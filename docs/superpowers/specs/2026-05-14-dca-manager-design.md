# DCA Manager — Design Spec
_Date: 2026-05-14_

## Overview

A standalone DCA (Dollar Cost Averaging) management module for BTC and ETH. The LLM generates a plan of buy/sell zones with capital allocation; the user executes orders manually and ticks them off. At any point, the user can trigger a re-plan and the LLM will improve the current plan based on updated market data and execution history.

The module is separate from the existing Portfolio module in terms of UI and planning logic, but uses Portfolio as a transaction ledger to avoid duplicating accounting logic.

---

## Architecture

```
/dca page (Next.js)
    ↕
DCA API module (NestJS)
    ├── DcaConfig     — budget + portfolio link per coin
    ├── DcaPlan       — LLM-generated plan, one active per coin
    └── DcaPlanItem   — individual buy/sell orders (CRUD)
            ↕
Portfolio / Transaction / Holdings modules (existing)
    — used as transaction ledger when items are executed
            ↕
BinanceMarketDataService (existing)
    — candle data for LLM context
            ↕
LLM module (existing)
    — generates and revises plans
```

---

## Data Model

### DcaConfig
One record per coin. Holds the budget and links to the portfolio used as ledger.

| Column | Type | Notes |
|--------|------|-------|
| id | VARCHAR(36) PK | UUID |
| userId | VARCHAR(36) FK → User | Owner, for auth guard checks |
| coin | ENUM('BTC', 'ETH') | |
| totalBudget | DECIMAL(20,8) | Total capital allocated for this coin's DCA |
| portfolioId | VARCHAR(36) FK → Portfolio | Portfolio used as transaction ledger |
| createdAt | DATETIME | |
| updatedAt | DATETIME | |

UNIQUE KEY on `(userId, coin)` (one config per coin per user).

**Validation:** `PATCH /dca/config/:id` must reject `totalBudget` decreases below current `deployedAmount`.

---

### DcaPlan
Created each time the user generates or re-plans. Previous active plan is archived first.

| Column | Type | Notes |
|--------|------|-------|
| id | VARCHAR(36) PK | UUID |
| dcaConfigId | VARCHAR(36) FK → DcaConfig | |
| status | ENUM('active', 'archived') | Only one active plan per config |
| llmAnalysis | TEXT | Market context, reasoning, estimated duration |
| createdAt | DATETIME | |
| archivedAt | DATETIME | nullable |

---

### DcaPlanItem
Individual buy/sell orders within a plan. Fully CRUD-able by the user.

| Column | Type | Notes |
|--------|------|-------|
| id | VARCHAR(36) PK | UUID |
| dcaPlanId | VARCHAR(36) FK → DcaPlan | |
| type | ENUM('buy', 'sell') | |
| targetPrice | DECIMAL(20,8) | LLM-suggested target price |
| suggestedAmount | DECIMAL(20,8) | Buy = USD to spend; Sell = coin amount to sell |
| note | TEXT | LLM reasoning for this zone (nullable) |
| source | ENUM('llm', 'user') | Who created this item |
| userModified | BOOLEAN | DEFAULT false — true if user edited an LLM item |
| originalTargetPrice | DECIMAL(20,8) | nullable — original LLM value before user edit |
| originalSuggestedAmount | DECIMAL(20,8) | nullable — original LLM value before user edit |
| deletedByUser | BOOLEAN | DEFAULT false — soft delete, kept for LLM context |
| status | ENUM('pending', 'executed', 'skipped') | |
| executedPrice | DECIMAL(20,8) | nullable — actual price when executed |
| executedAmount | DECIMAL(20,8) | nullable — actual coin amount when executed |
| executedAt | DATETIME | nullable — user-provided execution timestamp |
| createdAt | DATETIME | |

**Amount convention:**
- `buy` items: `suggestedAmount` = USD to spend (e.g., $500)
- `sell` items: `suggestedAmount` = coin quantity to sell (e.g., 0.01 BTC)

**Original values:** `originalTargetPrice` and `originalSuggestedAmount` are populated on the first user edit of an LLM-created item. This lets the LLM see what it suggested vs what the user preferred (e.g., "I suggested $72k but user changed to $70k").

---

## Capital Calculation (derived, not stored)

All capital metrics are computed on the fly from Portfolio transactions:

```
deployedAmount = SUM(buy transactions in portfolioId WHERE coin_id = coin)
               - SUM(sell transactions in portfolioId WHERE coin_id = coin)

remaining      = DcaConfig.totalBudget - deployedAmount

runnerAmount   = Portfolio holdings totalAmount (portfolioId + coin_id)
runnerAvgCost  = Portfolio holdings avgCost (portfolioId + coin_id)
```

The Portfolio's own budget field is not used by DCA calculations.

---

## LLM Context

Passed on both initial generate and re-plan:

```
Market data:
  - BTC/ETH candles: 1D (90 candles) + 1W (26 candles) from Binance

Budget state:
  - totalBudget, deployedAmount, remaining

Holdings state:
  - runnerAmount, runnerAvgCost

Current plan items (re-plan only):
  - All items with status: pending / executed / skipped
  - Items soft-deleted by user (deletedByUser=true) — LLM learns from disagreement
  - Items user edited (userModified=true, originalTargetPrice/originalSuggestedAmount vs current values)

History:
  - Executed items from all archived plans for this coin

Output expected:
  - llmAnalysis: overall market context, rationale, estimated duration
  - Array of plan items: type, targetPrice, suggestedAmount, note
```

Re-plan behavior: LLM improves from current state, not a full reset. It should not re-suggest items the user deleted unless market conditions have materially changed (which should be noted in llmAnalysis).

---

## Re-plan vs Re-analyze

| Action | Plan | LLM runs | Output |
|--------|------|----------|--------|
| **Re-plan** | Archives current → creates new | Yes | New set of plan items + llmAnalysis |
| **Re-analyze** | Unchanged | Yes | Updated llmAnalysis text only, no item changes |

Re-analyze is for getting the LLM's current read on the market without committing to a new plan.

---

## Execution Flow

When user ticks a plan item as executed:

```
1. User inputs executedPrice + executedAmount + executedAt (optional, defaults to now)
2. DcaPlanItem → status = 'executed', executedPrice, executedAmount, executedAt set
3. Transaction created in linked Portfolio:
   - portfolioId = DcaConfig.portfolioId
   - coin_id     = DcaConfig.coin
   - type        = DcaPlanItem.type (buy/sell)
   - price       = executedPrice
   - amount      = executedAmount
   - transactedAt = executedAt (so Portfolio records the actual trade time, not the tick time)
4. HoldingsService.updateOnBuy/Sell() runs automatically (existing behavior)
```

---

## API Endpoints

```
GET    /dca/config                          — list all DCA configs (BTC + ETH)
POST   /dca/config                          — create config for a coin
PATCH  /dca/config/:id                      — update totalBudget or portfolioId

GET    /dca/config/:configId/plan/active    — get active plan + items
GET    /dca/config/:configId/plan/history   — list archived plans + items (for review)
POST   /dca/config/:configId/plan/generate  — generate first plan (LLM)
POST   /dca/config/:configId/plan/replan    — archive current + generate new plan (LLM)
POST   /dca/config/:configId/plan/reanalyze — update llmAnalysis only (LLM)

POST   /dca/plan/:planId/items              — add item manually
PATCH  /dca/plan/:planId/items/:itemId      — edit item (sets userModified=true if source=llm)
DELETE /dca/plan/:planId/items/:itemId      — soft delete (sets deletedByUser=true if source=llm, hard delete if source=user)
POST   /dca/plan/:planId/items/:itemId/execute — mark as executed, creates Portfolio transaction
PATCH  /dca/plan/:planId/items/:itemId/skip — mark as skipped
```

---

## UI — `/dca` page

Two side-by-side panels (or tabs on mobile): one for BTC, one for ETH.

Each panel shows:
- Budget summary bar: `Budget $X | Deployed $Y | Remaining $Z`
- Runner summary: `Runner: 0.05 BTC @ avg $72,000`
- LLM Analysis text (collapsible)
- `[Re-analyze]` button — updates analysis only
- Plan items table with columns: Type | Target Price | Amount | Note | Source | Status | Actions
- Source badge per item: `llm` / `llm ✎` (edited) / `user`
- Row actions: edit, skip, execute (opens modal for actual price/amount input), delete
- `[+ Add item]` button at bottom of table
- `[Re-plan]` button — archives current plan, generates new one

Plan items with `deletedByUser=true` are hidden from the UI (soft-deleted, only visible to LLM context).

---

## Source Tracking Matrix

| source | userModified | deletedByUser | UI badge | Meaning |
|--------|-------------|---------------|----------|---------|
| `llm` | false | false | `llm` | LLM created, untouched |
| `llm` | true | false | `llm ✎` | LLM created, user edited |
| `llm` | false | true | hidden | LLM created, user rejected |
| `user` | — | false | `user` | User added manually |

---

## Related Files (planned)

### API
- `apps/api/src/modules/dca/dca.module.ts`
- `apps/api/src/modules/dca/dca.controller.ts`
- `apps/api/src/modules/dca/dca.service.ts`
- `apps/api/src/modules/dca/dca-plan.service.ts`
- `apps/api/src/modules/dca/dca-llm.service.ts`
- `apps/api/src/modules/dca/dto/`

### DB
- `packages/db/prisma/schema.prisma` — add DcaConfig, DcaPlan, DcaPlanItem models
- `packages/db/prisma/migrations/<timestamp>_add_dca_tables/migration.sql`

### Web
- `apps/web/src/app/dca/page.tsx`
- `apps/web/src/_pages/dca-page/dca-page.tsx`
- `apps/web/src/features/dca/`
- `apps/web/src/shared/api/client.ts` — add DCA API methods + mappers

---

## Implementation Checklist

### DB
- [ ] Add `DcaConfig`, `DcaPlan`, `DcaPlanItem` models to `packages/db/prisma/schema.prisma`
- [ ] Run `pnpm prisma:generate` to regenerate Prisma client
- [ ] Create migration file `packages/db/prisma/migrations/<timestamp>_add_dca_tables/migration.sql`

### API
- [ ] Create `DcaModule` with controller, service, dca-plan.service, dca-llm.service
- [ ] Implement `DcaConfig` CRUD endpoints (`GET /dca/config`, `POST`, `PATCH /:id` with budget validation)
- [ ] Implement plan generation endpoint (`POST /dca/config/:configId/plan/generate`)
- [ ] Implement re-plan endpoint (`POST /dca/config/:configId/plan/replan`) — archive + generate
- [ ] Implement re-analyze endpoint (`POST /dca/config/:configId/plan/reanalyze`) — llmAnalysis only
- [ ] Implement plan item CRUD (`POST`, `PATCH`, `DELETE` with soft-delete logic)
- [ ] Implement execute endpoint — tick item + create Portfolio transaction (with executedAt)
- [ ] Implement skip endpoint
- [ ] Implement plan history endpoint (`GET /dca/config/:configId/plan/history`)
- [ ] Register `DcaModule` in `app.module.ts`

### LLM
- [ ] Build LLM prompt for DCA plan generation (market context + budget + holdings + history)
- [ ] Build LLM prompt for re-plan (adds current plan items + user edits/deletions)
- [ ] Build LLM prompt for re-analyze (analysis only, no item output)
- [ ] Integrate with existing LLM module using `tool_use` for structured output

### Web
- [ ] Add `app/dca/page.tsx` route (thin re-export)
- [ ] Build `_pages/dca-page/dca-page.tsx` server component (fetch configs + active plans)
- [ ] Build budget summary bar (Budget / Deployed / Remaining)
- [ ] Build runner summary line
- [ ] Build plan items table with source badges (`llm` / `llm ✎` / `user`)
- [ ] Build execute modal (input executedPrice + executedAmount)
- [ ] Build add/edit item form
- [ ] Wire `[Re-plan]` button
- [ ] Wire `[Re-analyze]` button
- [ ] Add DCA API methods + mappers to `apps/web/src/shared/api/client.ts`
- [ ] Add `/dca` link to navigation
