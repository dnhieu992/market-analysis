# DCA Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone DCA management module for BTC/ETH with LLM-powered plan generation, manual execution tracking, and Portfolio integration for transactions.

**Architecture:** New `DcaModule` in the API app with 3 Prisma models (`DcaConfig`, `DcaPlan`, `DcaPlanItem`), a Claude API-based LLM service for plan generation, and a Next.js page at `/dca`. Uses existing Portfolio/Transaction/Holdings modules as transaction ledger when items are executed.

**Tech Stack:** NestJS, Prisma (MySQL), Claude API (tool_use), Next.js App Router, TypeScript

**Spec:** `docs/features/dca-manager/dca-manager.md`

---

## File Structure

### DB Layer (`packages/db/`)
- Create: `packages/db/src/repositories/dca-config.repository.ts`
- Create: `packages/db/src/repositories/dca-plan.repository.ts`
- Create: `packages/db/src/repositories/dca-plan-item.repository.ts`
- Modify: `packages/db/prisma/schema.prisma` — add 3 models
- Modify: `packages/db/src/index.ts` — export new repositories
- Create: `packages/db/prisma/migrations/20260514120000_add_dca_tables/migration.sql`

### API Layer (`apps/api/src/modules/`)
- Create: `apps/api/src/modules/dca/dto/create-dca-config.dto.ts`
- Create: `apps/api/src/modules/dca/dto/update-dca-config.dto.ts`
- Create: `apps/api/src/modules/dca/dto/create-plan-item.dto.ts`
- Create: `apps/api/src/modules/dca/dto/update-plan-item.dto.ts`
- Create: `apps/api/src/modules/dca/dto/execute-plan-item.dto.ts`
- Create: `apps/api/src/modules/dca/dca.service.ts`
- Create: `apps/api/src/modules/dca/dca-plan.service.ts`
- Create: `apps/api/src/modules/dca/dca-llm.service.ts`
- Create: `apps/api/src/modules/dca/dca.controller.ts`
- Create: `apps/api/src/modules/dca/dca.module.ts`
- Modify: `apps/api/src/modules/database/database.providers.ts` — add DCA repository tokens
- Modify: `apps/api/src/app.module.ts` — register DcaModule

### Web Layer (`apps/web/src/`)
- Create: `apps/web/src/app/dca/page.tsx`
- Create: `apps/web/src/_pages/dca-page/dca-page.tsx`
- Create: `apps/web/src/widgets/dca-panel/dca-panel.tsx`
- Create: `apps/web/src/widgets/dca-panel/plan-items-table.tsx`
- Create: `apps/web/src/widgets/dca-panel/execute-modal.tsx`
- Create: `apps/web/src/widgets/dca-panel/add-edit-item-modal.tsx`
- Modify: `apps/web/src/shared/api/types.ts` — add DCA types
- Modify: `apps/web/src/shared/api/client.ts` — add DCA API methods + mappers
- Modify: `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — add /dca nav link

---

## Task 1: Prisma Schema + Migration + Repositories

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260514120000_add_dca_tables/migration.sql`
- Create: `packages/db/src/repositories/dca-config.repository.ts`
- Create: `packages/db/src/repositories/dca-plan.repository.ts`
- Create: `packages/db/src/repositories/dca-plan-item.repository.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Add Prisma models to schema.prisma**

Append these models after the existing `PnlHistory` model:

```prisma
model DcaConfig {
  id          String    @id @default(uuid()) @db.Char(36)
  userId      String
  coin        String    @db.VarChar(10)
  totalBudget Decimal   @db.Decimal(20, 8)
  portfolioId String    @db.Char(36)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  portfolio   Portfolio @relation(fields: [portfolioId], references: [id], onDelete: Cascade)
  plans       DcaPlan[]

  @@unique([userId, coin])
  @@index([userId])
  @@map("dca_configs")
}

model DcaPlan {
  id           String        @id @default(uuid()) @db.Char(36)
  dcaConfigId  String        @db.Char(36)
  status       String        @db.VarChar(20)
  llmAnalysis  String?       @db.Text
  createdAt    DateTime      @default(now())
  archivedAt   DateTime?
  dcaConfig    DcaConfig     @relation(fields: [dcaConfigId], references: [id], onDelete: Cascade)
  items        DcaPlanItem[]

  @@index([dcaConfigId, status])
  @@map("dca_plans")
}

model DcaPlanItem {
  id                      String    @id @default(uuid()) @db.Char(36)
  dcaPlanId               String    @db.Char(36)
  type                    String    @db.VarChar(10)
  targetPrice             Decimal   @db.Decimal(20, 8)
  suggestedAmount         Decimal   @db.Decimal(20, 8)
  note                    String?   @db.Text
  source                  String    @db.VarChar(10)
  userModified            Boolean   @default(false)
  originalTargetPrice     Decimal?  @db.Decimal(20, 8)
  originalSuggestedAmount Decimal?  @db.Decimal(20, 8)
  deletedByUser           Boolean   @default(false)
  status                  String    @default("pending") @db.VarChar(20)
  executedPrice           Decimal?  @db.Decimal(20, 8)
  executedAmount          Decimal?  @db.Decimal(20, 8)
  executedAt              DateTime?
  createdAt               DateTime  @default(now())
  dcaPlan                 DcaPlan   @relation(fields: [dcaPlanId], references: [id], onDelete: Cascade)

  @@index([dcaPlanId, status])
  @@map("dca_plan_items")
}
```

Also add the `dcaConfigs` relation to the existing `User` model (after `conversations`):

```prisma
dcaConfigs        DcaConfig[]
```

And add `dcaConfigs` to the existing `Portfolio` model (after `pnlHistory`):

```prisma
dcaConfigs   DcaConfig[]
```

- [ ] **Step 2: Create migration SQL**

Create file `packages/db/prisma/migrations/20260514120000_add_dca_tables/migration.sql`:

```sql
-- CreateTable
CREATE TABLE `dca_configs` (
    `id` CHAR(36) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `coin` VARCHAR(10) NOT NULL,
    `totalBudget` DECIMAL(20, 8) NOT NULL,
    `portfolioId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `dca_configs_userId_idx`(`userId`),
    UNIQUE INDEX `dca_configs_userId_coin_key`(`userId`, `coin`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dca_plans` (
    `id` CHAR(36) NOT NULL,
    `dcaConfigId` CHAR(36) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `llmAnalysis` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `archivedAt` DATETIME(3) NULL,

    INDEX `dca_plans_dcaConfigId_status_idx`(`dcaConfigId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dca_plan_items` (
    `id` CHAR(36) NOT NULL,
    `dcaPlanId` CHAR(36) NOT NULL,
    `type` VARCHAR(10) NOT NULL,
    `targetPrice` DECIMAL(20, 8) NOT NULL,
    `suggestedAmount` DECIMAL(20, 8) NOT NULL,
    `note` TEXT NULL,
    `source` VARCHAR(10) NOT NULL,
    `userModified` BOOLEAN NOT NULL DEFAULT false,
    `originalTargetPrice` DECIMAL(20, 8) NULL,
    `originalSuggestedAmount` DECIMAL(20, 8) NULL,
    `deletedByUser` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `executedPrice` DECIMAL(20, 8) NULL,
    `executedAmount` DECIMAL(20, 8) NULL,
    `executedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `dca_plan_items_dcaPlanId_status_idx`(`dcaPlanId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `dca_configs` ADD CONSTRAINT `dca_configs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dca_configs` ADD CONSTRAINT `dca_configs_portfolioId_fkey` FOREIGN KEY (`portfolioId`) REFERENCES `portfolios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dca_plans` ADD CONSTRAINT `dca_plans_dcaConfigId_fkey` FOREIGN KEY (`dcaConfigId`) REFERENCES `dca_configs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dca_plan_items` ADD CONSTRAINT `dca_plan_items_dcaPlanId_fkey` FOREIGN KEY (`dcaPlanId`) REFERENCES `dca_plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Run prisma generate**

Run: `pnpm prisma:generate`
Expected: Prisma client regenerated successfully with new model types.

- [ ] **Step 4: Create dca-config.repository.ts**

Create `packages/db/src/repositories/dca-config.repository.ts`:

```typescript
import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createDcaConfigRepository(client = prisma) {
  return {
    create(data: Prisma.DcaConfigUncheckedCreateInput) {
      return client.dcaConfig.create({ data });
    },
    findById(id: string) {
      return client.dcaConfig.findUnique({ where: { id } });
    },
    findByUserAndCoin(userId: string, coin: string) {
      return client.dcaConfig.findUnique({
        where: { userId_coin: { userId, coin } }
      });
    },
    listByUserId(userId: string) {
      return client.dcaConfig.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' }
      });
    },
    update(id: string, data: Prisma.DcaConfigUncheckedUpdateInput) {
      return client.dcaConfig.update({ where: { id }, data });
    }
  };
}
```

- [ ] **Step 5: Create dca-plan.repository.ts**

Create `packages/db/src/repositories/dca-plan.repository.ts`:

```typescript
import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createDcaPlanRepository(client = prisma) {
  return {
    create(data: Prisma.DcaPlanUncheckedCreateInput) {
      return client.dcaPlan.create({ data });
    },
    findById(id: string) {
      return client.dcaPlan.findUnique({ where: { id } });
    },
    findActiveByConfigId(dcaConfigId: string) {
      return client.dcaPlan.findFirst({
        where: { dcaConfigId, status: 'active' },
        include: {
          items: { orderBy: { targetPrice: 'asc' } }
        }
      });
    },
    listArchivedByConfigId(dcaConfigId: string) {
      return client.dcaPlan.findMany({
        where: { dcaConfigId, status: 'archived' },
        include: {
          items: { orderBy: { targetPrice: 'asc' } }
        },
        orderBy: { archivedAt: 'desc' }
      });
    },
    archiveActive(dcaConfigId: string) {
      return client.dcaPlan.updateMany({
        where: { dcaConfigId, status: 'active' },
        data: { status: 'archived', archivedAt: new Date() }
      });
    },
    updateAnalysis(id: string, llmAnalysis: string) {
      return client.dcaPlan.update({
        where: { id },
        data: { llmAnalysis }
      });
    }
  };
}
```

- [ ] **Step 6: Create dca-plan-item.repository.ts**

Create `packages/db/src/repositories/dca-plan-item.repository.ts`:

```typescript
import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createDcaPlanItemRepository(client = prisma) {
  return {
    create(data: Prisma.DcaPlanItemUncheckedCreateInput) {
      return client.dcaPlanItem.create({ data });
    },
    createMany(data: Prisma.DcaPlanItemUncheckedCreateInput[]) {
      return client.dcaPlanItem.createMany({ data });
    },
    findById(id: string) {
      return client.dcaPlanItem.findUnique({ where: { id } });
    },
    listByPlanId(dcaPlanId: string, includeDeleted = false) {
      return client.dcaPlanItem.findMany({
        where: {
          dcaPlanId,
          ...(includeDeleted ? {} : { deletedByUser: false })
        },
        orderBy: { targetPrice: 'asc' }
      });
    },
    update(id: string, data: Prisma.DcaPlanItemUncheckedUpdateInput) {
      return client.dcaPlanItem.update({ where: { id }, data });
    },
    hardDelete(id: string) {
      return client.dcaPlanItem.delete({ where: { id } });
    }
  };
}
```

- [ ] **Step 7: Export repositories from index.ts**

Add to `packages/db/src/index.ts`:

```typescript
export { createDcaConfigRepository } from './repositories/dca-config.repository';
export { createDcaPlanRepository } from './repositories/dca-plan.repository';
export { createDcaPlanItemRepository } from './repositories/dca-plan-item.repository';
```

- [ ] **Step 8: Verify typecheck passes**

Run: `pnpm --filter @app/db exec tsc --noEmit`
Expected: No type errors.

- [ ] **Step 9: Commit**

```bash
git add packages/db/
git commit -m "feat(dca): add Prisma schema, migration, and repositories for DCA module"
```

---

## Task 2: Database Providers + DTOs

**Files:**
- Modify: `apps/api/src/modules/database/database.providers.ts`
- Create: `apps/api/src/modules/dca/dto/create-dca-config.dto.ts`
- Create: `apps/api/src/modules/dca/dto/update-dca-config.dto.ts`
- Create: `apps/api/src/modules/dca/dto/create-plan-item.dto.ts`
- Create: `apps/api/src/modules/dca/dto/update-plan-item.dto.ts`
- Create: `apps/api/src/modules/dca/dto/execute-plan-item.dto.ts`

- [ ] **Step 1: Add DCA repository tokens and providers to database.providers.ts**

Add imports at the top:

```typescript
import {
  // ... existing imports ...
  createDcaConfigRepository,
  createDcaPlanRepository,
  createDcaPlanItemRepository
} from '@app/db';
```

Add symbol tokens (after existing ones):

```typescript
export const DCA_CONFIG_REPOSITORY = Symbol('DCA_CONFIG_REPOSITORY');
export const DCA_PLAN_REPOSITORY = Symbol('DCA_PLAN_REPOSITORY');
export const DCA_PLAN_ITEM_REPOSITORY = Symbol('DCA_PLAN_ITEM_REPOSITORY');
```

Add providers to the `DatabaseProviders` array:

```typescript
{
  provide: DCA_CONFIG_REPOSITORY,
  useFactory: () => createDcaConfigRepository()
},
{
  provide: DCA_PLAN_REPOSITORY,
  useFactory: () => createDcaPlanRepository()
},
{
  provide: DCA_PLAN_ITEM_REPOSITORY,
  useFactory: () => createDcaPlanItemRepository()
},
```

- [ ] **Step 2: Create create-dca-config.dto.ts**

Create `apps/api/src/modules/dca/dto/create-dca-config.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsString, Min } from 'class-validator';

export class CreateDcaConfigDto {
  @ApiProperty({ enum: ['BTC', 'ETH'], example: 'BTC' })
  @IsIn(['BTC', 'ETH'])
  coin!: 'BTC' | 'ETH';

  @ApiProperty({ example: 3000 })
  @IsNumber()
  @Min(0)
  totalBudget!: number;

  @ApiProperty({ example: 'portfolio-uuid-here' })
  @IsString()
  portfolioId!: string;
}
```

- [ ] **Step 3: Create update-dca-config.dto.ts**

Create `apps/api/src/modules/dca/dto/update-dca-config.dto.ts`:

```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateDcaConfigDto {
  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalBudget?: number;

  @ApiPropertyOptional({ example: 'portfolio-uuid-here' })
  @IsOptional()
  @IsString()
  portfolioId?: string;
}
```

- [ ] **Step 4: Create create-plan-item.dto.ts**

Create `apps/api/src/modules/dca/dto/create-plan-item.dto.ts`:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePlanItemDto {
  @ApiProperty({ enum: ['buy', 'sell'], example: 'buy' })
  @IsIn(['buy', 'sell'])
  type!: 'buy' | 'sell';

  @ApiProperty({ example: 72000 })
  @IsNumber()
  @Min(0)
  targetPrice!: number;

  @ApiProperty({ example: 500, description: 'Buy = USD to spend; Sell = coin amount to sell' })
  @IsNumber()
  @Min(0)
  suggestedAmount!: number;

  @ApiPropertyOptional({ example: 'Strong support zone' })
  @IsOptional()
  @IsString()
  note?: string;
}
```

- [ ] **Step 5: Create update-plan-item.dto.ts**

Create `apps/api/src/modules/dca/dto/update-plan-item.dto.ts`:

```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdatePlanItemDto {
  @ApiPropertyOptional({ enum: ['buy', 'sell'] })
  @IsOptional()
  @IsIn(['buy', 'sell'])
  type?: 'buy' | 'sell';

  @ApiPropertyOptional({ example: 72000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetPrice?: number;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  suggestedAmount?: number;

  @ApiPropertyOptional({ example: 'Adjusted zone' })
  @IsOptional()
  @IsString()
  note?: string;
}
```

- [ ] **Step 6: Create execute-plan-item.dto.ts**

Create `apps/api/src/modules/dca/dto/execute-plan-item.dto.ts`:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class ExecutePlanItemDto {
  @ApiProperty({ example: 71500, description: 'Actual execution price' })
  @IsNumber()
  @Min(0)
  executedPrice!: number;

  @ApiProperty({ example: 0.007, description: 'Actual coin amount' })
  @IsNumber()
  @Min(0)
  executedAmount!: number;

  @ApiPropertyOptional({ example: '2026-05-14T10:00:00.000Z', description: 'When the trade actually happened' })
  @IsOptional()
  @IsString()
  executedAt?: string;
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/database/database.providers.ts apps/api/src/modules/dca/
git commit -m "feat(dca): add database providers and DTOs"
```

---

## Task 3: DCA Config Service

**Files:**
- Create: `apps/api/src/modules/dca/dca.service.ts`

- [ ] **Step 1: Create dca.service.ts**

Create `apps/api/src/modules/dca/dca.service.ts`:

```typescript
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';

import {
  DCA_CONFIG_REPOSITORY,
  COIN_TRANSACTION_REPOSITORY,
  HOLDING_REPOSITORY
} from '../database/database.providers';
import { PortfolioService } from '../portfolio/portfolio.service';
import type { CreateDcaConfigDto } from './dto/create-dca-config.dto';
import type { UpdateDcaConfigDto } from './dto/update-dca-config.dto';

type DcaConfigRepository = ReturnType<typeof import('@app/db').createDcaConfigRepository>;
type CoinTransactionRepository = ReturnType<typeof import('@app/db').createCoinTransactionRepository>;
type HoldingRepository = ReturnType<typeof import('@app/db').createHoldingRepository>;

export type CapitalState = {
  totalBudget: number;
  deployedAmount: number;
  remaining: number;
  runnerAmount: number;
  runnerAvgCost: number;
};

@Injectable()
export class DcaService {
  constructor(
    @Inject(DCA_CONFIG_REPOSITORY)
    private readonly dcaConfigRepository: DcaConfigRepository,
    @Inject(COIN_TRANSACTION_REPOSITORY)
    private readonly txRepository: CoinTransactionRepository,
    @Inject(HOLDING_REPOSITORY)
    private readonly holdingRepository: HoldingRepository,
    private readonly portfolioService: PortfolioService
  ) {}

  listConfigs(userId: string) {
    return this.dcaConfigRepository.listByUserId(userId);
  }

  async getConfig(id: string, userId: string) {
    const config = await this.dcaConfigRepository.findById(id);

    if (!config) {
      throw new NotFoundException(`DCA config ${id} not found`);
    }

    if (config.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return config;
  }

  async createConfig(userId: string, input: CreateDcaConfigDto) {
    // Verify portfolio belongs to user
    await this.portfolioService.getPortfolio(input.portfolioId, userId);

    const existing = await this.dcaConfigRepository.findByUserAndCoin(userId, input.coin);
    if (existing) {
      throw new BadRequestException(`DCA config for ${input.coin} already exists`);
    }

    return this.dcaConfigRepository.create({
      id: randomUUID(),
      userId,
      coin: input.coin,
      totalBudget: new Decimal(input.totalBudget),
      portfolioId: input.portfolioId
    });
  }

  async updateConfig(id: string, userId: string, input: UpdateDcaConfigDto) {
    const config = await this.getConfig(id, userId);

    if (input.portfolioId) {
      await this.portfolioService.getPortfolio(input.portfolioId, userId);
    }

    if (input.totalBudget !== undefined) {
      const capital = await this.getCapitalState(config);
      if (input.totalBudget < capital.deployedAmount) {
        throw new BadRequestException(
          `Cannot reduce budget below deployed amount ($${capital.deployedAmount.toFixed(2)})`
        );
      }
    }

    return this.dcaConfigRepository.update(id, {
      ...(input.totalBudget !== undefined ? { totalBudget: new Decimal(input.totalBudget) } : {}),
      ...(input.portfolioId ? { portfolioId: input.portfolioId } : {})
    });
  }

  async getCapitalState(config: { portfolioId: string; coin: string; totalBudget: Decimal }): Promise<CapitalState> {
    const transactions = await this.txRepository.listByPortfolio(config.portfolioId, {
      coinId: config.coin
    });

    let buyTotal = 0;
    let sellTotal = 0;
    for (const tx of transactions) {
      if (tx.type === 'buy') {
        buyTotal += Number(tx.totalValue);
      } else {
        sellTotal += Number(tx.totalValue);
      }
    }

    const totalBudget = Number(config.totalBudget);
    const deployedAmount = buyTotal - sellTotal;
    const remaining = totalBudget - deployedAmount;

    const holding = await this.holdingRepository.findByPortfolioAndCoin(config.portfolioId, config.coin);
    const runnerAmount = holding ? Number(holding.totalAmount) : 0;
    const runnerAvgCost = holding ? Number(holding.avgCost) : 0;

    return { totalBudget, deployedAmount, remaining, runnerAmount, runnerAvgCost };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/modules/dca/dca.service.ts
git commit -m "feat(dca): add DCA config service with capital state calculation"
```

---

## Task 4: DCA Plan Service

**Files:**
- Create: `apps/api/src/modules/dca/dca-plan.service.ts`

- [ ] **Step 1: Create dca-plan.service.ts**

Create `apps/api/src/modules/dca/dca-plan.service.ts`:

```typescript
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';

import { prisma } from '@app/db';
import {
  DCA_PLAN_REPOSITORY,
  DCA_PLAN_ITEM_REPOSITORY
} from '../database/database.providers';
import { TransactionService } from '../transaction/transaction.service';
import type { CreatePlanItemDto } from './dto/create-plan-item.dto';
import type { UpdatePlanItemDto } from './dto/update-plan-item.dto';
import type { ExecutePlanItemDto } from './dto/execute-plan-item.dto';

type DcaPlanRepository = ReturnType<typeof import('@app/db').createDcaPlanRepository>;
type DcaPlanItemRepository = ReturnType<typeof import('@app/db').createDcaPlanItemRepository>;

export type LlmPlanItem = {
  type: 'buy' | 'sell';
  targetPrice: number;
  suggestedAmount: number;
  note: string;
};

@Injectable()
export class DcaPlanService {
  constructor(
    @Inject(DCA_PLAN_REPOSITORY)
    private readonly planRepository: DcaPlanRepository,
    @Inject(DCA_PLAN_ITEM_REPOSITORY)
    private readonly itemRepository: DcaPlanItemRepository,
    private readonly transactionService: TransactionService
  ) {}

  getActivePlan(dcaConfigId: string) {
    return this.planRepository.findActiveByConfigId(dcaConfigId);
  }

  getArchivedPlans(dcaConfigId: string) {
    return this.planRepository.listArchivedByConfigId(dcaConfigId);
  }

  async createPlanWithItems(dcaConfigId: string, llmAnalysis: string, items: LlmPlanItem[]) {
    // Archive any existing active plan
    await this.planRepository.archiveActive(dcaConfigId);

    const planId = randomUUID();
    await this.planRepository.create({
      id: planId,
      dcaConfigId,
      status: 'active',
      llmAnalysis
    });

    if (items.length > 0) {
      await this.itemRepository.createMany(
        items.map((item) => ({
          id: randomUUID(),
          dcaPlanId: planId,
          type: item.type,
          targetPrice: new Decimal(item.targetPrice),
          suggestedAmount: new Decimal(item.suggestedAmount),
          note: item.note || null,
          source: 'llm',
          status: 'pending'
        }))
      );
    }

    return this.planRepository.findActiveByConfigId(dcaConfigId);
  }

  async updateAnalysis(planId: string, llmAnalysis: string) {
    return this.planRepository.updateAnalysis(planId, llmAnalysis);
  }

  // --- Plan Item CRUD ---

  async addItem(planId: string, input: CreatePlanItemDto) {
    const plan = await this.planRepository.findById(planId);
    if (!plan || plan.status !== 'active') {
      throw new NotFoundException('Active plan not found');
    }

    return this.itemRepository.create({
      id: randomUUID(),
      dcaPlanId: planId,
      type: input.type,
      targetPrice: new Decimal(input.targetPrice),
      suggestedAmount: new Decimal(input.suggestedAmount),
      note: input.note || null,
      source: 'user',
      status: 'pending'
    });
  }

  async editItem(itemId: string, input: UpdatePlanItemDto) {
    const item = await this.itemRepository.findById(itemId);
    if (!item) throw new NotFoundException('Plan item not found');

    const updateData: Record<string, unknown> = {};

    if (input.type !== undefined) updateData.type = input.type;
    if (input.note !== undefined) updateData.note = input.note;

    if (input.targetPrice !== undefined) {
      updateData.targetPrice = new Decimal(input.targetPrice);
    }
    if (input.suggestedAmount !== undefined) {
      updateData.suggestedAmount = new Decimal(input.suggestedAmount);
    }

    // Track original values on first edit of an LLM item
    if (item.source === 'llm' && !item.userModified) {
      updateData.userModified = true;
      updateData.originalTargetPrice = item.targetPrice;
      updateData.originalSuggestedAmount = item.suggestedAmount;
    }

    return this.itemRepository.update(itemId, updateData);
  }

  async deleteItem(itemId: string) {
    const item = await this.itemRepository.findById(itemId);
    if (!item) throw new NotFoundException('Plan item not found');

    if (item.source === 'llm') {
      // Soft delete — keep for LLM context
      return this.itemRepository.update(itemId, { deletedByUser: true });
    }

    // Hard delete user-created items
    return this.itemRepository.hardDelete(itemId);
  }

  async skipItem(itemId: string) {
    const item = await this.itemRepository.findById(itemId);
    if (!item) throw new NotFoundException('Plan item not found');
    return this.itemRepository.update(itemId, { status: 'skipped' });
  }

  async executeItem(
    itemId: string,
    input: ExecutePlanItemDto,
    portfolioId: string,
    coinId: string
  ) {
    const item = await this.itemRepository.findById(itemId);
    if (!item) throw new NotFoundException('Plan item not found');
    if (item.status === 'executed') {
      throw new BadRequestException('Item already executed');
    }

    const executedAt = input.executedAt ? new Date(input.executedAt) : new Date();

    // Update plan item
    await this.itemRepository.update(itemId, {
      status: 'executed',
      executedPrice: new Decimal(input.executedPrice),
      executedAmount: new Decimal(input.executedAmount),
      executedAt
    });

    // Create portfolio transaction
    await this.transactionService.createTransaction(portfolioId, {
      coinId,
      type: item.type as 'buy' | 'sell',
      price: input.executedPrice,
      amount: input.executedAmount,
      transactedAt: executedAt.toISOString(),
      note: `DCA ${item.type} — ${item.note || 'plan item executed'}`
    });

    return this.itemRepository.findById(itemId);
  }

  /** Get all items including soft-deleted for LLM context */
  getAllItemsForLlm(planId: string) {
    return this.itemRepository.listByPlanId(planId, true);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/modules/dca/dca-plan.service.ts
git commit -m "feat(dca): add DCA plan service with item CRUD and execute flow"
```

---

## Task 5: DCA LLM Service

**Files:**
- Create: `apps/api/src/modules/dca/dca-llm.service.ts`

- [ ] **Step 1: Create dca-llm.service.ts**

Create `apps/api/src/modules/dca/dca-llm.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

import type { CapitalState } from './dca.service';
import type { LlmPlanItem } from './dca-plan.service';
import type { Candle } from '@app/core';

const DCA_PLAN_TOOL_NAME = 'record_dca_plan';
const DCA_ANALYSIS_TOOL_NAME = 'record_dca_analysis';

const PLAN_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'targetPrice', 'suggestedAmount', 'note'],
  properties: {
    type: { type: 'string', enum: ['buy', 'sell'] },
    targetPrice: { type: 'number', description: 'Target price level' },
    suggestedAmount: {
      type: 'number',
      description: 'Buy = USD to spend; Sell = coin quantity to sell'
    },
    note: { type: 'string', description: 'Reasoning for this zone (Vietnamese)' }
  }
} as const;

const DCA_PLAN_TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['llmAnalysis', 'items'],
  properties: {
    llmAnalysis: {
      type: 'string',
      description: 'Overall market context, rationale, estimated duration (Vietnamese)'
    },
    items: {
      type: 'array',
      items: PLAN_ITEM_SCHEMA
    }
  }
} as const;

const DCA_ANALYSIS_TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['llmAnalysis'],
  properties: {
    llmAnalysis: {
      type: 'string',
      description: 'Market analysis update without changing the plan (Vietnamese)'
    }
  }
} as const;

type LlmPlanResult = {
  llmAnalysis: string;
  items: LlmPlanItem[];
};

type LlmAnalysisResult = {
  llmAnalysis: string;
};

type PlanItemContext = {
  type: string;
  targetPrice: number;
  suggestedAmount: number;
  note: string | null;
  status: string;
  source: string;
  userModified: boolean;
  deletedByUser: boolean;
  originalTargetPrice?: number | null;
  originalSuggestedAmount?: number | null;
  executedPrice?: number | null;
  executedAmount?: number | null;
};

type ArchivedPlanContext = {
  createdAt: string;
  archivedAt: string | null;
  executedItems: PlanItemContext[];
};

const TIMEOUT_MS = 90_000;

function resolveModel(): string {
  return process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';
}

function formatCandles(candles: Candle[]): string {
  return candles
    .map((c) => {
      const date = c.openTime ? c.openTime.toISOString().slice(0, 10) : 'unknown';
      return `${date} | O:${c.open} H:${c.high} L:${c.low} C:${c.close} V:${c.volume ?? 0}`;
    })
    .join('\n');
}

const SYSTEM_PROMPT =
  'You are a senior crypto DCA (Dollar Cost Averaging) analyst specializing in BTC and ETH. ' +
  'You analyze price action, support/resistance zones, and market structure to suggest optimal ' +
  'DCA entry (buy) and exit (sell) zones with capital allocation. ' +
  'Always respond in Vietnamese. ' +
  'For buy items, suggestedAmount is in USD. For sell items, suggestedAmount is in coin quantity. ' +
  'Focus on risk management: spread entries across multiple zones, set sells at clear resistance. ' +
  'Consider the user\'s remaining budget and current holdings when planning.';

@Injectable()
export class DcaLlmService {
  private readonly logger = new Logger(DcaLlmService.name);

  async generatePlan(
    coin: string,
    capital: CapitalState,
    dailyCandles: Candle[],
    weeklyCandles: Candle[]
  ): Promise<LlmPlanResult | null> {
    const userMessage = this.buildGenerateMessage(coin, capital, dailyCandles, weeklyCandles);
    return this.callLlm(userMessage, DCA_PLAN_TOOL_NAME, DCA_PLAN_TOOL_SCHEMA);
  }

  async replan(
    coin: string,
    capital: CapitalState,
    dailyCandles: Candle[],
    weeklyCandles: Candle[],
    currentItems: PlanItemContext[],
    archivedPlans: ArchivedPlanContext[]
  ): Promise<LlmPlanResult | null> {
    const userMessage = this.buildReplanMessage(
      coin, capital, dailyCandles, weeklyCandles, currentItems, archivedPlans
    );
    return this.callLlm(userMessage, DCA_PLAN_TOOL_NAME, DCA_PLAN_TOOL_SCHEMA);
  }

  async reanalyze(
    coin: string,
    capital: CapitalState,
    dailyCandles: Candle[],
    weeklyCandles: Candle[],
    currentItems: PlanItemContext[]
  ): Promise<LlmAnalysisResult | null> {
    const userMessage = this.buildReanalyzeMessage(
      coin, capital, dailyCandles, weeklyCandles, currentItems
    );
    return this.callLlm(userMessage, DCA_ANALYSIS_TOOL_NAME, DCA_ANALYSIS_TOOL_SCHEMA);
  }

  private async callLlm<T>(
    userMessage: string,
    toolName: string,
    toolSchema: Record<string, unknown>
  ): Promise<T | null> {
    const apiKey = (process.env.CLAUDE_API_KEY ?? '').trim();
    const model = resolveModel();

    try {
      const client = axios.create({
        baseURL: 'https://api.anthropic.com/v1',
        timeout: TIMEOUT_MS,
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      });

      const response = await client.post<{
        content?: Array<{ type?: string; name?: string; input?: unknown }>;
      }>('/messages', {
        model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        tools: [
          {
            name: toolName,
            description: `Record structured DCA plan output for ${toolName}`,
            input_schema: toolSchema
          }
        ],
        tool_choice: { type: 'tool', name: toolName }
      });

      const toolInput = response.data.content?.find(
        (block) => block.type === 'tool_use' && block.name === toolName
      )?.input as T | undefined;

      if (toolInput == null) {
        this.logger.warn(`DCA LLM: response missing tool_use block for ${toolName}`);
        return null;
      }

      return toolInput;
    } catch (error) {
      const axiosError = error as { response?: { status?: number; data?: unknown }; message?: string };
      this.logger.warn(
        `DCA LLM failed: ${axiosError.message} | body: ${JSON.stringify(axiosError.response?.data)}`
      );
      return null;
    }
  }

  private buildGenerateMessage(
    coin: string,
    capital: CapitalState,
    dailyCandles: Candle[],
    weeklyCandles: Candle[]
  ): string {
    return [
      `=== DCA Plan Generation for ${coin} ===`,
      '',
      `Budget State:`,
      `  Total Budget: $${capital.totalBudget}`,
      `  Deployed: $${capital.deployedAmount.toFixed(2)}`,
      `  Remaining: $${capital.remaining.toFixed(2)}`,
      `  Runner: ${capital.runnerAmount} ${coin} @ avg $${capital.runnerAvgCost.toFixed(2)}`,
      '',
      `Daily Candles (last 90):`,
      formatCandles(dailyCandles),
      '',
      `Weekly Candles (last 26):`,
      formatCandles(weeklyCandles),
      '',
      'Create a DCA plan with buy zones (spread across support levels) and sell zones (at resistance). ',
      `Allocate the remaining $${capital.remaining.toFixed(2)} across multiple buy entries. `,
      'For sells, use coin quantity based on runner amount and expected buy positions.'
    ].join('\n');
  }

  private buildReplanMessage(
    coin: string,
    capital: CapitalState,
    dailyCandles: Candle[],
    weeklyCandles: Candle[],
    currentItems: PlanItemContext[],
    archivedPlans: ArchivedPlanContext[]
  ): string {
    const base = this.buildGenerateMessage(coin, capital, dailyCandles, weeklyCandles);

    const currentPlanSection = [
      '',
      '=== Current Plan Items ===',
      'Improve from these — do not reset. Respect user edits/deletions.',
      JSON.stringify(currentItems, null, 2)
    ].join('\n');

    const historySection = archivedPlans.length > 0
      ? [
          '',
          '=== Archived Plans History ===',
          JSON.stringify(archivedPlans, null, 2)
        ].join('\n')
      : '';

    return base + currentPlanSection + historySection;
  }

  private buildReanalyzeMessage(
    coin: string,
    capital: CapitalState,
    dailyCandles: Candle[],
    weeklyCandles: Candle[],
    currentItems: PlanItemContext[]
  ): string {
    const base = this.buildGenerateMessage(coin, capital, dailyCandles, weeklyCandles);

    return base + [
      '',
      '=== Current Plan Items (for reference only — do NOT change them) ===',
      JSON.stringify(currentItems, null, 2),
      '',
      'Provide ONLY a market analysis update. Do not suggest new plan items.'
    ].join('\n');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/modules/dca/dca-llm.service.ts
git commit -m "feat(dca): add DCA LLM service with Claude tool_use integration"
```

---

## Task 6: DCA Controller + Module + Registration

**Files:**
- Create: `apps/api/src/modules/dca/dca.controller.ts`
- Create: `apps/api/src/modules/dca/dca.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create dca.controller.ts**

Create `apps/api/src/modules/dca/dca.controller.ts`:

```typescript
import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Inject, Param, Patch, Post, Req
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedRequest } from '../auth/auth.types';
import { MarketDataService } from '../market/market-data.service';
import { DcaService } from './dca.service';
import { DcaPlanService } from './dca-plan.service';
import { DcaLlmService } from './dca-llm.service';
import { CreateDcaConfigDto } from './dto/create-dca-config.dto';
import { UpdateDcaConfigDto } from './dto/update-dca-config.dto';
import { CreatePlanItemDto } from './dto/create-plan-item.dto';
import { UpdatePlanItemDto } from './dto/update-plan-item.dto';
import { ExecutePlanItemDto } from './dto/execute-plan-item.dto';

@ApiTags('DCA')
@ApiCookieAuth('market_analysis_session')
@Controller('dca')
export class DcaController {
  constructor(
    @Inject(DcaService)
    private readonly dcaService: DcaService,
    @Inject(DcaPlanService)
    private readonly planService: DcaPlanService,
    @Inject(DcaLlmService)
    private readonly llmService: DcaLlmService,
    @Inject(MarketDataService)
    private readonly marketDataService: MarketDataService
  ) {}

  // --- Config CRUD ---

  @Get('config')
  @ApiOperation({ summary: 'List all DCA configs' })
  listConfigs(@Req() req: AuthenticatedRequest) {
    return this.dcaService.listConfigs(req.authUser!.id);
  }

  @Post('config')
  @ApiOperation({ summary: 'Create a DCA config for a coin' })
  createConfig(@Req() req: AuthenticatedRequest, @Body() body: CreateDcaConfigDto) {
    return this.dcaService.createConfig(req.authUser!.id, body);
  }

  @Patch('config/:id')
  @ApiOperation({ summary: 'Update DCA config (totalBudget or portfolioId)' })
  updateConfig(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateDcaConfigDto
  ) {
    return this.dcaService.updateConfig(id, req.authUser!.id, body);
  }

  // --- Plan ---

  @Get('config/:configId/plan/active')
  @ApiOperation({ summary: 'Get active plan + items' })
  async getActivePlan(
    @Param('configId') configId: string,
    @Req() req: AuthenticatedRequest
  ) {
    const config = await this.dcaService.getConfig(configId, req.authUser!.id);
    const plan = await this.planService.getActivePlan(config.id);
    const capital = await this.dcaService.getCapitalState(config);
    return { config, plan, capital };
  }

  @Get('config/:configId/plan/history')
  @ApiOperation({ summary: 'List archived plans' })
  async getPlanHistory(
    @Param('configId') configId: string,
    @Req() req: AuthenticatedRequest
  ) {
    const config = await this.dcaService.getConfig(configId, req.authUser!.id);
    return this.planService.getArchivedPlans(config.id);
  }

  @Post('config/:configId/plan/generate')
  @ApiOperation({ summary: 'Generate first plan (LLM)' })
  async generatePlan(
    @Param('configId') configId: string,
    @Req() req: AuthenticatedRequest
  ) {
    const config = await this.dcaService.getConfig(configId, req.authUser!.id);
    const capital = await this.dcaService.getCapitalState(config);
    const symbol = `${config.coin}USDT`;

    const [dailyCandles, weeklyCandles] = await Promise.all([
      this.marketDataService.getCandles(symbol, '1d', 90),
      this.marketDataService.getCandles(symbol, '1w', 26)
    ]);

    const result = await this.llmService.generatePlan(
      config.coin, capital, dailyCandles, weeklyCandles
    );

    if (!result) {
      return { error: 'LLM generation failed. Try again.' };
    }

    return this.planService.createPlanWithItems(config.id, result.llmAnalysis, result.items);
  }

  @Post('config/:configId/plan/replan')
  @ApiOperation({ summary: 'Archive current plan + generate improved plan' })
  async replan(
    @Param('configId') configId: string,
    @Req() req: AuthenticatedRequest
  ) {
    const config = await this.dcaService.getConfig(configId, req.authUser!.id);
    const capital = await this.dcaService.getCapitalState(config);
    const symbol = `${config.coin}USDT`;

    const activePlan = await this.planService.getActivePlan(config.id);
    const currentItems = activePlan
      ? (await this.planService.getAllItemsForLlm(activePlan.id)).map(mapItemToContext)
      : [];

    const archivedPlans = (await this.planService.getArchivedPlans(config.id)).map((p) => ({
      createdAt: p.createdAt.toISOString(),
      archivedAt: p.archivedAt?.toISOString() ?? null,
      executedItems: p.items
        .filter((i) => i.status === 'executed')
        .map(mapItemToContext)
    }));

    const [dailyCandles, weeklyCandles] = await Promise.all([
      this.marketDataService.getCandles(symbol, '1d', 90),
      this.marketDataService.getCandles(symbol, '1w', 26)
    ]);

    const result = await this.llmService.replan(
      config.coin, capital, dailyCandles, weeklyCandles, currentItems, archivedPlans
    );

    if (!result) {
      return { error: 'LLM re-plan failed. Try again.' };
    }

    return this.planService.createPlanWithItems(config.id, result.llmAnalysis, result.items);
  }

  @Post('config/:configId/plan/reanalyze')
  @ApiOperation({ summary: 'Update LLM analysis only, keep plan unchanged' })
  async reanalyze(
    @Param('configId') configId: string,
    @Req() req: AuthenticatedRequest
  ) {
    const config = await this.dcaService.getConfig(configId, req.authUser!.id);
    const capital = await this.dcaService.getCapitalState(config);
    const symbol = `${config.coin}USDT`;

    const activePlan = await this.planService.getActivePlan(config.id);
    if (!activePlan) {
      return { error: 'No active plan to re-analyze' };
    }

    const currentItems = (await this.planService.getAllItemsForLlm(activePlan.id)).map(mapItemToContext);

    const [dailyCandles, weeklyCandles] = await Promise.all([
      this.marketDataService.getCandles(symbol, '1d', 90),
      this.marketDataService.getCandles(symbol, '1w', 26)
    ]);

    const result = await this.llmService.reanalyze(
      config.coin, capital, dailyCandles, weeklyCandles, currentItems
    );

    if (!result) {
      return { error: 'LLM re-analyze failed. Try again.' };
    }

    await this.planService.updateAnalysis(activePlan.id, result.llmAnalysis);
    return this.planService.getActivePlan(config.id);
  }

  // --- Plan Items ---

  @Post('plan/:planId/items')
  @ApiOperation({ summary: 'Add item manually' })
  addItem(@Param('planId') planId: string, @Body() body: CreatePlanItemDto) {
    return this.planService.addItem(planId, body);
  }

  @Patch('plan/:planId/items/:itemId')
  @ApiOperation({ summary: 'Edit item' })
  editItem(@Param('itemId') itemId: string, @Body() body: UpdatePlanItemDto) {
    return this.planService.editItem(itemId, body);
  }

  @Delete('plan/:planId/items/:itemId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete item (soft for LLM, hard for user)' })
  deleteItem(@Param('itemId') itemId: string) {
    return this.planService.deleteItem(itemId);
  }

  @Post('plan/:planId/items/:itemId/execute')
  @ApiOperation({ summary: 'Mark item as executed + create Portfolio transaction' })
  async executeItem(
    @Param('itemId') itemId: string,
    @Body() body: ExecutePlanItemDto,
    @Req() req: AuthenticatedRequest
  ) {
    // Resolve config from item → plan → config chain
    const item = await this.planService['itemRepository'].findById(itemId);
    if (!item) return { error: 'Item not found' };

    const plan = await this.planService['planRepository'].findById(item.dcaPlanId);
    if (!plan) return { error: 'Plan not found' };

    const config = await this.dcaService.getConfig(plan.dcaConfigId, req.authUser!.id);

    return this.planService.executeItem(itemId, body, config.portfolioId, config.coin);
  }

  @Patch('plan/:planId/items/:itemId/skip')
  @ApiOperation({ summary: 'Mark item as skipped' })
  skipItem(@Param('itemId') itemId: string) {
    return this.planService.skipItem(itemId);
  }
}

function mapItemToContext(item: {
  type: string;
  targetPrice: { toNumber?: () => number } | number;
  suggestedAmount: { toNumber?: () => number } | number;
  note: string | null;
  status: string;
  source: string;
  userModified: boolean;
  deletedByUser: boolean;
  originalTargetPrice?: { toNumber?: () => number } | number | null;
  originalSuggestedAmount?: { toNumber?: () => number } | number | null;
  executedPrice?: { toNumber?: () => number } | number | null;
  executedAmount?: { toNumber?: () => number } | number | null;
}) {
  const toNum = (v: { toNumber?: () => number } | number | null | undefined) =>
    v == null ? null : typeof v === 'number' ? v : v.toNumber?.() ?? Number(v);

  return {
    type: item.type,
    targetPrice: toNum(item.targetPrice)!,
    suggestedAmount: toNum(item.suggestedAmount)!,
    note: item.note,
    status: item.status,
    source: item.source,
    userModified: item.userModified,
    deletedByUser: item.deletedByUser,
    originalTargetPrice: toNum(item.originalTargetPrice),
    originalSuggestedAmount: toNum(item.originalSuggestedAmount),
    executedPrice: toNum(item.executedPrice),
    executedAmount: toNum(item.executedAmount)
  };
}
```

- [ ] **Step 2: Create dca.module.ts**

Create `apps/api/src/modules/dca/dca.module.ts`:

```typescript
import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { MarketModule } from '../market/market.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { TransactionModule } from '../transaction/transaction.module';
import { DcaController } from './dca.controller';
import { DcaService } from './dca.service';
import { DcaPlanService } from './dca-plan.service';
import { DcaLlmService } from './dca-llm.service';

@Module({
  imports: [DatabaseModule, PortfolioModule, TransactionModule, MarketModule],
  controllers: [DcaController],
  providers: [DcaService, DcaPlanService, DcaLlmService]
})
export class DcaModule {}
```

- [ ] **Step 3: Register DcaModule in app.module.ts**

Add import at the top of `apps/api/src/app.module.ts`:

```typescript
import { DcaModule } from './modules/dca/dca.module';
```

Add `DcaModule` to the imports array (after `SkillsModule`).

- [ ] **Step 4: Verify typecheck**

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/dca/ apps/api/src/app.module.ts
git commit -m "feat(dca): add controller, module, and register in app"
```

---

## Task 7: Web Types + API Client

**Files:**
- Modify: `apps/web/src/shared/api/types.ts`
- Modify: `apps/web/src/shared/api/client.ts`

- [ ] **Step 1: Add DCA types to types.ts**

Append to `apps/web/src/shared/api/types.ts`:

```typescript
export type DcaConfig = {
  id: string;
  userId: string;
  coin: 'BTC' | 'ETH';
  totalBudget: number;
  portfolioId: string;
  createdAt: string;
  updatedAt: string;
};

export type DcaPlanItem = {
  id: string;
  dcaPlanId: string;
  type: 'buy' | 'sell';
  targetPrice: number;
  suggestedAmount: number;
  note: string | null;
  source: 'llm' | 'user';
  userModified: boolean;
  deletedByUser: boolean;
  originalTargetPrice: number | null;
  originalSuggestedAmount: number | null;
  status: 'pending' | 'executed' | 'skipped';
  executedPrice: number | null;
  executedAmount: number | null;
  executedAt: string | null;
  createdAt: string;
};

export type DcaPlan = {
  id: string;
  dcaConfigId: string;
  status: 'active' | 'archived';
  llmAnalysis: string | null;
  createdAt: string;
  archivedAt: string | null;
  items: DcaPlanItem[];
};

export type DcaCapitalState = {
  totalBudget: number;
  deployedAmount: number;
  remaining: number;
  runnerAmount: number;
  runnerAvgCost: number;
};

export type DcaActivePlanResponse = {
  config: DcaConfig;
  plan: DcaPlan | null;
  capital: DcaCapitalState;
};

export type CreateDcaConfigInput = {
  coin: 'BTC' | 'ETH';
  totalBudget: number;
  portfolioId: string;
};

export type UpdateDcaConfigInput = {
  totalBudget?: number;
  portfolioId?: string;
};

export type CreateDcaPlanItemInput = {
  type: 'buy' | 'sell';
  targetPrice: number;
  suggestedAmount: number;
  note?: string;
};

export type UpdateDcaPlanItemInput = {
  type?: 'buy' | 'sell';
  targetPrice?: number;
  suggestedAmount?: number;
  note?: string;
};

export type ExecuteDcaPlanItemInput = {
  executedPrice: number;
  executedAmount: number;
  executedAt?: string;
};
```

- [ ] **Step 2: Add DCA mappers and API methods to client.ts**

Add import for the new types at the top of `apps/web/src/shared/api/client.ts`:

```typescript
import type {
  // ... existing imports ...
  DcaConfig,
  DcaPlan,
  DcaPlanItem,
  DcaActivePlanResponse,
  DcaCapitalState,
  CreateDcaConfigInput,
  UpdateDcaConfigInput,
  CreateDcaPlanItemInput,
  UpdateDcaPlanItemInput,
  ExecuteDcaPlanItemInput
} from './types';
```

Add mapper functions (after existing mappers):

```typescript
function mapDcaConfig(row: JsonRecord): DcaConfig {
  return {
    id: String(row.id),
    userId: String(row.userId),
    coin: String(row.coin) as 'BTC' | 'ETH',
    totalBudget: Number(row.totalBudget),
    portfolioId: String(row.portfolioId),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt)
  };
}

function mapDcaPlanItem(row: JsonRecord): DcaPlanItem {
  return {
    id: String(row.id),
    dcaPlanId: String(row.dcaPlanId),
    type: String(row.type) as 'buy' | 'sell',
    targetPrice: Number(row.targetPrice),
    suggestedAmount: Number(row.suggestedAmount),
    note: row.note == null ? null : String(row.note),
    source: String(row.source) as 'llm' | 'user',
    userModified: Boolean(row.userModified),
    deletedByUser: Boolean(row.deletedByUser),
    originalTargetPrice: row.originalTargetPrice == null ? null : Number(row.originalTargetPrice),
    originalSuggestedAmount: row.originalSuggestedAmount == null ? null : Number(row.originalSuggestedAmount),
    status: String(row.status) as 'pending' | 'executed' | 'skipped',
    executedPrice: row.executedPrice == null ? null : Number(row.executedPrice),
    executedAmount: row.executedAmount == null ? null : Number(row.executedAmount),
    executedAt: row.executedAt == null ? null : String(row.executedAt),
    createdAt: String(row.createdAt)
  };
}

function mapDcaPlan(row: JsonRecord): DcaPlan {
  return {
    id: String(row.id),
    dcaConfigId: String(row.dcaConfigId),
    status: String(row.status) as 'active' | 'archived',
    llmAnalysis: row.llmAnalysis == null ? null : String(row.llmAnalysis),
    createdAt: String(row.createdAt),
    archivedAt: row.archivedAt == null ? null : String(row.archivedAt),
    items: Array.isArray(row.items) ? (row.items as JsonRecord[]).map(mapDcaPlanItem) : []
  };
}

function mapDcaActivePlanResponse(row: JsonRecord): DcaActivePlanResponse {
  return {
    config: mapDcaConfig(row.config as JsonRecord),
    plan: row.plan ? mapDcaPlan(row.plan as JsonRecord) : null,
    capital: row.capital as DcaCapitalState
  };
}
```

Add API methods inside the `createApiClient` return object (after existing methods):

```typescript
// --- DCA ---

async fetchDcaConfigs(): Promise<DcaConfig[]> {
  const rows = await fetchJson<JsonRecord[]>(f, url('/dca/config'), { headers: h, credentials });
  return rows.map(mapDcaConfig);
},

async createDcaConfig(input: CreateDcaConfigInput): Promise<DcaConfig> {
  const row = await fetchJson<JsonRecord>(f, url('/dca/config'), {
    method: 'POST',
    headers: { ...h, 'content-type': 'application/json' },
    credentials,
    body: JSON.stringify(input)
  });
  return mapDcaConfig(row);
},

async updateDcaConfig(id: string, input: UpdateDcaConfigInput): Promise<DcaConfig> {
  const row = await fetchJson<JsonRecord>(f, url(`/dca/config/${id}`), {
    method: 'PATCH',
    headers: { ...h, 'content-type': 'application/json' },
    credentials,
    body: JSON.stringify(input)
  });
  return mapDcaConfig(row);
},

async fetchDcaActivePlan(configId: string): Promise<DcaActivePlanResponse> {
  const row = await fetchJson<JsonRecord>(f, url(`/dca/config/${configId}/plan/active`), {
    headers: h, credentials
  });
  return mapDcaActivePlanResponse(row);
},

async fetchDcaPlanHistory(configId: string): Promise<DcaPlan[]> {
  const rows = await fetchJson<JsonRecord[]>(f, url(`/dca/config/${configId}/plan/history`), {
    headers: h, credentials
  });
  return rows.map(mapDcaPlan);
},

async generateDcaPlan(configId: string): Promise<DcaPlan | { error: string }> {
  const row = await fetchJson<JsonRecord>(f, url(`/dca/config/${configId}/plan/generate`), {
    method: 'POST',
    headers: h,
    credentials
  });
  if (row.error) return { error: String(row.error) };
  return mapDcaPlan(row);
},

async replanDca(configId: string): Promise<DcaPlan | { error: string }> {
  const row = await fetchJson<JsonRecord>(f, url(`/dca/config/${configId}/plan/replan`), {
    method: 'POST',
    headers: h,
    credentials
  });
  if (row.error) return { error: String(row.error) };
  return mapDcaPlan(row);
},

async reanalyzeDca(configId: string): Promise<DcaPlan | { error: string }> {
  const row = await fetchJson<JsonRecord>(f, url(`/dca/config/${configId}/plan/reanalyze`), {
    method: 'POST',
    headers: h,
    credentials
  });
  if (row.error) return { error: String(row.error) };
  return mapDcaPlan(row);
},

async addDcaPlanItem(planId: string, input: CreateDcaPlanItemInput): Promise<DcaPlanItem> {
  const row = await fetchJson<JsonRecord>(f, url(`/dca/plan/${planId}/items`), {
    method: 'POST',
    headers: { ...h, 'content-type': 'application/json' },
    credentials,
    body: JSON.stringify(input)
  });
  return mapDcaPlanItem(row);
},

async editDcaPlanItem(planId: string, itemId: string, input: UpdateDcaPlanItemInput): Promise<DcaPlanItem> {
  const row = await fetchJson<JsonRecord>(f, url(`/dca/plan/${planId}/items/${itemId}`), {
    method: 'PATCH',
    headers: { ...h, 'content-type': 'application/json' },
    credentials,
    body: JSON.stringify(input)
  });
  return mapDcaPlanItem(row);
},

async deleteDcaPlanItem(planId: string, itemId: string): Promise<void> {
  await fetchJson<unknown>(f, url(`/dca/plan/${planId}/items/${itemId}`), {
    method: 'DELETE',
    headers: h,
    credentials
  });
},

async executeDcaPlanItem(planId: string, itemId: string, input: ExecuteDcaPlanItemInput): Promise<DcaPlanItem> {
  const row = await fetchJson<JsonRecord>(f, url(`/dca/plan/${planId}/items/${itemId}/execute`), {
    method: 'POST',
    headers: { ...h, 'content-type': 'application/json' },
    credentials,
    body: JSON.stringify(input)
  });
  return mapDcaPlanItem(row);
},

async skipDcaPlanItem(planId: string, itemId: string): Promise<DcaPlanItem> {
  const row = await fetchJson<JsonRecord>(f, url(`/dca/plan/${planId}/items/${itemId}/skip`), {
    method: 'PATCH',
    headers: h,
    credentials
  });
  return mapDcaPlanItem(row);
},
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/shared/api/
git commit -m "feat(dca): add DCA types, mappers, and API client methods"
```

---

## Task 8: Web DCA Page + Widgets

**Files:**
- Create: `apps/web/src/app/dca/page.tsx`
- Create: `apps/web/src/_pages/dca-page/dca-page.tsx`
- Create: `apps/web/src/widgets/dca-panel/dca-panel.tsx`
- Create: `apps/web/src/widgets/dca-panel/plan-items-table.tsx`
- Create: `apps/web/src/widgets/dca-panel/execute-modal.tsx`
- Create: `apps/web/src/widgets/dca-panel/add-edit-item-modal.tsx`
- Modify: `apps/web/src/widgets/app-shell/sidebar-nav.tsx`

- [ ] **Step 1: Create page route**

Create `apps/web/src/app/dca/page.tsx`:

```tsx
export { default } from '@web/_pages/dca-page/dca-page';
```

- [ ] **Step 2: Create server component**

Create `apps/web/src/_pages/dca-page/dca-page.tsx`:

```tsx
import { createServerApiClient } from '@web/shared/auth/api-auth';
import { DcaPanel } from '@web/widgets/dca-panel/dca-panel';

export default async function DcaPage() {
  const api = createServerApiClient();

  const [configs, portfolios] = await Promise.all([
    api.fetchDcaConfigs().catch(() => []),
    api.fetchPortfolios().catch(() => [])
  ]);

  // Fetch active plan for each config
  const configsWithPlans = await Promise.all(
    configs.map(async (config) => {
      const data = await api.fetchDcaActivePlan(config.id).catch(() => ({
        config,
        plan: null,
        capital: { totalBudget: 0, deployedAmount: 0, remaining: 0, runnerAmount: 0, runnerAvgCost: 0 }
      }));
      return data;
    })
  );

  return (
    <div className="dca-page">
      <h1>DCA Manager</h1>
      <div className="dca-panels">
        {configsWithPlans.map((data) => (
          <DcaPanel
            key={data.config.id}
            config={data.config}
            plan={data.plan}
            capital={data.capital}
            portfolios={portfolios}
          />
        ))}
        {configsWithPlans.length === 0 && (
          <DcaPanel
            config={null}
            plan={null}
            capital={null}
            portfolios={portfolios}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create DcaPanel widget**

Create `apps/web/src/widgets/dca-panel/dca-panel.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type {
  DcaConfig,
  DcaPlan,
  DcaCapitalState,
  Portfolio
} from '@web/shared/api/types';
import { PlanItemsTable } from './plan-items-table';
import { ExecuteModal } from './execute-modal';
import { AddEditItemModal } from './add-edit-item-modal';

type DcaPanelProps = {
  config: DcaConfig | null;
  plan: DcaPlan | null;
  capital: DcaCapitalState | null;
  portfolios: Portfolio[];
};

const api = createApiClient();

export function DcaPanel({ config: initialConfig, plan: initialPlan, capital: initialCapital, portfolios }: DcaPanelProps) {
  const [config, setConfig] = useState(initialConfig);
  const [plan, setPlan] = useState(initialPlan);
  const [capital, setCapital] = useState(initialCapital);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Setup form state (when no config exists)
  const [setupCoin, setSetupCoin] = useState<'BTC' | 'ETH'>('BTC');
  const [setupBudget, setSetupBudget] = useState('');
  const [setupPortfolioId, setSetupPortfolioId] = useState(portfolios[0]?.id ?? '');

  if (!config) {
    return (
      <div className="dca-panel dca-panel--setup">
        <h2>Create DCA Config</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              try {
                const newConfig = await api.createDcaConfig({
                  coin: setupCoin,
                  totalBudget: Number(setupBudget),
                  portfolioId: setupPortfolioId
                });
                setConfig(newConfig);
                setCapital({ totalBudget: Number(setupBudget), deployedAmount: 0, remaining: Number(setupBudget), runnerAmount: 0, runnerAvgCost: 0 });
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to create config');
              }
            });
          }}
        >
          <label>
            Coin
            <select value={setupCoin} onChange={(e) => setSetupCoin(e.target.value as 'BTC' | 'ETH')}>
              <option value="BTC">BTC</option>
              <option value="ETH">ETH</option>
            </select>
          </label>
          <label>
            Total Budget (USD)
            <input type="number" value={setupBudget} onChange={(e) => setSetupBudget(e.target.value)} required min="0" step="any" />
          </label>
          <label>
            Portfolio
            <select value={setupPortfolioId} onChange={(e) => setSetupPortfolioId(e.target.value)}>
              {portfolios.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={isPending}>{isPending ? 'Creating...' : 'Create'}</button>
          {error && <p className="error-text">{error}</p>}
        </form>
      </div>
    );
  }

  const refreshPlan = async () => {
    const data = await api.fetchDcaActivePlan(config.id);
    setPlan(data.plan);
    setCapital(data.capital);
  };

  const handleGenerate = () => {
    setError(null);
    startTransition(async () => {
      const result = await api.generateDcaPlan(config.id);
      if ('error' in result) {
        setError(result.error);
      } else {
        setPlan(result);
        await refreshPlan();
      }
    });
  };

  const handleReplan = () => {
    setError(null);
    startTransition(async () => {
      const result = await api.replanDca(config.id);
      if ('error' in result) {
        setError(result.error);
      } else {
        setPlan(result);
        await refreshPlan();
      }
    });
  };

  const handleReanalyze = () => {
    setError(null);
    startTransition(async () => {
      const result = await api.reanalyzeDca(config.id);
      if ('error' in result) {
        setError(result.error);
      } else {
        setPlan(result);
      }
    });
  };

  return (
    <div className="dca-panel">
      <h2>{config.coin}</h2>

      {capital && (
        <div className="dca-budget-bar">
          <span>Budget: ${capital.totalBudget.toLocaleString()}</span>
          <span>Deployed: ${capital.deployedAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          <span>Remaining: ${capital.remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </div>
      )}

      {capital && capital.runnerAmount > 0 && (
        <div className="dca-runner-bar">
          Runner: {capital.runnerAmount.toFixed(6)} {config.coin} @ avg ${capital.runnerAvgCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      {!plan && (
        <button onClick={handleGenerate} disabled={isPending}>
          {isPending ? 'Generating...' : 'Generate Plan'}
        </button>
      )}

      {plan && (
        <>
          {plan.llmAnalysis && (
            <details className="dca-analysis">
              <summary>LLM Analysis</summary>
              <p>{plan.llmAnalysis}</p>
            </details>
          )}

          <div className="dca-actions">
            <button onClick={handleReanalyze} disabled={isPending}>
              {isPending ? 'Analyzing...' : 'Re-analyze'}
            </button>
            <button onClick={handleReplan} disabled={isPending}>
              {isPending ? 'Re-planning...' : 'Re-plan'}
            </button>
          </div>

          <PlanItemsTable
            planId={plan.id}
            items={plan.items.filter((i) => !i.deletedByUser)}
            coin={config.coin}
            onRefresh={refreshPlan}
          />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create PlanItemsTable widget**

Create `apps/web/src/widgets/dca-panel/plan-items-table.tsx`:

```tsx
'use client';

import { useState } from 'react';

import type { DcaPlanItem } from '@web/shared/api/types';
import { ExecuteModal } from './execute-modal';
import { AddEditItemModal } from './add-edit-item-modal';
import { createApiClient } from '@web/shared/api/client';

type PlanItemsTableProps = {
  planId: string;
  items: DcaPlanItem[];
  coin: string;
  onRefresh: () => Promise<void>;
};

const api = createApiClient();

function sourceBadge(item: DcaPlanItem): string {
  if (item.source === 'user') return 'user';
  if (item.userModified) return 'llm ✎';
  return 'llm';
}

export function PlanItemsTable({ planId, items, coin, onRefresh }: PlanItemsTableProps) {
  const [executeItem, setExecuteItem] = useState<DcaPlanItem | null>(null);
  const [editItem, setEditItem] = useState<DcaPlanItem | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const handleSkip = async (itemId: string) => {
    await api.skipDcaPlanItem(planId, itemId);
    await onRefresh();
  };

  const handleDelete = async (itemId: string) => {
    await api.deleteDcaPlanItem(planId, itemId);
    await onRefresh();
  };

  return (
    <div className="dca-items">
      <table className="dca-items-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Target Price</th>
            <th>Amount</th>
            <th>Note</th>
            <th>Source</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className={`dca-item dca-item--${item.status}`}>
              <td data-label="Type">
                <span className={`dca-type dca-type--${item.type}`}>{item.type.toUpperCase()}</span>
              </td>
              <td data-label="Target">${item.targetPrice.toLocaleString()}</td>
              <td data-label="Amount">
                {item.type === 'buy'
                  ? `$${item.suggestedAmount.toLocaleString()}`
                  : `${item.suggestedAmount} ${coin}`}
              </td>
              <td data-label="Note">{item.note || '—'}</td>
              <td data-label="Source">
                <span className="dca-source-badge">{sourceBadge(item)}</span>
              </td>
              <td data-label="Status">{item.status}</td>
              <td data-label="Actions">
                {item.status === 'pending' && (
                  <div className="dca-item-actions">
                    <button onClick={() => setExecuteItem(item)} title="Execute">✓</button>
                    <button onClick={() => setEditItem(item)} title="Edit">✎</button>
                    <button onClick={() => handleSkip(item.id)} title="Skip">⏭</button>
                    <button onClick={() => handleDelete(item.id)} title="Delete">✕</button>
                  </div>
                )}
                {item.status === 'executed' && (
                  <span title={`Executed at $${item.executedPrice}`}>✓ ${item.executedPrice?.toLocaleString()}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button className="dca-add-item-btn" onClick={() => setShowAdd(true)}>+ Add item</button>

      {executeItem && (
        <ExecuteModal
          item={executeItem}
          coin={coin}
          planId={planId}
          onClose={() => setExecuteItem(null)}
          onDone={async () => { setExecuteItem(null); await onRefresh(); }}
        />
      )}

      {(editItem || showAdd) && (
        <AddEditItemModal
          item={editItem}
          planId={planId}
          onClose={() => { setEditItem(null); setShowAdd(false); }}
          onDone={async () => { setEditItem(null); setShowAdd(false); await onRefresh(); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create ExecuteModal**

Create `apps/web/src/widgets/dca-panel/execute-modal.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { DcaPlanItem } from '@web/shared/api/types';

type ExecuteModalProps = {
  item: DcaPlanItem;
  coin: string;
  planId: string;
  onClose: () => void;
  onDone: () => Promise<void>;
};

const api = createApiClient();

export function ExecuteModal({ item, coin, planId, onClose, onDone }: ExecuteModalProps) {
  const [price, setPrice] = useState(String(item.targetPrice));
  const [amount, setAmount] = useState('');
  const [executedAt, setExecutedAt] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        await api.executeDcaPlanItem(planId, item.id, {
          executedPrice: Number(price),
          executedAmount: Number(amount),
          ...(executedAt ? { executedAt: new Date(executedAt).toISOString() } : {})
        });
        await onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to execute');
      }
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Execute {item.type.toUpperCase()} @ ${item.targetPrice.toLocaleString()}</h3>
        <form onSubmit={handleSubmit}>
          <label>
            Actual Price (USD)
            <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} required min="0" step="any" />
          </label>
          <label>
            Actual Amount ({coin})
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required min="0" step="any" />
          </label>
          <label>
            Executed At (optional)
            <input type="datetime-local" value={executedAt} onChange={(e) => setExecutedAt(e.target.value)} />
          </label>
          {error && <p className="error-text">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={isPending}>{isPending ? 'Executing...' : 'Confirm'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create AddEditItemModal**

Create `apps/web/src/widgets/dca-panel/add-edit-item-modal.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { DcaPlanItem } from '@web/shared/api/types';

type AddEditItemModalProps = {
  item: DcaPlanItem | null; // null = add mode
  planId: string;
  onClose: () => void;
  onDone: () => Promise<void>;
};

const api = createApiClient();

export function AddEditItemModal({ item, planId, onClose, onDone }: AddEditItemModalProps) {
  const isEdit = item !== null;
  const [type, setType] = useState<'buy' | 'sell'>(item?.type ?? 'buy');
  const [targetPrice, setTargetPrice] = useState(item ? String(item.targetPrice) : '');
  const [suggestedAmount, setSuggestedAmount] = useState(item ? String(item.suggestedAmount) : '');
  const [note, setNote] = useState(item?.note ?? '');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (isEdit) {
          await api.editDcaPlanItem(planId, item!.id, {
            type,
            targetPrice: Number(targetPrice),
            suggestedAmount: Number(suggestedAmount),
            note: note || undefined
          });
        } else {
          await api.addDcaPlanItem(planId, {
            type,
            targetPrice: Number(targetPrice),
            suggestedAmount: Number(suggestedAmount),
            note: note || undefined
          });
        }
        await onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed');
      }
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>{isEdit ? 'Edit Item' : 'Add Item'}</h3>
        <form onSubmit={handleSubmit}>
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value as 'buy' | 'sell')}>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </label>
          <label>
            Target Price (USD)
            <input type="number" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} required min="0" step="any" />
          </label>
          <label>
            Amount {type === 'buy' ? '(USD)' : '(Coin)'}
            <input type="number" value={suggestedAmount} onChange={(e) => setSuggestedAmount(e.target.value)} required min="0" step="any" />
          </label>
          <label>
            Note
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </label>
          {error && <p className="error-text">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={isPending}>{isPending ? 'Saving...' : isEdit ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Add /dca link to sidebar navigation**

Edit `apps/web/src/widgets/app-shell/sidebar-nav.tsx`. Add to the `NAV_ITEMS` array, after the `Portfolio` entry:

```typescript
{
  href: '/dca',
  label: 'DCA Manager',
  description: 'DCA buy/sell plans for BTC & ETH'
},
```

- [ ] **Step 8: Verify typecheck**

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/
git commit -m "feat(dca): add DCA page, panel widgets, and navigation link"
```

---

## Task 9: CSS Styles

**Files:**
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Add DCA styles to globals.css**

Append to `apps/web/src/app/globals.css`:

```css
/* --- DCA Manager --- */
.dca-page h1 {
  margin-bottom: 1.5rem;
}

.dca-panels {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.dca-panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.5rem;
}

.dca-budget-bar {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
}

.dca-runner-bar {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 1rem;
}

.dca-analysis {
  margin-bottom: 1rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.5rem 1rem;
}

.dca-analysis summary {
  cursor: pointer;
  font-weight: 600;
}

.dca-analysis p {
  white-space: pre-wrap;
  font-size: 0.9rem;
  margin-top: 0.5rem;
}

.dca-actions {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.dca-items-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.dca-items-table th,
.dca-items-table td {
  padding: 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.dca-type--buy { color: var(--green, #22c55e); font-weight: 600; }
.dca-type--sell { color: var(--red, #ef4444); font-weight: 600; }

.dca-item--executed { opacity: 0.6; }
.dca-item--skipped { opacity: 0.4; text-decoration: line-through; }

.dca-source-badge {
  font-size: 0.75rem;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-subtle, #f1f5f9);
}

.dca-item-actions {
  display: flex;
  gap: 4px;
}

.dca-item-actions button {
  padding: 2px 6px;
  font-size: 0.85rem;
  border-radius: 4px;
  cursor: pointer;
}

.dca-add-item-btn {
  margin-top: 0.75rem;
}

@media (max-width: 768px) {
  .dca-items-table thead { display: none; }
  .dca-items-table tr {
    display: block;
    margin-bottom: 1rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.5rem;
  }
  .dca-items-table td {
    display: flex;
    justify-content: space-between;
    border-bottom: none;
    padding: 0.25rem 0.5rem;
  }
  .dca-items-table td::before {
    content: attr(data-label);
    font-weight: 600;
    margin-right: 1rem;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/globals.css
git commit -m "feat(dca): add DCA page CSS styles"
```

---

## Task 10: Export TransactionService for DCA Module

**Files:**
- Modify: `apps/api/src/modules/transaction/transaction.module.ts`

- [ ] **Step 1: Export TransactionService**

The `TransactionModule` currently does not export `TransactionService`. DCA needs it to create Portfolio transactions on execute. Edit `apps/api/src/modules/transaction/transaction.module.ts` to add the `exports` array:

```typescript
@Module({
  imports: [DatabaseModule, PortfolioModule, HoldingsModule],
  controllers: [TransactionController],
  providers: [TransactionService],
  exports: [TransactionService]
})
export class TransactionModule {}
```

- [ ] **Step 2: Export MarketDataService if not exported**

Check `apps/api/src/modules/market/market.module.ts`. The `MarketModule` should already export `MarketDataService`. If not, add `exports: [MarketDataService]`.

- [ ] **Step 3: Verify full build**

Run: `pnpm -r build`
Expected: All 3 apps (api, worker, web) build successfully.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/transaction/transaction.module.ts apps/api/src/modules/market/market.module.ts
git commit -m "feat(dca): export TransactionService and MarketDataService for DCA module"
```

---

## Task 11: Feature Documentation

**Files:**
- Modify: `docs/features/dca-manager/dca-manager.md`

- [ ] **Step 1: Update feature doc checklist**

Update the Implementation Checklist in `docs/features/dca-manager/dca-manager.md` — mark all items as `[x]`.

- [ ] **Step 2: Commit**

```bash
git add docs/features/dca-manager/dca-manager.md
git commit -m "docs(dca): mark implementation checklist complete"
```
